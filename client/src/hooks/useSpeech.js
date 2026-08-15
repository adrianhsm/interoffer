// 语音交互 Hook：基于浏览器 Web Speech API
// - 语音输入：SpeechRecognition（zh-CN，连续识别 + 中间结果）
// - 语音播报：SpeechSynthesis（zh-CN 音色）
// 不支持时自动降级为纯文本，不影响使用。
import { useCallback, useEffect, useRef, useState } from 'react';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export function speechSupported() {
  return !!SR;
}

export function ttsSupported() {
  return 'speechSynthesis' in window;
}

export function useSpeech({ lang = 'zh-CN', autoSpeak = true, autoListen = false, rate = 1.0, onFinal } = {}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const recRef = useRef(null);
  const speakingRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const optsRef = useRef({ autoListen, autoSpeak, rate, lang });
  optsRef.current = { autoListen, autoSpeak, rate, lang };

  const stopListen = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* ignore */ }
      recRef.current = null;
    }
    setListening(false);
    setInterim('');
  }, []);

  const startListen = useCallback(() => {
    if (!SR) return false;
    if (recRef.current) return true;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalBuf = '';

    rec.onresult = (e) => {
      let inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalBuf += t;
        else inter += t;
      }
      setInterim(inter);
      if (finalBuf) {
        onFinalRef.current?.(finalBuf);
        finalBuf = '';
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        console.warn('[speech] 麦克风权限被拒绝', e.error);
      } else if (e.error === 'no-speech') {
        // 没检测到语音，自动重启（仅当仍在监听意图时）
      } else if (e.error !== 'aborted') {
        console.warn('[speech] 识别错误', e.error);
      }
      setListening(false);
      recRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      // 自动续听：如果用户仍希望持续听写且未手动停止
      if (optsRef.current.autoListen && document.visibilityState === 'visible') {
        startListen();
      }
    };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); recRef.current = null; }
    return true;
  }, [lang]);

  const speak = useCallback((text) => {
    if (!ttsSupported() || !text) return;
    // 只播报纯文本部分（去掉 markdown 符号）
    const clean = text.replace(/```[\s\S]*?```/g, '（代码略）').replace(/[#*`>_~]/g, '').slice(0, 600);
    if (!clean.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = optsRef.current.lang;
    u.rate = optsRef.current.rate;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.find((v) => v.lang.toLowerCase().startsWith('zh'));
    if (zh) u.voice = zh;
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    u.onend = () => { speakingRef.current = false; setSpeaking(false); };
    u.onerror = () => { speakingRef.current = false; setSpeaking(false); };
    window.speechSynthesis.speak(u);
  }, []);

  const cancelSpeak = useCallback(() => {
    if (ttsSupported()) window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  // 页面离开时清理
  useEffect(() => () => { stopListen(); cancelSpeak(); }, [stopListen, cancelSpeak]);

  // 语音播报是否开启的引用（供自动播报判断）
  const shouldSpeakRef = useRef(autoSpeak);
  useEffect(() => { shouldSpeakRef.current = autoSpeak; }, [autoSpeak]);
  const speakIfEnabled = useCallback((text) => {
    if (shouldSpeakRef.current) speak(text);
  }, [speak]);

  return {
    supported: !!SR,
    ttsOk: ttsSupported(),
    listening,
    interim,
    speaking,
    startListen,
    stopListen,
    speak,
    speakIfEnabled,
    cancelSpeak,
  };
}
