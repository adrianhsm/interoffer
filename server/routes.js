// API 路由
import { Router } from 'express';
import crypto from 'node:crypto';
import {
  nowIso, insertInterview, getInterview, updateInterview, listInterviews,
  getMessages, appendMessage, statsAggregates, db,
} from './db.js';
import { getConfig, saveConfig, publicSettings } from './config.js';
import { DOMAINS, getDomain, generatePlan, interviewerReply, generateEvaluation, isMock } from './llm.js';

export const api = Router();

const newId = () => crypto.randomUUID();

api.get('/health', (req, res) => res.json({ ok: true, mock: isMock() }));

api.get('/domains', (req, res) => res.json(DOMAINS));

api.get('/settings', (req, res) => res.json(publicSettings()));

api.put('/settings', (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.llm) patch.llm = { baseUrl: body.llm.baseUrl, apiKey: body.llm.apiKey, model: body.llm.model, temperature: body.llm.temperature };
  if (body.interview) patch.interview = body.interview;
  const next = saveConfig(patch);
  res.json(publicSettings());
  // 校验可达性（异步，不阻塞）
  void (async () => {
    if (next.llm.apiKey) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        await fetch(`${next.llm.baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${next.llm.apiKey}` }, signal: ctrl.signal });
        clearTimeout(t);
      } catch { /* 忽略：只是探测 */ }
    }
  })();
});

// ---------- 面试会话 ----------

// 创建面试：mode=jd（附 jdText）或 mode=domain（附 domainId）。同步生成面试计划。
api.post('/interviews', async (req, res) => {
  try {
    const { mode, domainId, jdText, durationMinutes } = req.body || {};
    if (mode === 'jd' && (!jdText || jdText.trim().length < 20)) {
      return res.status(400).json({ error: 'JD 模式需要提供足够详细的职位需求文本（至少 20 字）' });
    }
    if (mode === 'domain' && !getDomain(domainId)) {
      return res.status(400).json({ error: '未知的领域' });
    }
    const id = newId();
    const created = nowIso();
    const dur = Number(durationMinutes) >= 10 && Number(durationMinutes) <= 180 ? Number(durationMinutes) : 60;
    insertInterview({ id, mode, domain_id: mode === 'domain' ? domainId : null, jd_text: mode === 'jd' ? jdText : null, plan_json: null, duration_minutes: dur, status: 'pending', created_at: created });
    let plan;
    try {
      plan = await generatePlan({ mode, domainId, jdText });
    } catch (err) {
      console.error('[plan] 生成失败，回退 mock 计划:', err.message);
      const dom = getDomain(domainId);
      const { mockPlan } = await import('./llm.js');
      plan = mockPlan(mode, domainId, jdText, dom, (dom?.skills || []).slice(0, 8));
    }
    updateInterview(id, { plan_json: plan, role_title: plan.roleTitle, seniority: plan.seniority });
    res.json(getInterview(id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

api.get('/interviews', (req, res) => res.json(listInterviews()));

api.get('/interviews/:id', (req, res) => {
  const row = getInterview(req.params.id);
  if (!row) return res.status(404).json({ error: '面试不存在' });
  row.messages = getMessages(req.params.id);
  res.json(row);
});

api.post('/interviews/:id/start', async (req, res) => {
  try {
    const iv = getInterview(req.params.id);
    if (!iv) return res.status(404).json({ error: '面试不存在' });
    if (iv.status !== 'pending') return res.status(400).json({ error: '面试已开始或已结束' });
    const startedAt = nowIso();
    updateInterview(req.params.id, { status: 'active', started_at: startedAt });
    const totalSec = (iv.duration_minutes || 60) * 60;
    let greeting;
    try {
      greeting = await interviewerReply({ interview: iv, messages: [], elapsedSec: 0, totalSec });
    } catch (err) {
      console.error('[start] LLM 失败，回退 mock 开场白:', err.message);
      const { mockInterviewerReply } = await import('./llm.js');
      greeting = await mockInterviewerReply({ interview: iv, messages: [], elapsedSec: 0, totalSec });
    }
    appendMessage(req.params.id, 'assistant', greeting);
    const row = getInterview(req.params.id);
    row.messages = getMessages(req.params.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 候选人回答 → SSE 流式返回面试官回复
api.post('/interviews/:id/chat', async (req, res) => {
  const id = req.params.id;
  const iv = getInterview(id);
  if (!iv) return res.status(404).json({ error: '面试不存在' });
  if (iv.status !== 'active') return res.status(400).json({ error: '面试未在进行中' });
  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: '回答不能为空' });

  appendMessage(id, 'user', content);
  const messages = getMessages(id);
  const totalSec = (iv.duration_minutes || 60) * 60;
  const elapsedSec = iv.started_at ? (Date.now() - new Date(iv.started_at).getTime()) / 1000 : 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  send({ type: 'start' });

  let full = '';
  try {
    full = await interviewerReply({ interview: iv, messages, elapsedSec, totalSec, onToken: (t) => send({ type: 'token', text: t }) });
  } catch (err) {
    console.error('[chat]', err);
    // 兜底：用 mock 面试官回复，保证流程不中断
    try {
      const { mockInterviewerReply } = await import('./llm.js');
      full = await mockInterviewerReply({ interview: iv, messages, elapsedSec, totalSec, onToken: (t) => send({ type: 'token', text: t }) });
    } catch (e2) {
      send({ type: 'error', message: err.message });
      res.end();
      return;
    }
  }
  appendMessage(id, 'assistant', full);
  const rounds = getMessages(id).filter((m) => m.role === 'user').length;
  updateInterview(id, { question_count: rounds });
  send({ type: 'done', questionCount: rounds });
  res.end();
});

// 结束面试并生成评价
api.post('/interviews/:id/end', async (req, res) => {
  try {
    const id = req.params.id;
    const iv = getInterview(id);
    if (!iv) return res.status(404).json({ error: '面试不存在' });
    if (iv.status === 'completed') return res.json(iv.report_json || {});
    const endedAt = nowIso();
    const durationSec = iv.started_at ? Math.round((Date.now() - new Date(iv.started_at).getTime()) / 1000) : 0;
    updateInterview(id, { status: 'completed', ended_at: endedAt, duration_s: durationSec });
    const messages = getMessages(id);
    let report;
    try {
      report = await generateEvaluation({ interview: iv, messages, durationSec });
    } catch (err) {
      console.error('[eval] 生成失败，回退 mock 评价:', err.message);
      const { mockEvaluation } = await import('./llm.js');
      report = await mockEvaluation({ interview: iv, messages, durationSec });
    }
    updateInterview(id, {
      report_json: report,
      total_score: report.overallScore,
      summary: report.summary,
    });
    res.json({ ...getInterview(id), report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

api.get('/interviews/:id/report', (req, res) => {
  const iv = getInterview(req.params.id);
  if (!iv) return res.status(404).json({ error: '面试不存在' });
  res.json(iv.report_json || null);
});

api.delete('/interviews/:id', (req, res) => {
  const r = db.prepare('DELETE FROM interviews WHERE id = ?').run(req.params.id);
  res.json({ deleted: r.changes > 0 });
});

// ---------- 统计 ----------

api.get('/stats', (req, res) => res.json(statsAggregates()));
