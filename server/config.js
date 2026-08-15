// 配置管理：LLM 设置、面试默认参数。持久化到 server/data/config.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  llm: {
    baseUrl: 'https://api.openai.com/v1', // OpenAI 兼容接口地址，如 https://api.deepseek.com/v1
    apiKey: '',                            // 留空则使用内置 mock 面试官（可离线演示）
    model: 'gpt-4o-mini',
    temperature: 0.7,
    timeoutMs: 120000,
  },
  interview: {
    durationMinutes: 60,
    strictness: 'strict', // strict | normal
    voiceEnabled: true,
    autoSpeak: true,
    autoListen: false,
    voiceRate: 1.0,
    language: 'zh-CN',
  },
};

let cache = null;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

export function getConfig() {
  if (cache) return cache;
  ensureDataDir();
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    saved = {};
  }
  cache = deepMerge(DEFAULTS, saved);
  return cache;
}

export function saveConfig(patch) {
  ensureDataDir();
  const cur = getConfig();
  const next = deepMerge(cur, patch);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  cache = next;
  return next;
}

export function publicSettings() {
  const c = getConfig();
  return {
    llm: { baseUrl: c.llm.baseUrl, model: c.llm.model, hasKey: !!c.llm.apiKey },
    interview: c.interview,
  };
}
