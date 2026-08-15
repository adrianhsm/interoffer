import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export default function HomeView() {
  const [mode, setMode] = useState('domain'); // 'domain' | 'jd'
  const [domains, setDomains] = useState([]);
  const [domainId, setDomainId] = useState('frontend');
  const [jdText, setJdText] = useState('');
  const [duration, setDuration] = useState(60);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState(null); // 创建成功后的计划预览
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const [jdExample, setJdExample] = useState('');

  useEffect(() => {
    api.domains().then(setDomains).catch(() => {});
    api.settings().then((s) => {
      if (s.interview?.durationMinutes) setDuration(s.interview.durationMinutes);
    }).catch(() => {});
  }, []);

  const jdExampleText = useMemo(() => `【高级前端工程师】
岗位职责：
- 负责公司核心业务的前端架构设计与开发，主导技术方案评审
- 优化前端性能，首屏加载时间控制在 1.5s 以内
- 建设前端工程化体系（组件库、CI/CD、监控告警）
- 带领 2~3 人小组，负责 code review 与新人培养

任职要求：
- 5 年以上前端经验，精通 React / TypeScript
- 深入理解浏览器渲染原理、HTTP 缓存、性能优化
- 熟悉 Node.js，有中后台与移动端 H5 项目经验
- 有组件库建设、微前端或低代码平台经验者优先`, []);

  const canStart = mode === 'jd' ? jdText.trim().length >= 20 : !!domainId;

  async function handleCreate() {
    setErr('');
    if (!canStart) {
      setErr(mode === 'jd' ? '请填写职位需求（至少 20 字）' : '请选择一个领域');
      return;
    }
    setCreating(true);
    try {
      const iv = await api.createInterview(
        mode === 'jd'
          ? { mode: 'jd', jdText, durationMinutes: duration }
          : { mode: 'domain', domainId, durationMinutes: duration }
      );
      setPreview(iv);
    } catch (e) {
      setErr(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    try {
      await api.startInterview(preview.id);
      window.location.hash = `#/interview/${preview.id}`;
    } catch (e) {
      setErr(e.message);
      setStarting(false);
    }
  }

  return (
    <div>
      <div className="hero">
        <h1>🎯 AI 模拟面试</h1>
        <p>资深面试官 · 严格施压 · 约 {duration} 分钟 · 面试后自动生成评价报告与改进建议</p>
      </div>

      <div className="mode-switch">
        <button className={`mode-tab ${mode === 'domain' ? 'active' : ''}`} onClick={() => { setMode('domain'); setErr(''); }}>
          <span className="t">📚 按领域面试</span>
          <span className="d">从预设领域中选择：前端 / 后端Java / 系统架构师 / Agent工程师 / 机器人软件工程师</span>
        </button>
        <button className={`mode-tab ${mode === 'jd' ? 'active' : ''}`} onClick={() => { setMode('jd'); setErr(''); }}>
          <span className="t">📄 按职位需求面试</span>
          <span className="d">粘贴目标公司的 JD，系统自动解析岗位要求并定制面试题</span>
        </button>
      </div>

      {mode === 'domain' ? (
        <div className="card">
          <div className="card-title">选择领域知识</div>
          <div className="domain-grid">
            {domains.map((d) => (
              <div key={d.id} className={`domain-card ${domainId === d.id ? 'selected' : ''}`} onClick={() => setDomainId(d.id)}>
                <div className="check">✓</div>
                <div className="icon">{d.icon}</div>
                <div className="name">{d.name}</div>
                <div className="desc">{d.desc}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-title">职位需求（JD）</div>
          <textarea
            className="textarea"
            rows={10}
            placeholder="粘贴职位描述，包括岗位职责、任职要求、加分项等，越详细面试越有针对性…"
            value={jdText}
            onChange={(e) => { setJdText(e.target.value); setErr(''); }}
          />
          {jdText.trim().length === 0 && (
            <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => { setJdText(jdExampleText); setErr(''); }}>
              ✨ 填入示例 JD 试试
            </button>
          )}
          <div className="hint">系统会解析 JD 中的岗位方向、核心技能、职级要求，自动生成约 60 分钟的面试计划。</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">面试设置</div>
        <div className="panel-row">
          <div className="grow" style={{ maxWidth: 260 }}>
            <span className="label">面试时长</span>
            <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              <option value={30}>30 分钟（快练）</option>
              <option value={45}>45 分钟</option>
              <option value={60}>60 分钟（推荐，真实校招/社招一面的时长）</option>
              <option value={90}>90 分钟</option>
            </select>
          </div>
          <div className="grow">
            <span className="label">风格</span>
            <div className="badge blue" style={{ fontSize: 13.5, padding: '7px 14px' }}>🔨 严格模式：深挖追问，不放过模糊回答，帮你在真实面试前暴露短板</div>
          </div>
          <button className="btn primary lg" disabled={creating || !canStart} onClick={handleCreate}>
            {creating ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> 正在生成面试计划…</> : '🚀 创建面试'}
          </button>
        </div>
        {err && <div className="hint" style={{ color: 'var(--red)' }}>⚠ {err}</div>}
      </div>

      {preview && (
        <div className="modal-mask" style={{
          position: 'fixed', inset: 0, background: 'rgba(20,24,40,.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => !starting && setPreview(null)}>
          <div className="card" style={{ maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="card-title">📋 面试计划已生成 <span className="sub">请确认后开始</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="badge blue">{preview.role_title}</span>
              <span className="badge gray">{preview.seniority}</span>
              <span className="badge gray">⏱ 约 {duration} 分钟</span>
            </div>
            {preview.plan_json?.planSummary && (
              <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 14 }}>{preview.plan_json.planSummary}</p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {preview.plan_json?.topics?.map((t, i) => (
                <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', background: '#fafbff' }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{i + 1}. {t.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 4 }}>
                    {t.questions.slice(0, 2).map((q) => <div key={q}>· {q}</div>)}
                    {t.questions.length > 2 && <div style={{ color: 'var(--ink-3)' }}>· 等 {t.questions.length} 题…</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setPreview(null)}>取消</button>
              <button className="btn primary" disabled={starting} onClick={handleStart}>
                {starting ? '正在开始…' : '🎙 开始面试'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
