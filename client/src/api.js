// 前端 API 封装
const base = '/api';

async function j(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => j('GET', '/health'),
  domains: () => j('GET', '/domains'),
  settings: () => j('GET', '/settings'),
  saveSettings: (patch) => j('PUT', '/settings', patch),
  createInterview: (payload) => j('POST', '/interviews', payload),
  getInterview: (id) => j('GET', `/interviews/${id}`),
  listInterviews: () => j('GET', '/interviews'),
  startInterview: (id) => j('POST', `/interviews/${id}/start`),
  endInterview: (id) => j('POST', `/interviews/${id}/end`),
  deleteInterview: (id) => j('DELETE', `/interviews/${id}`),
  report: (id) => j('GET', `/interviews/${id}/report`),
  stats: () => j('GET', '/stats'),
};

// 流式聊天：返回一个 async iterable of {type, text|message|questionCount|error}
export async function* chatStream(id, content) {
  const res = await fetch(`${base}/interviews/${id}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      try {
        yield JSON.parse(t.slice(5).trim());
      } catch { /* ignore */ }
    }
  }
}
