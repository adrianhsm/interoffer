// 数据库层：node:sqlite（Node >= 22.5 内置），无需原生编译。
// 表：interviews（面试会话）、messages（对话消息）、settings（键值配置）
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import fs from 'node:fs';

fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'interviews.db');

export const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS interviews (
  id            TEXT PRIMARY KEY,
  mode          TEXT NOT NULL,             -- 'jd' | 'domain'
  domain_id     TEXT,
  jd_text       TEXT,
  role_title    TEXT,                      -- 解析出的岗位名称
  seniority     TEXT,
  plan_json     TEXT,                      -- 面试计划（话题/问题大纲）
  duration_minutes INTEGER DEFAULT 60,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | active | completed | aborted
  total_score   REAL,
  summary       TEXT,
  report_json   TEXT,
  started_at    TEXT,
  ended_at      TEXT,
  duration_s    INTEGER,
  question_count INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,              -- 'assistant' | 'user'
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_iid ON messages(interview_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// 兼容旧库：补列
const cols = db.prepare(`PRAGMA table_info(interviews)`).all().map((c) => c.name);
if (!cols.includes('duration_minutes')) {
  db.exec(`ALTER TABLE interviews ADD COLUMN duration_minutes INTEGER DEFAULT 60`);
}

export function nowIso() {
  return new Date().toISOString();
}

export function insertInterview(row) {
  db.prepare(`INSERT INTO interviews
    (id, mode, domain_id, jd_text, role_title, seniority, plan_json, duration_minutes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.mode, row.domain_id ?? null, row.jd_text ?? null,
    row.role_title ?? null, row.seniority ?? null,
    row.plan_json ? JSON.stringify(row.plan_json) : null,
    row.duration_minutes ?? 60,
    row.status, row.created_at
  );
}

export function getInterview(id) {
  const row = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
  if (!row) return null;
  if (row.plan_json) row.plan_json = JSON.parse(row.plan_json);
  if (row.report_json) row.report_json = JSON.parse(row.report_json);
  return row;
}

export function updateInterview(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => {
    const v = patch[k];
    return v === undefined || v === null ? null : (typeof v === 'object' ? JSON.stringify(v) : v);
  });
  db.prepare(`UPDATE interviews SET ${sets} WHERE id = ?`).run(...vals, id);
}

export function listInterviews() {
  return db.prepare(`
    SELECT id, mode, domain_id, role_title, status, total_score, summary,
           started_at, ended_at, duration_s, question_count, created_at
    FROM interviews ORDER BY created_at DESC
  `).all().map((r) => ({ ...r, total_score: r.total_score === null ? null : Math.round(r.total_score * 10) / 10 }));
}

export function getMessages(id) {
  return db.prepare('SELECT id, role, content, created_at FROM messages WHERE interview_id = ? ORDER BY id').all(id);
}

export function appendMessage(interviewId, role, content) {
  const r = db.prepare('INSERT INTO messages (interview_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(interviewId, role, content, nowIso());
  return r.lastInsertRowid;
}

export function countMessages(interviewId, role) {
  const r = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE interview_id = ? AND role = ?').get(interviewId, role);
  return r.c;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

// 统计：按天 + 按领域聚合（用于图表）
export function statsAggregates() {
  const byDay = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day,
           COUNT(*) AS cnt,
           AVG(total_score) AS avg_score,
           MIN(total_score) AS min_score,
           MAX(total_score) AS max_score
    FROM interviews
    WHERE status = 'completed' AND total_score IS NOT NULL
    GROUP BY day ORDER BY day
  `).all();

  const byDomain = db.prepare(`
    SELECT COALESCE(domain_id, 'jd') AS domain_id,
           COUNT(*) AS cnt,
           AVG(total_score) AS avg_score,
           MIN(total_score) AS min_score,
           MAX(total_score) AS max_score
    FROM interviews
    WHERE status = 'completed' AND total_score IS NOT NULL
    GROUP BY domain_id ORDER BY cnt DESC
  `).all();

  // 维度均分（从 report_json 里解析）
  const dimRows = db.prepare(`
    SELECT domain_id, report_json FROM interviews
    WHERE status = 'completed' AND report_json IS NOT NULL
  `).all();

  const dimAcc = {}; // name -> {sum, cnt, byDomain: {domainId: {sum,cnt}}}
  for (const r of dimRows) {
    let rep;
    try { rep = typeof r.report_json === 'string' ? JSON.parse(r.report_json) : r.report_json; } catch { continue; }
    if (!rep || !Array.isArray(rep.dimensions)) continue;
    for (const d of rep.dimensions) {
      if (typeof d.score !== 'number') continue;
      const name = d.name;
      dimAcc[name] = dimAcc[name] || { sum: 0, cnt: 0, byDomain: {} };
      dimAcc[name].sum += d.score;
      dimAcc[name].cnt += 1;
      const dom = r.domain_id || 'jd';
      dimAcc[name].byDomain[dom] = dimAcc[name].byDomain[dom] || { sum: 0, cnt: 0 };
      dimAcc[name].byDomain[dom].sum += d.score;
      dimAcc[name].byDomain[dom].cnt += 1;
    }
  }
  const dimensions = Object.entries(dimAcc).map(([name, a]) => ({
    name,
    avg: Math.round((a.sum / a.cnt) * 10) / 10,
    byDomain: Object.fromEntries(Object.entries(a.byDomain).map(([d, b]) => [d, Math.round((b.sum / b.cnt) * 10) / 10])),
  })).sort((x, y) => y.avg - x.avg);

  return {
    byTime: byDay.map((d) => ({
      date: d.day, count: d.cnt,
      avg: d.avg_score === null ? null : Math.round(d.avg_score * 10) / 10,
      min: d.min_score === null ? null : Math.round(d.min_score * 10) / 10,
      max: d.max_score === null ? null : Math.round(d.max_score * 10) / 10,
    })),
    byDomain: byDomain.map((d) => ({
      domainId: d.domain_id,
      count: d.cnt,
      avg: d.avg_score === null ? null : Math.round(d.avg_score * 10) / 10,
      min: d.min_score === null ? null : Math.round(d.min_score * 10) / 10,
      max: d.max_score === null ? null : Math.round(d.max_score * 10) / 10,
    })),
    dimensions,
  };
}
