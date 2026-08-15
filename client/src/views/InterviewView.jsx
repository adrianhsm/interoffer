import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api, chatStream } from '../api.js';
import { useSpeech, speechSupported, ttsSupported } from '../hooks/useSpeech.js';

const VOICE_PREFS_KEY = 'interoffer_voice_prefs';

function loadVoicePrefs() {
  try { return JSON.parse(localStorage.getItem(VOICE_PREFS_KEY)) || {}; } catch { return {}; }
}

export default function InterviewView({ id }) {
  const [iv, setIv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const chatRef = useRef(null);
  const prefs = useMemo(loadVoicePrefs, []);
  const [voiceOn, setVoiceOn] = useState(prefs.voiceOn !== false);
  const [autoSpeak, setAutoSpeak] = useState(prefs.autoSpeak !== false);
  const [autoListen, setAutoListen] = useState(prefs.autoListen === true);
  const [voiceRate, setVoiceRate] = useState(prefs.voiceRate || 1.0);
  const spokenRef = useRef(new Set());
  const endedRef = useRef(false);

  const speech = useSpeech({
    lang: 'zh-CN',
    autoSpeak,
    autoListen,
    rate: voiceRate,
    onFinal: (t) => {
      setInput((prev) => (prev ? prev + t : t));
      setError('');
    },
  });

  // 持久化语音偏好
  useEffect(() => {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ voiceOn, autoSpeak, autoListen, voiceRate }));
  }, [voiceOn, autoSpeak, autoListen, voiceRate]);

  const durationMin = useMemo(() => iv?.duration_minutes ?? 60, [iv]);

  // 加载面试
  const load = useCallback(async () => {
    const data = await api.getInterview(id);
    setIv(data);
    setMessages((data.messages || []).map((m) => ({ ...m, streaming: false })));
  }, [id]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // 时钟
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSec = useMemo(() => {
    if (!iv?.started_at) return 0;
    return Math.max(0, Math.floor((now - new Date(iv.started_at).getTime()) / 1000));
  }, [iv, now]);

  const totalSec = durationMin * 60;
  const remainSec = Math.max(0, totalSec - elapsedSec);
  const remainMin = Math.floor(remainSec / 60);
  const remainSecPart = remainSec % 60;
  const progress = Math.min(100, (elapsedSec / totalSec) * 100);
  const warn = remainSec < 5 * 60;

  // 自动滚动到底部
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, speech.interim]);

  // 自动播报开场白
  useEffect(() => {
    if (voiceOn && autoSpeak && iv && messages.length === 1 && messages[0].role === 'assistant') {
      const key = `${messages[0].id}-${messages[0].content.slice(0, 20)}`;
      if (!spokenRef.current.has(key)) {
        spokenRef.current.add(key);
        setTimeout(() => speech.speakIfEnabled(messages[0].content), 600);
      }
    }
  }, [iv, messages, voiceOn, autoSpeak, speech]);

  const handleEnd = useCallback(async () => {
    if (endedRef.current || ending) return;
    endedRef.current = true;
    setEnding(true);
    speech.cancelSpeak();
    speech.stopListen();
    try {
      await api.endInterview(id);
      window.location.hash = `#/report/${id}`;
    } catch (e) {
      setError(e.message || '生成评价失败');
      setEnding(false);
      endedRef.current = false;
    }
  }, [id, ending, speech]);

  // 计时结束自动收尾
  useEffect(() => {
    if (iv?.status === 'active' && remainSec === 0 && !endedRef.current) {
      endedRef.current = true;
      handleEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainSec, iv?.status]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || sending || iv?.status !== 'active') return;
    setInput('');
    setError('');
    setSending(true);
    speech.cancelSpeak();
    setMessages((ms) => [...ms, { id: `local-${Date.now()}`, role: 'user', content, streaming: false }]);
    let acc = '';
    const streamMsgId = `stream-${Date.now()}`;
    setMessages((ms) => [...ms, { id: streamMsgId, role: 'assistant', content: '', streaming: true }]);
    try {
      for await (const ev of chatStream(id, content)) {
        if (ev.type === 'token') {
          acc += ev.text;
          setMessages((ms) => ms.map((m) => (m.id === streamMsgId ? { ...m, content: acc } : m)));
        } else if (ev.type === 'done') {
          acc = acc.trim();
          setMessages((ms) => ms.map((m) => (m.id === streamMsgId ? { ...m, content: acc, streaming: false } : m)));
          if (voiceOn && autoSpeak && acc) speech.speakIfEnabled(acc);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }
      await load();
    } catch (e) {
      setError(e.message || '发送失败');
      setMessages((ms) => ms.filter((m) => m.id !== streamMsgId));
    } finally {
      setSending(false);
      if (autoListen && voiceOn) setTimeout(() => speech.startListen(), 400);
    }
  }, [input, sending, iv, id, speech, voiceOn, autoSpeak, autoListen, load]);

  const toggleMic = useCallback(() => {
    if (!voiceOn) setVoiceOn(true);
    if (speech.listening) speech.stopListen();
    else speech.startListen();
  }, [speech, voiceOn]);

  if (error && !iv) {
    return <div className="card"><div className="empty"><div className="big">😵</div>加载失败：{error}<br /><a href="#/">返回首页</a></div></div>;
  }
  if (!iv) return <div className="loading"><span className="spinner" /> 加载面试房间…</div>;

  if (iv.status === 'pending') {
    return (
      <div className="card">
        <div className="empty">
          <div className="big">🎙</div>
          <h3>面试已创建，尚未开始</h3>
          <button className="btn primary lg" onClick={async () => {
            try { await api.startInterview(id); load(); } catch (e) { setError(e.message); }
          }}>开始面试</button>
          <div style={{ marginTop: 10 }}><a href="#/">返回首页</a></div>
        </div>
      </div>
    );
  }

  if (iv.status === 'completed') {
    return (
      <div className="card">
        <div className="empty">
          <div className="big">📄</div>
          <h3>本场面试已完成评价</h3>
          <a className="btn primary lg" href={`#/report/${id}`}>查看评价报告</a>
        </div>
      </div>
    );
  }

  return (
    <div className="card room">
      <div className="room-head">
        <div className="avatar">👔</div>
        <div>
          <div className="role">{iv.role_title || '模拟面试官'} 面试官</div>
          <div className="meta">{iv.mode === 'jd' ? '职位需求模式' : '领域模式'} · 严格模式 · 共 {messages.filter((m) => m.role === 'user').length} 轮问答</div>
        </div>
        <div className="timer">
          <span className="badge gray">剩余</span>
          <span className={`clock ${warn ? 'warn' : ''}`}>{String(remainMin).padStart(2, '0')}:{String(remainSecPart).padStart(2, '0')}</span>
          <div className="bar"><i className={warn ? 'warn' : ''} style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      <div className="chat" ref={chatRef} style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="m-avatar">{m.role === 'assistant' ? '👔' : '🙋'}</div>
            <div>
              <div className="bubble">{m.content || (m.streaming ? '…' : '')}</div>
              <div className="m-time">{new Date(m.created_at || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
        ))}
        {sending && !messages.some((m) => m.streaming) && (
          <div className="typing"><span>面试官正在思考</span><span className="dots"><i /><i /><i /></span></div>
        )}
        {speech.listening && speech.interim && (
          <div className="msg user">
            <div className="m-avatar">🎤</div>
            <div>
              <div className="bubble" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', borderTopRightRadius: 4 }}>{speech.interim}…</div>
            </div>
          </div>
        )}
      </div>

      <div className="room-input">
        <div className="tools">
          <button className={`mic-btn ${speech.listening ? 'live' : ''}`} onClick={toggleMic} title={speech.listening ? '停止录音' : '按住说话（语音输入）'}>
            {speech.listening ? '⏹' : '🎤'}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            {!speechSupported() ? '当前浏览器不支持语音识别，请使用 Chrome/Edge' : speech.listening ? '正在聆听… 说完后自动填入' : '点击🎤语音作答'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
            {!speechSupported() && <span className="badge amber">语音输入不可用</span>}
            {!ttsSupported() && <span className="badge amber">语音播报不可用</span>}
            <button className="btn danger sm" onClick={() => setEndConfirm(true)}>⏹ 结束面试</button>
          </div>
        </div>
        {speech.interim && <div className="interim">🎤 {speech.interim}</div>}
        <div className="input-row">
          <textarea
            className="input"
            rows={2}
            style={{ minHeight: 46, resize: 'none' }}
            placeholder="输入你的回答，或点击 🎤 用语音作答…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            disabled={sending}
          />
          <button className="btn primary" style={{ height: 46 }} disabled={sending || !input.trim()} onClick={handleSend}>发送</button>
        </div>
        <div className="voice-toggle">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span className={`switch ${voiceOn ? 'on' : ''}`} onClick={() => setVoiceOn(!voiceOn)} />
            启用语音交互
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span className={`switch ${autoSpeak ? 'on' : ''}`} onClick={() => setAutoSpeak(!autoSpeak)} />
            自动播报面试官语音
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <span className={`switch ${autoListen ? 'on' : ''}`} onClick={() => setAutoListen(!autoListen)} />
            回答后自动开始听写
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            语速
            <input type="range" min="0.6" max="1.4" step="0.1" value={voiceRate}
              onChange={(e) => setVoiceRate(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        </div>
        {error && <div className="hint" style={{ color: 'var(--red)' }}>⚠ {error}</div>}
      </div>

      {endConfirm && (
        <div className="modal-mask" style={{
          position: 'fixed', inset: 0, background: 'rgba(20,24,40,.45)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div className="card" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>⏹</div>
            <div className="card-title" style={{ justifyContent: 'center' }}>确定结束面试？</div>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, margin: '0 0 18px' }}>
              结束将立即停止问答，并由面试官根据<strong>完整对话记录</strong>生成评分与评价报告。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn" onClick={() => setEndConfirm(false)}>再想想</button>
              <button className="btn primary" onClick={handleEnd}>确认结束并生成报告</button>
            </div>
          </div>
        </div>
      )}

      {ending && (
        <div className="modal-mask" style={{
          position: 'fixed', inset: 0, background: 'rgba(20,24,40,.6)', zIndex: 110,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card" style={{ textAlign: 'center', maxWidth: 360 }}>
            <div style={{ marginBottom: 12 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>面试官正在复盘整场面试…</div>
            <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>正在生成评分与改进建议，约需 10~30 秒</div>
          </div>
        </div>
      )}
    </div>
  );
}
