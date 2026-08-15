import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { DOMAINS } from '../domains.js';

function domainName(id) {
  return DOMAINS.find((d) => d.id === id)?.name || (id === 'jd' ? '职位需求' : '自定义');
}

function scoreChip(s) {
  if (s === null || s === undefined) return null;
  const cls = s >= 80 ? 'high' : s >= 65 ? 'mid' : 'low';
  return <span className={`score-chip ${cls}`}>{s}</span>;
}

export default function HistoryView() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all'); // all | jd | domain | completed

  const load = useCallback(() => {
    api.listInterviews().then(setRows).catch((e) => setErr(e.message));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (filter === 'jd' && r.mode !== 'jd') return false;
      if (filter === 'domain' && r.mode !== 'domain') return false;
      if (filter === 'completed' && r.status !== 'completed') return false;
      return true;
    });
  }, [rows, filter]);

  const stats = useMemo(() => {
    const done = (rows || []).filter((r) => r.status === 'completed' && r.total_score !== null);
    const avg = done.length ? done.reduce((s, r) => s + r.total_score, 0) / done.length : null;
    const max = done.length ? Math.max(...done.map((r) => r.total_score)) : null;
    return { total: rows?.length || 0, done: done.length, avg: avg === null ? null : Math.round(avg * 10) / 10, max };
  }, [rows]);

  async function handleDelete(e, id) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('确定删除这条面试记录及其评价？')) return;
    try {
      await api.deleteInterview(id);
      load();
    } catch (ex) {
      alert('删除失败：' + ex.message);
    }
  }

  if (err) return <div className="card"><div className="empty">😵 {err}</div></div>;
  if (!rows) return <div className="loading"><span className="spinner" /> 加载历史记录…</div>;

  return (
    <div>
      <div className="stat-cards">
        <div className="stat-card"><div className="k">面试总场次</div><div className="v">{stats.total}<small> 场</small></div></div>
        <div className="stat-card"><div className="k">已完成评价</div><div className="v">{stats.done}<small> 场</small></div></div>
        <div className="stat-card"><div className="k">平均分</div><div className="v">{stats.avg ?? '—'}<small> / 100</small></div></div>
        <div className="stat-card"><div className="k">最高分</div><div className="v">{stats.max ?? '—'}<small> / 100</small></div></div>
      </div>

      <div className="card">
        <div className="card-title">📋 面试历史记录 <span className="sub">每场面试都有独立的评价报告</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {[
              ['all', '全部'], ['completed', '已完成'], ['jd', '职位需求'], ['domain', '领域'],
            ].map(([k, label]) => (
              <button key={k} className={`btn sm ${filter === k ? 'primary' : ''}`} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty">
            <div className="big">🗂</div>
            还没有面试记录。<a href="#/">开始第一场模拟面试 →</a>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>岗位 / 领域</th>
                  <th>模式</th>
                  <th>轮次</th>
                  <th>时长</th>
                  <th>评分</th>
                  <th>状态</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => {
                    if (r.status === 'completed') window.location.hash = `#/report/${r.id}`;
                    else if (r.status === 'active') window.location.hash = `#/interview/${r.id}`;
                  }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td><b>{r.role_title || domainName(r.domain_id)}</b></td>
                    <td><span className={`badge ${r.mode === 'jd' ? 'blue' : 'gray'}`}>{r.mode === 'jd' ? '📄 JD' : '📚 领域'}</span></td>
                    <td>{r.question_count ?? 0}</td>
                    <td>{r.duration_s ? `${Math.floor(r.duration_s / 60)}分` : '—'}</td>
                    <td>{scoreChip(r.total_score) || '—'}</td>
                    <td>
                      {r.status === 'completed' && <span className="badge green">已完成</span>}
                      {r.status === 'active' && <span className="badge blue">进行中</span>}
                      {r.status === 'pending' && <span className="badge gray">未开始</span>}
                      {r.status === 'aborted' && <span className="badge red">已中断</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.status === 'completed' && <a className="btn sm primary" href={`#/report/${r.id}`} style={{ marginRight: 6 }}>报告</a>}
                      {r.status === 'active' && <a className="btn sm" href={`#/interview/${r.id}`} style={{ marginRight: 6 }}>继续</a>}
                      <button className="btn sm danger" onClick={(e) => handleDelete(e, r.id)}>删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
