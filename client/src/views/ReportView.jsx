import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const VERDICT_MAP = {
  hire: { label: '✅ 建议录用 / 通过', cls: 'hire' },
  weak_hire: { label: '⚠️ 基本达标，建议补强后录用', cls: 'weak_hire' },
  no: { label: '❌ 暂不推荐，差距明显', cls: 'no' },
};

function dimColor(score) {
  if (score >= 80) return '#16a34a';
  if (score >= 65) return '#d97706';
  return '#dc2626';
}

export default function ReportView({ id }) {
  const [iv, setIv] = useState(null);
  const [report, setReport] = useState(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getInterview(id);
      setIv(data);
      setReport(data.report_json);
    } catch (e) {
      setErr(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (err) {
    return <div className="card"><div className="empty"><div className="big">😵</div>{err}<br /><a href="#/history">返回历史记录</a></div></div>;
  }
  if (!iv) return <div className="loading"><span className="spinner" /> 加载报告…</div>;
  if (!report) {
    return (
      <div className="card">
        <div className="empty">
          <div className="big">⏳</div>
          <h3>本场面试还未生成评价</h3>
          <p style={{ color: 'var(--ink-2)' }}>面试结束后系统会自动生成评价报告。</p>
          {iv.status === 'active' && <a className="btn primary" href={`#/interview/${id}`}>返回面试房间</a>}
        </div>
      </div>
    );
  }

  const v = VERDICT_MAP[report.verdict] || VERDICT_MAP.weak_hire;
  const R = 46;
  const C = 2 * Math.PI * R;
  const score = report.overallScore ?? 0;
  const durationText = iv.duration_s
    ? `${Math.floor(iv.duration_s / 60)} 分 ${iv.duration_s % 60} 秒`
    : '—';
  const rounds = iv.messages ? iv.messages.filter((m) => m.role === 'user').length : 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <a className="btn sm" href="#/history">← 历史记录</a>
        <a className="btn sm primary" href="#/">＋ 再来一场面试</a>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="badge blue">{iv.role_title || '目标岗位'}</span>
          <span className="badge gray">{iv.mode === 'jd' ? '📄 职位需求模式' : '📚 领域模式'}</span>
          <span className="badge gray">⏱ {durationText}</span>
          <span className="badge gray">💬 {rounds} 轮问答</span>
          <span className="badge gray">{new Date(iv.created_at).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
      </div>

      <div className="card">
        <div className="report-head">
          <div className="score-ring">
            <svg width="108" height="108">
              <circle cx="54" cy="54" r={R} fill="none" stroke="var(--bg)" strokeWidth="11" />
              <circle cx="54" cy="54" r={R} fill="none" stroke={dimColor(score)} strokeWidth="11"
                strokeLinecap="round" strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 54 54)" />
            </svg>
            <div className="num"><b>{score}</b><span>总分 / 100</span></div>
          </div>
          <div className="report-verdict">
            <h2>{iv.role_title || '目标岗位'} · 面试评价</h2>
            <span className={`verdict-tag ${v.cls}`}>{v.label}</span>
            <div style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>{report.verdictNote}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title">📝 总体评价 <span className="sub">面试官视角</span></div>
          <div className="summary-text">{report.summary}</div>
          <div className="card-title" style={{ marginTop: 20 }}>📊 分维度评分</div>
          {report.dimensions?.map((d) => (
            <div key={d.name}>
              <div className="dim-row">
                <span className="dname">{d.name}</span>
                <div className="dbar"><i style={{ width: `${d.score}%`, background: dimColor(d.score) }} /></div>
                <span className="dscore" style={{ color: dimColor(d.score) }}>{d.score}</span>
              </div>
              {d.comment && <div className="dcomment">{d.comment}</div>}
            </div>
          ))}
        </div>

        <div>
          <div className="card">
            <div className="card-title">💪 做得好的方面</div>
            {report.strengths?.map((s, i) => (
              <div className="list-item good" key={i}><span className="dot">✓</span><span>{s}</span></div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">📉 不足之处</div>
            {report.weaknesses?.map((s, i) => (
              <div className="list-item bad" key={i}><span className="dot">✕</span><span>{s}</span></div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">🚀 改进建议</div>
            {report.suggestions?.map((s, i) => (
              <div className="list-item imp" key={i}><span className="dot">{i + 1}</span><span>{s}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">💬 面试全程记录
          <button className="btn sm ghost transcript-toggle" onClick={() => setShowTranscript(!showTranscript)}>
            {showTranscript ? '收起' : '展开'}（{iv.messages?.length || 0} 条）
          </button>
        </div>
        {showTranscript && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
            {iv.messages?.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8 }}>
                <span className="badge gray" style={{ flexShrink: 0, alignSelf: 'flex-start', marginTop: 3, width: 52, justifyContent: 'center' }}>
                  {m.role === 'assistant' ? '面试官' : '候选人'}
                </span>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, background: m.role === 'user' ? 'var(--accent-soft)' : 'var(--bg)', borderRadius: 8, padding: '8px 12px', flex: 1 }}>{m.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
