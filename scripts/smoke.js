// 端到端冒烟测试：mock 模式下走完整流程（创建→开始→对话→结束→评价→统计→设置）
import { DatabaseSync } from 'node:sqlite';
const BASE = process.env.BASE || 'http://127.0.0.1:3210';

// 测试前清理数据，保证可重复运行
try {
  const p = new URL('../server/data/interviews.db', import.meta.url).pathname;
  const dbPath = process.platform === 'win32' ? p.replace(/^\/([A-Za-z]:)/, '$1') : p;
  const db = new DatabaseSync(dbPath);
  db.exec('DELETE FROM messages; DELETE FROM interviews;');
  db.close();
  console.log('== 0. 已清理测试数据 ==');
} catch (e) {
  console.log('（数据清理跳过:', e.message, '）');
}

async function j(method, url, body) {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Connection: 'close',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function assert(cond, msg) {
  if (!cond) throw new Error('断言失败: ' + msg);
  console.log('  ✔', msg);
}

async function main() {
  console.log('== 1. 健康检查 ==');
  const health = await j('GET', '/health');
  assert(health.ok === true, 'health ok');

  console.log('\n== 2. 领域列表 ==');
  const domains = await j('GET', '/domains');
  assert(domains.length === 5, `5 个预设领域 (${domains.map((d) => d.name).join(', ')})`);

  console.log('\n== 3. 创建领域面试 ==');
  const iv1 = await j('POST', '/interviews', { mode: 'domain', domainId: 'backend-java' });
  assert(iv1.id && iv1.status === 'pending', '面试已创建');
  assert(iv1.plan_json && iv1.plan_json.topics.length >= 3, `计划包含 ${iv1.plan_json.topics.length} 个话题`);
  console.log('   岗位:', iv1.role_title, '| 计划摘要:', iv1.plan_json.planSummary);

  console.log('\n== 4. 创建 JD 面试 ==');
  const jd = `【高级前端工程师】\n岗位职责：负责核心业务前端架构与开发，主导技术评审，优化性能使首屏 < 1.5s；建设工程化体系。\n任职要求：5 年以上前端经验，精通 React/TypeScript，深入理解浏览器渲染、性能优化，有组件库/微前端经验者优先。`;
  const iv2 = await j('POST', '/interviews', { mode: 'jd', jdText: jd });
  assert(iv2.plan_json && iv2.plan_json.topics.length >= 3, 'JD 解析出面试计划');

  console.log('\n== 5. 开始面试 ==');
  const started = await j('POST', `/interviews/${iv1.id}/start`);
  assert(started.status === 'active', '状态 active');
  assert(started.messages.length === 1 && started.messages[0].role === 'assistant', '已有开场白');
  console.log('   开场白:', started.messages[0].content.slice(0, 60) + '…');

  console.log('\n== 6. 流式对话（3 轮） ==');
  const answers = [
    '我叫张三，有 5 年 Java 后端经验，最近在做订单中台项目，负责交易链路重构，把单接口 QPS 从 800 提升到 5000，主要用了缓存、异步削峰和读写分离。',
    '追问回答：缓存用了 Redis 加本地 Caffeine 两级缓存，通过版本号保证一致性；异步用的是 RocketMQ，削峰填谷，重试带幂等。',
    '我认为排查线上问题要分层：先看监控和日志定位影响面，再按网络、DB、应用三个方向二分，我通常会先查慢查询和连接池指标。',
  ];
  let lastReply = '';
  for (let i = 0; i < answers.length; i++) {
    const res = await fetch(`${BASE}/api/interviews/${iv1.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ content: answers[i] }),
    });
    assert(res.ok, `第 ${i + 1} 轮 SSE 请求成功 (${res.status})`);
    const text = await res.text();
    const tokens = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => {
      try { return JSON.parse(l.slice(5).trim()); } catch { return null; }
    }).filter(Boolean);
    const hasStart = tokens.some((t) => t.type === 'start');
    const hasDone = tokens.some((t) => t.type === 'done');
    assert(hasStart && hasDone, `第 ${i + 1} 轮收到 start + done 事件`);
    lastReply = tokens.filter((t) => t.type === 'token').map((t) => t.text).join('');
    assert(lastReply.length > 10, `第 ${i + 1} 轮面试官回复 ${lastReply.length} 字`);
    console.log(`   第 ${i + 1} 轮面试官:`, lastReply.replace(/\n/g, ' ').slice(0, 70) + '…');
  }

  console.log('\n== 7. 结束并生成评价 ==');
  const ended = await j('POST', `/interviews/${iv1.id}/end`, {});
  const rep = ended.report || {};
  assert(typeof rep.overallScore === 'number' && rep.overallScore >= 0 && rep.overallScore <= 100, `总评分 ${rep.overallScore}`);
  assert(Array.isArray(rep.dimensions) && rep.dimensions.length >= 3, `维度 ${rep.dimensions.length} 个`);
  assert(rep.strengths.length >= 2 && rep.weaknesses.length >= 2 && rep.suggestions.length >= 2, '优缺点与建议齐全');
  assert(['hire', 'weak_hire', 'no'].includes(rep.verdict), `结论: ${rep.verdict}`);
  console.log('   评分:', rep.overallScore, '| 结论:', rep.verdict, '|', rep.verdictNote);
  console.log('   优点示例:', rep.strengths[0]);

  console.log('\n== 8. 历史列表 ==');
  const list = await j('GET', '/interviews');
  assert(list.length === 2, `共 ${list.length} 条记录`);
  const done1 = list.find((r) => r.id === iv1.id);
  assert(done1.status === 'completed' && done1.total_score === rep.overallScore, '列表含评分');

  console.log('\n== 9. 统计 ==');
  const stats = await j('GET', '/stats');
  assert(stats.byDomain.length >= 1, '按领域聚合');
  assert(stats.byTime.length >= 1, '按时间聚合');
  assert(stats.dimensions.length >= 3, '维度均分聚合');
  console.log('   领域:', JSON.stringify(stats.byDomain));

  console.log('\n== 10. 设置读写 ==');
  const before = await j('GET', '/settings');
  await j('PUT', '/settings', { interview: { durationMinutes: 45 } });
  const after = await j('GET', '/settings');
  assert(after.interview.durationMinutes === 45, '设置已持久化');
  await j('PUT', '/settings', { interview: { durationMinutes: before.interview.durationMinutes } });

  console.log('\n🎉 全部冒烟测试通过！');
  process.exit(0);
}

main().catch((e) => { console.error('\n❌ 冒烟测试失败:', e.message); process.exit(1); });
