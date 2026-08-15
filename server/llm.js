// LLM 客户端：OpenAI 兼容 Chat Completions（流式）。
// 未配置 apiKey 时自动进入内置 mock 模式（离线可用，用于演示/测试）。
import { getConfig } from './config.js';

export function isMock() {
  const { llm } = getConfig();
  return !llm.apiKey || llm.apiKey.trim() === '';
}

// ---------- 底层请求 ----------

async function requestLLM(messages, { stream = false, onToken, json = false, temperature } = {}) {
  const { llm } = getConfig();
  const body = {
    model: llm.model,
    messages,
    stream,
    temperature: temperature ?? llm.temperature,
  };
  if (json && !stream) {
    // 部分兼容服务不支持 response_format，故同时用指令约束 + 宽松解析兜底
    body.response_format = { type: 'json_object' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), llm.timeoutMs || 120000);
  try {
    const res = await fetch(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!stream) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      return json ? parseJsonLoose(content) : content;
    }
    // 流式：逐段解析 SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const delta = obj?.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            if (onToken) onToken(delta);
          }
        } catch { /* 忽略无法解析的帧 */ }
      }
    }
    return full;
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonLoose(text) {
  if (!text) return null;
  let t = text.trim();
  // 去掉 ```json ... ``` 围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

// ---------- 预设领域知识 ----------

export const DOMAINS = [
  {
    id: 'frontend',
    name: '前端工程师',
    icon: '🎨',
    desc: 'HTML/CSS/JS、React/Vue、工程化、性能优化、浏览器原理',
    skills: ['React', 'Vue', 'TypeScript', 'JavaScript', 'CSS', '性能优化', 'Webpack', 'Vite', '浏览器', 'HTTP', '组件设计'],
  },
  {
    id: 'backend-java',
    name: '后端工程师（Java）',
    icon: '☕',
    desc: 'Java 基础、Spring 生态、JVM、并发、分布式、数据库',
    skills: ['Java', 'Spring', 'Spring Boot', 'JVM', '并发', '多线程', 'MySQL', 'Redis', '分布式', '消息队列', '微服务', 'MyBatis'],
  },
  {
    id: 'architect',
    name: '软件系统架构师',
    icon: '🏗️',
    desc: '系统设计、微服务/分布式架构、高可用、容量规划、技术选型',
    skills: ['架构设计', '微服务', '分布式', '高可用', '高并发', '系统设计', '技术选型', '容量规划', 'DDD', '性能', '容灾'],
  },
  {
    id: 'agent-engineer',
    name: 'Agent 工程师',
    icon: '🤖',
    desc: 'LLM 应用、Prompt/Function Calling、RAG、Agent 框架与多智能体编排',
    skills: ['LLM', '大模型', 'Prompt', 'RAG', 'Agent', 'Function Calling', '工具调用', '多智能体', 'LangChain', '向量检索', 'MCP', 'ReAct'],
  },
  {
    id: 'robot-software',
    name: '机器人软件工程师',
    icon: '🦾',
    desc: 'ROS2、运动控制、SLAM、感知融合、实时系统、C++/Python',
    skills: ['ROS', 'ROS2', 'C++', 'Python', '运动控制', 'SLAM', '感知', '传感器', '实时系统', '嵌入式', 'CAN', 'EtherCAT', '机器人'],
  },
];

export function getDomain(id) {
  return DOMAINS.find((d) => d.id === id) || null;
}

// ---------- 面试计划生成 ----------

export async function generatePlan({ mode, domainId, jdText }) {
  if (isMock()) {
    const dom = getDomain(domainId);
    const skills = (jdText ? extractSkillsFromJd(jdText) : dom?.skills || []).slice(0, 8);
    return mockPlan(mode, domainId, jdText, dom, skills);
  }
  const dom = getDomain(domainId);
  const sys = `你是资深的招聘技术专家。你的任务是根据面试目标制定一份约 60 分钟的模拟面试计划。
直接输出 JSON，不要输出任何其他内容。JSON 结构：
{
  "roleTitle": "岗位名称",
  "seniority": "职级判断（如 初级/中级/高级/资深）",
  "planSummary": "一句话描述面试考察重点",
  "topics": [
    {"name":"话题名", "questions": ["具体问题1", "具体问题2", "具体问题3"]}
  ]
}
要求：问题具体、有区分度、贴近真实面试；话题覆盖基础、实战、深挖、开放设计题；总计 8~14 个问题。`;
  const user = mode === 'jd'
    ? `以下是候选人提供的职位需求（JD），请解析并据此制定面试计划：\n"""\n${jdText}\n"""`
    : `请针对「${dom.name}」岗位制定面试计划。该领域核心技能：${dom.skills.join('、')}。`;
  const data = await requestLLM([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true });
  if (!data || !Array.isArray(data.topics)) {
    // 兜底
    return mockPlan(mode, domainId, jdText, dom, (dom?.skills || []).slice(0, 8));
  }
  return {
    roleTitle: data.roleTitle || dom?.name || '目标岗位',
    seniority: data.seniority || '中级',
    planSummary: data.planSummary || '',
    skills: dom?.skills || (jdText ? extractSkillsFromJd(jdText) : []),
    topics: data.topics.slice(0, 6).map((t) => ({
      name: t.name,
      questions: (Array.isArray(t.questions) ? t.questions : []).slice(0, 5),
    })),
  };
}

function extractSkillsFromJd(jd) {
  // 简单从 JD 文本中捞取技能关键词（与预设领域技能表做交集）
  const all = DOMAINS.flatMap((d) => d.skills);
  const lower = jd.toLowerCase();
  return all.filter((s) => lower.includes(s.toLowerCase()));
}

export function mockPlan(mode, domainId, jdText, dom, skills) {
  const roleTitle = mode === 'jd'
    ? (jdText ? jdText.split('\n').find((l) => l.includes('岗位') || l.includes('职位') || l.includes('招聘'))?.replace(/[#*\s]/g, '').slice(0, 20) || '目标岗位' : '目标岗位')
    : dom?.name || '目标岗位';
  const topicBank = [
    { name: '自我介绍与项目深挖', q: (s) => [`请先做 2 分钟自我介绍，重点说明与你应聘岗位最相关的经历。`, `挑一个你最有成就感的项目，讲讲你的角色、技术难点和最终结果。`, `（追问）如果现在重做这个项目，哪些地方你会做得不一样？`] },
    { name: '核心技能考核', q: (s) => [`围绕 ${s.slice(0, 3).join('、')}，说说你在实际项目中最深的一次技术实践。`, `（追问）这个技术的底层原理是什么？能讲到什么深度？`] },
    { name: '实战场景题', q: (s) => [`线上出了故障（可以是性能问题/数据问题），你会按什么思路排查和解决？`, `（追问）如何避免这类问题再次发生？`] },
    { name: '开放设计题', q: (s) => [`如果让你从零设计一个 ${roleTitle} 相关的核心模块，你会怎么设计？`] },
    { name: '软素质与成长', q: () => [`你最近一年最大的技术成长是什么？是怎么获得的？`, `你对自己的短板有清醒认识吗？打算怎么补？`] },
    { name: '反问环节', q: () => [`面试到这里，你有什么想问我的？（关于团队、业务、技术栈都可以）`] },
  ];
  const topics = topicBank.map((t, i) => ({
    name: t.name,
    questions: t.q(skills).slice(0, i === 0 ? 3 : 2),
  }));
  return { roleTitle, seniority: '中级', skills, planSummary: `重点考察：${skills.slice(0, 4).join('、')} 相关的项目经验、技术深度与问题解决能力。`, topics };
}

// ---------- 严格面试官 ----------

export function interviewerSystemPrompt(interview, elapsedSec, totalSec) {
  const plan = interview.plan_json || { roleTitle: interview.role_title || '目标岗位', topics: [] };
  const topicsText = plan.topics.map((t, i) => `${i + 1}.【${t.name}】\n   - ${t.questions.join('\n   - ')}`).join('\n');
  const remainMin = Math.max(0, Math.round((totalSec - elapsedSec) / 60));
  return `你是「${plan.roleTitle || '目标岗位'}」岗位面试中一位极其严格的资深面试官，面试总时长约 ${Math.round(totalSec / 60)} 分钟。

## 面试要求（必须遵守）
1. 严格：像真实大厂面试官一样，不轻易放过模糊回答。回答浅薄时，必须连续追问 2~3 轮，逼出深度（"具体是怎么实现的？""底层原理是什么？""数据量多大？如何权衡？"）。
2. 一次只问一个问题，不要一次性抛多个问题。问题要具体、可回答，不要泛泛而谈。
3. 每轮根据候选人回答给出极简点评（1 句话，指出亮点或不足），然后继续提问。全程中文。
4. 话题覆盖要按面试计划走，但也允许根据回答自然延伸（追问）。
5. 全程保持专业、犀利但公平的语气，可以适当施压，不做无意义的寒暄。

## 面试计划
${topicsText}

## 时间管理
- 剩余约 ${remainMin} 分钟。
- 剩余时间 > 15 分钟：正常推进计划，遇到薄弱回答要深挖。
- 剩余时间 5~15 分钟：加快节奏，转向开放设计题/反问环节。
- 剩余时间 < 5 分钟：开始收尾——感谢候选人参与，简要说明后续流程（如"2~3 个工作日内会有反馈"），并明确表示面试结束。此时不要再提问新问题。

## 输出
只输出你作为面试官要说的话本身（正文），不要输出"面试官："等前缀，不要输出解释或计划。
`;
}

// ---------- 面试官对话（一轮） ----------

export async function interviewerReply({ interview, messages, elapsedSec, totalSec, onToken }) {
  if (isMock()) {
    return mockInterviewerReply({ interview, messages, elapsedSec, totalSec, onToken });
  }
  const sys = interviewerSystemPrompt(interview, elapsedSec, totalSec);
  const history = messages.map((m) => ({ role: m.role, content: m.content }));
  const full = [...history.slice(-16)]; // 只看最近 16 条，控制上下文
  if (history.length > 16) {
    // 在上下文里放一个最早的梗概，避免完全丢失早期信息
    const early = history.slice(0, -15);
    full.unshift({
      role: 'system',
      content: `（对话前情摘要）此前已进行的对话轮次，主要涉及：${early.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 60)).join('；').slice(0, 400)}`,
    });
  }
  const stream = !!onToken;
  return requestLLM([{ role: 'system', content: sys }, ...full], { stream, onToken });
}

// ---------- 评价生成 ----------

export async function generateEvaluation({ interview, messages, durationSec }) {
  if (isMock()) {
    return mockEvaluation({ interview, messages, durationSec });
  }
  const plan = interview.plan_json || {};
  const transcript = messages.map((m, i) => `${m.role === 'user' ? '候选人' : '面试官'}（第${i + 1}条）：${m.content}`).join('\n');
  const sys = `你是一位极其严格的资深面试官，刚刚完成了一场约 ${Math.max(1, Math.round(durationSec / 60))} 分钟的模拟面试。
现在请你从面试官视角给出专业、犀利、可操作的面试评价。只输出 JSON，不要输出其他内容。
JSON 结构：
{
  "overallScore": 0到100的整数（严格给分，一般集中在55~88之间，只有极优秀才给90+）,
  "summary": "200字以内的总体评价，包括整体印象、是否符合岗位要求、是否建议录用",
  "verdict": "hire | weak_hire | no",
  "verdictNote": "一句话结论，如：建议推进/基本达到要求但需补强XX/不推荐，原因是……",
  "dimensions": [
    {"name": "维度名", "score": 0到100整数, "comment": "一句评语"}
  ],
  "strengths": ["3~5条优点，每条一句话"],
  "weaknesses": ["3~5条不足，每条一句话，直指要害"],
  "suggestions": ["3~5条具体改进建议，可执行"]
}
维度从以下列表中选 5~7 个（匹配岗位方向）：
技术深度、基础扎实度、项目经验、问题分析与解决、系统设计能力、沟通表达、逻辑思维、学习与成长潜力、岗位匹配度、抗压与应变。
评分要拉开差距，指出真实的不足，不要和稀泥。`;

  const user = `【面试计划】\n${JSON.stringify(plan, null, 2)}\n\n【完整面试记录】\n${transcript.slice(0, 30000)}`;
  const data = await requestLLM([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true });
  return normalizeReport(data, plan);
}

function normalizeReport(data, plan) {
  if (!data) return null;
  const dims = Array.isArray(data.dimensions) ? data.dimensions.map((d) => ({
    name: d.name || '维度',
    score: clampScore(d.score),
    comment: d.comment || '',
  })).slice(0, 7) : [];
  return {
    overallScore: clampScore(data.overallScore),
    summary: data.summary || '',
    verdict: ['hire', 'weak_hire', 'no'].includes(data.verdict) ? data.verdict : 'weak_hire',
    verdictNote: data.verdictNote || '',
    dimensions: dims,
    strengths: (data.strengths || []).slice(0, 5),
    weaknesses: (data.weaknesses || []).slice(0, 5),
    suggestions: (data.suggestions || []).slice(0, 5),
    roleTitle: plan.roleTitle || '目标岗位',
  };
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 60;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// ---------- Mock 实现（无 API Key 时） ----------

function flattenPlanQuestions(plan) {
  const out = [];
  for (const t of (plan?.topics || [])) {
    for (const q of (t.questions || [])) out.push({ topic: t.name, q });
  }
  return out;
}

export async function mockInterviewerReply({ interview, messages, elapsedSec, totalSec, onToken }) {
  const plan = interview.plan_json || {};
  const qs = flattenPlanQuestions(plan);
  const asked = messages.filter((m) => m.role === 'assistant').length;
  const userCount = messages.filter((m) => m.role === 'user').length;
  const lastUser = messages.filter((m) => m.role === 'user').pop()?.content || '';
  const remainMin = (totalSec - elapsedSec) / 60;
  const skills = plan.skills || [];

  let text;
  if (userCount === 0) {
    text = `你好，我是本次「${plan.roleTitle || '目标岗位'}」岗位模拟面试的面试官。接下来约 ${Math.round(totalSec / 60)} 分钟，我会按真实面试的节奏进行。先做个 2 分钟自我介绍吧，重点讲讲和你应聘方向最相关的经历。`;
  } else {
    // 对上一轮回答做点评
    const depth = countDepth(lastUser);
    const comment = depth >= 3
      ? '回答有细节、有落地，这部分我比较认可。'
      : depth >= 1
        ? '方向是对的，但缺少具体细节和量化结果，我们再往下挖一层。'
        : '太笼统了。请给出具体的技术方案、数据或例子，不要停留在概念层面。';
    const qi = asked; // 当前已问数量作为下一个问题的下标
    const q = qs[qi];
    if (!q || remainMin < 4) {
      text = `${comment} 时间关系，我们进入收尾。整体来说，${verdictFromScore(72)}。感谢你参加今天的面试，2~3 个工作日内会有进一步反馈。面试结束。`;
    } else {
      text = `${comment}\n\n下一个问题（${q.topic}）：${q.q}`;
    }
  }
  if (onToken) {
    for (const ch of text) onToken(ch);
  }
  return text;
}

function countDepth(text) {
  if (!text) return 0;
  let d = 0;
  if (text.length > 120) d += 1;
  if (text.includes('```') || /\b\d+(\.\d+)?\s*(ms|s|qps|万|亿|ms|%)./.test(text)) d += 1;
  if (/(因为|所以|首先|其次|最后|方案|实现|原理|排查|定位|优化|架构)/.test(text)) d += 1;
  return d;
}

export async function mockEvaluation({ interview, messages, durationSec }) {
  const plan = interview.plan_json || {};
  const skills = plan.skills || [];
  const userMsgs = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const totalLen = userMsgs.reduce((s, m) => s + m.length, 0);
  const avgLen = userMsgs.length ? totalLen / userMsgs.length : 0;
  const joined = userMsgs.join('\n');
  const hits = skills.filter((s) => joined.includes(s)).length;
  const depthRatio = userMsgs.length ? userMsgs.filter((m) => countDepth(m) >= 2).length / userMsgs.length : 0;
  const hasCode = joined.includes('```') || /[;{}()]/.test(joined);
  const base = Math.round(45 + Math.min(30, avgLen / 8) + hits * 2.5 + depthRatio * 8 + (hasCode ? 4 : 0));
  const overall = clampScore(base);

  const dim = (name, score, comment) => ({ name, score: clampScore(score), comment });
  const dims = [
    dim('技术深度', overall - 3 + (hits > 3 ? 4 : 0), hits > 3 ? '对核心技能有实际项目经验，能讲出细节。' : '技能覆盖面有限，多个关键技术点回答停留在表面。'),
    dim('项目经验', overall - 2, avgLen > 100 ? '项目讲述有结构，有结果导向的表达。' : '项目描述偏笼统，缺少量化指标和难点复盘。'),
    dim('问题分析与解决', overall + 2, depthRatio > 0.4 ? '面对追问能给出排查思路和方案取舍。' : '遇到追问容易停留在概念层，缺少分层拆解。'),
    dim('沟通表达', overall - 1, avgLen > 80 ? '表达流畅，逻辑清晰。' : '回答偏短，信息密度低，建议结构化输出。'),
    dim('岗位匹配度', Math.round(overall * 0.9 + hits * 3), `${skills.slice(0, 4).join('/')} 等方向的匹配度${hits >= 3 ? '较好' : '一般'}。`),
  ];

  const strengths = [];
  if (avgLen > 60) strengths.push('回答有一定信息量，能够围绕问题展开讲述。');
  if (hits >= 1) strengths.push(`对 ${skills.slice(0, 3).join('、')} 等核心技能有一定接触或项目实践。`);
  if (hasCode) strengths.push('能给出代码/方案级别的回答，落地性强。');
  if (depthRatio > 0.3) strengths.push('面对深挖追问能保持思路清晰。');
  if (strengths.length < 2) strengths.push('态度端正，愿意配合面试节奏。');
  if (strengths.length > 4) strengths.length = 4;

  const weaknesses = [];
  if (avgLen < 80) weaknesses.push('回答普遍偏短，信息量不足，容易让面试官认为深度不够。');
  if (hits < 3) weaknesses.push(`与岗位核心技能（${skills.slice(0, 3).join('、')}）相关的高价值项目经验不足。`);
  if (!hasCode) weaknesses.push('缺少代码/方案级的具体呈现，难以证明动手能力。');
  if (depthRatio <= 0.4) weaknesses.push('追问压力下容易泛泛而谈，缺少分层的分析框架。');
  if (weaknesses.length < 2) weaknesses.push('部分回答缺少量化结果（数据、耗时、收益），说服力打折。');

  const suggestions = [
    '用 STAR 法则重新组织 2~3 个核心项目故事，每个都带上量化指标。',
    `针对 ${skills.slice(0, 3).join('、')} 各准备一个"最深层原理"回答（能讲到源码/协议/实现机制一级）。`,
    '练习被连续追问：每次回答后主动预判"面试官会追问哪里"，提前准备。',
    '面试中多用"结论先行 + 分层展开 + 举例佐证"的结构化表达。',
  ].slice(0, 4);

  const overallF = clampScore(overall);
  return {
    overallScore: overallF,
    summary: `本场模拟面试共 ${userMsgs.length} 轮问答，整体表现${overallF >= 80 ? '良好' : overallF >= 65 ? '中等偏上' : '中等'}。技术面${hits >= 3 ? '有一定实战积累' : '广度不足'}，${avgLen < 80 ? '表达信息密度偏低' : '表达较完整'}，在追问环节${depthRatio > 0.4 ? '能稳住阵脚' : '容易浮于表面'}。综合判断${overallF >= 80 ? '接近可录用水准' : overallF >= 65 ? '达到基础线，仍有明显短板' : '距离岗位要求还有差距'}。`,
    verdict: overallF >= 80 ? 'hire' : overallF >= 65 ? 'weak_hire' : 'no',
    verdictNote: overallF >= 80 ? '建议推进，保持优势，补齐细节。' : overallF >= 65 ? '基本达到要求，但需重点补强短板后再战。' : '不推荐本轮通过，建议按建议清单系统准备后再来。',
    dimensions: dims,
    strengths,
    weaknesses,
    suggestions,
    roleTitle: plan.roleTitle || '目标岗位',
  };
}

function verdictFromScore(s) {
  if (s >= 80) return '整体表现不错';
  if (s >= 65) return '有一定基础，但还需要加强';
  return '距离岗位要求还有明显差距';
}