import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SettingsView() {
  const [s, setS] = useState(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [duration, setDuration] = useState(60);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.settings().then((d) => {
      setS(d);
      setBaseUrl(d.llm.baseUrl);
      setApiKey('');
      setModel(d.llm.model);
      setTemperature(d.interview?.temperature ?? 0.7);
      setDuration(d.interview?.durationMinutes ?? 60);
    }).catch((e) => setErr(e.message));
  }, []);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }

  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      await api.saveSettings({
        llm: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), temperature },
        interview: { durationMinutes: duration },
      });
      setApiKey('');
      flash('✅ 设置已保存');
      const d = await api.settings();
      setS(d);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setErr('');
    setToast('');
    try {
      const res = await fetch(`${baseUrl.trim().replace(/\/+$/, '')}/models`, {
        headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const names = (data.data || []).slice(0, 8).map((m) => m.id);
      flash(`✅ 连接成功${names.length ? '，可用模型示例：' + names.join(', ') : ''}`);
    } catch (e) {
      setErr('连接测试失败：' + e.message + '（部分服务不支持 /models 接口，可直接保存后试一场面试）');
    }
  }

  if (!s) return <div className="loading"><span className="spinner" /> 加载设置…</div>;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="card">
        <div className="card-title">🤖 LLM 接口配置 <span className="sub">支持任意 OpenAI 兼容接口</span></div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: '0 0 16px' }}>
          配置后系统会使用真实大模型扮演"严格面试官"并进行 JD 解析与评价生成。
          <b>API Key 留空则使用内置演示面试官（Mock 模式）</b>，可离线体验完整流程。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <span className="label">接口地址 Base URL</span>
            <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1 或 https://api.deepseek.com/v1 或 http://localhost:11434/v1（Ollama）" />
          </div>
          <div>
            <span className="label">API Key {s.llm.hasKey && <span className="badge green" style={{ marginLeft: 8 }}>已配置（留空则保持不变）</span>}</span>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span className="label">模型 Model</span>
              <input className="input" value={model} onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini / deepseek-chat / qwen2.5:14b" />
            </div>
            <div>
              <span className="label">温度 Temperature：{temperature}</span>
              <input type="range" min="0" max="1.2" step="0.1" value={temperature} style={{ width: '100%', marginTop: 12 }}
                onChange={(e) => setTemperature(Number(e.target.value))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" onClick={handleTest}>🔌 测试连接</button>
            <button className="btn primary" disabled={saving} onClick={handleSave}>{saving ? '保存中…' : '💾 保存配置'}</button>
          </div>
          {err && <div className="hint" style={{ color: 'var(--red)' }}>⚠ {err}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">⚙️ 面试默认参数</div>
        <div className="settings-row">
          <div><div className="l">默认面试时长</div><div className="d">新面试默认的时长设置</div></div>
          <select className="select" style={{ width: 200 }} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            <option value={30}>30 分钟</option>
            <option value={45}>45 分钟</option>
            <option value={60}>60 分钟</option>
            <option value={90}>90 分钟</option>
          </select>
        </div>
        <div className="settings-row">
          <div><div className="l">面试风格</div><div className="d">固定为严格模式：深挖追问、暴露短板，帮助快速成长</div></div>
          <span className="badge blue">🔨 严格</span>
        </div>
        <div className="settings-row">
          <div><div className="l">语音交互</div><div className="d">在面试房间内可单独开关；语音识别需 Chrome/Edge 浏览器</div></div>
          <span className="badge gray">🎤 浏览器 Web Speech API</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">📦 数据说明</div>
        <p style={{ fontSize: 13.5, color: 'var(--ink-2)', margin: 0 }}>
          所有面试记录、评价报告与统计均保存在本地 <code>server/data/interviews.db</code>（SQLite），不会上传。
          配置保存在 <code>server/data/config.json</code>。删除记录会同时删除对应评价。
        </p>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
