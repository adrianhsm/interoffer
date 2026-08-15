import React, { useEffect, useMemo, useState } from 'react';
import HomeView from './views/HomeView.jsx';
import InterviewView from './views/InterviewView.jsx';
import ReportView from './views/ReportView.jsx';
import HistoryView from './views/HistoryView.jsx';
import AnalyticsView from './views/AnalyticsView.jsx';
import SettingsView from './views/SettingsView.jsx';

// 极简哈希路由
function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash;
}

function parse(hash) {
  const h = hash.replace(/^#/, '') || '/';
  const [path, query] = h.split('?');
  const segs = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { path, segs, params };
}

const NAV = [
  { to: '#/', label: '开始面试', icon: '🎯' },
  { to: '#/history', label: '历史记录', icon: '📋' },
  { to: '#/stats', label: '统计分析', icon: '📊' },
  { to: '#/settings', label: '设置', icon: '⚙️' },
];

export default function App() {
  const hash = useHashRoute();
  const { segs } = useMemo(() => parse(hash), [hash]);
  const [mockMode, setMockMode] = useState(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setMockMode(!!d.mock)).catch(() => setMockMode(null));
  }, []);

  let view;
  if (segs[0] === 'interview' && segs[1]) view = <InterviewView key={segs[1]} id={segs[1]} />;
  else if (segs[0] === 'report' && segs[1]) view = <ReportView key={segs[1]} id={segs[1]} />;
  else if (segs[0] === 'history') view = <HistoryView />;
  else if (segs[0] === 'stats') view = <AnalyticsView />;
  else if (segs[0] === 'settings') view = <SettingsView />;
  else view = <HomeView />;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-logo">🎯</span>
          <span className="brand-name">interOffer</span>
          <span className="brand-sub">AI 模拟面试</span>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.to} href={n.to} className={`nav-item ${hash.startsWith(n.to) ? 'active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>{n.label}
            </a>
          ))}
        </nav>
        <div className={`mode-badge ${mockMode ? 'mock' : ''}`}>
          {mockMode === null ? '…' : mockMode ? '⚡ 演示模式（未配置 LLM）' : '🔗 已连接 LLM'}
        </div>
      </header>
      <main className="content">{view}</main>
      <footer className="footer">interOffer · 严格模拟面试，助你更快拿到 Offer</footer>
    </div>
  );
}
