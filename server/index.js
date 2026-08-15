// interOffer 服务入口：API + 前端静态资源（生产） / Vite 中间件（开发）
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { isMock } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.PORT || 3210);
const isDev = process.env.NODE_ENV === 'development';

const app = express();
app.use(express.json({ limit: '5mb' }));

// 简单请求日志
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`);
    }
  });
  next();
});

app.use('/api', api);

if (isDev) {
  // 开发模式：用 Vite 中间件提供前端热更新
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: path.join(ROOT, 'client'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // SPA 回退
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('前端尚未构建：请先运行 `npm run build` 或使用 `npm run dev`。'));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`\n  🎯 interOffer AI 模拟面试系统已启动`);
  console.log(`  ➜ 本地访问: http://127.0.0.1:${PORT}`);
  console.log(`  ➜ LLM 模式: ${isMock() ? '内置 Mock 面试官（未配置 API Key，离线可跑）' : 'OpenAI 兼容接口'}`);
  console.log(`  ➜ 数据目录: ${path.join(__dirname, 'data')}\n`);
});
