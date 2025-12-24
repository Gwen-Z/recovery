import express from 'express';
import AIService from '../services/ai-service.js';
import { ANALYSIS_V3_CHART_STRATEGY } from '../lib/analysisV3ChartStrategy.js';

const ANALYSIS_TTL_MS = 15 * 60 * 1000;
const analysisCache = new Map();

const buildAnalysisId = () => `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const KNOWN_NOTEBOOK_TYPES = new Set(['mood', 'life', 'study', 'work', 'finance', 'ai']);

const inferNotebookTypeFromName = (name = '') => {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  if (n.includes('心情') || n.includes('情绪') || n.includes('mood')) return 'mood';
  if (n.includes('财经') || n.includes('金融') || n.includes('投资') || n.includes('股票') || n.includes('基金') || n.includes('crypto') || n.includes('加密')) return 'finance';
  if (n.includes('ai') || n.includes('a.i') || n.includes('模型') || n.includes('llm') || n.includes('大模型')) return 'ai';
  if (n.includes('学习') || n.includes('读书') || n.includes('课程') || n.includes('study')) return 'study';
  if (n.includes('工作') || n.includes('项目') || n.includes('okr') || n.includes('work')) return 'work';
  if (n.includes('生活') || n.includes('日记') || n.includes('随记') || n.includes('life')) return 'life';
  return null;
};

const inferNotebookTypeFromNotes = (notes = []) => {
  const parsedNotes = Array.isArray(notes) ? notes : [];
  if (!parsedNotes.length) return null;
  const moodKeywords = ['心情', '情绪', '焦虑', '开心', '难过', '抑郁', '压力', '崩溃', '低落', '放松'];
  const financeKeywords = ['美股', 'a股', '港股', '基金', 'etf', 'fomc', '加息', '降息', '通胀', 'cpi', 'pmi', '财报', '收益', '利率', '央行', '美联储', '比特币', 'btc', 'eth', 'crypto', '大盘', '纳指', '标普', '道指'];
  const aiKeywords = ['openai', 'claude', 'gpt', 'llm', '大模型', 'agent', '推理', '多模态', 'benchmark', 'prompt', 'rag', 'token', 'api', '发布', '模型', '微调', 'sft'];
  let hits = 0;
  let total = 0;
  let financeHits = 0;
  let aiHits = 0;
  parsedNotes.slice(0, 50).forEach((note) => {
    const text = buildNoteText(note);
    if (!text) return;
    total += 1;
    if (moodKeywords.some((kw) => text.includes(kw))) hits += 1;
    const lowered = text.toLowerCase();
    if (financeKeywords.some((kw) => lowered.includes(kw))) financeHits += 1;
    if (aiKeywords.some((kw) => lowered.includes(kw))) aiHits += 1;
  });
  if (total >= 3 && hits / total >= 0.3) return 'mood';
  if (total >= 3 && financeHits / total >= 0.25) return 'finance';
  if (total >= 3 && aiHits / total >= 0.25) return 'ai';
  return null;
};

const resolveNotebookType = (notebook, notes = []) => {
  const raw = String(notebook?.type || '').trim();
  if (KNOWN_NOTEBOOK_TYPES.has(raw)) return raw;
  return inferNotebookTypeFromName(notebook?.name) || inferNotebookTypeFromNotes(notes) || 'custom';
};

const buildInsightsPrompt = (notebookType) => {
  const baseRules = [
    '你是个人笔记分析助手。',
    '只输出三段内容，中文；不要输出额外解释。',
    '第1段必须是“结论式判断”，不要只是复述。',
    '第1段必须包含判断性词语之一：当前最明显的特征是 / 核心特征是 / 当前最值得注意的是。',
    '第2段必须包含一个对比锚点之一：相比更早阶段 / 相比你过往的记录习惯 / 相比同一主题的历史表现。',
    '第3段为“下一步可能性”，必须站在用户目标视角，避免产品使用说明（如：打标签/为了图表调整行为）。',
    '语气温和，不要命令式；监控类避免强建议。'
  ];

  const suggestionGuidance = (() => {
    if (['finance', 'ai', 'study'].includes(String(notebookType))) {
      return [
        '本次为知识型笔记：第3段以学习/成长路径为主。',
        '第3段必须分为三段（用换行分隔）：',
        '第1段：一句话说明你当前的学习重心/关注点（顺畅表达）。',
        '第2段：以“为了……可以尝试：”开头，承接第1段。',
        '第3段：用 1. / 2. 各占一行列出 1–2 条具体方向。',
        '不要出现“阶段：/下一步：/因为：”等总结词。'
      ];
    }
    if (String(notebookType) === 'mood') {
      return [
        '本次为心情/状态笔记：第3段以状态影响/自我觉察为主。',
        '第3段写成顺畅表达：描述状态→可能影响→自我觉察方向，不要出现“状态：/影响：/觉察：”等总结词。'
      ];
    }
    return [
      '本次为通用/未识别类型：第3段给1-2条温和、可执行的下一步可能性。',
      '第3段写成顺畅表达：一句方向 + 一句原因，不要出现“方向：/原因：”等总结词。'
    ];
  })();

  return [
    ...baseRules,
    ...suggestionGuidance,
    '',
    '长度约束：第1段≤80字，第2段≤80字，第3段≤220字。',
    '请严格按以下格式输出：',
    '1. 主要洞察：',
    '<一句话结论>',
    '2. 变化趋势：',
    '<一句话趋势>',
    '3. 建议：',
    '<一句话下一步可能性>'
  ].join('\n');
};

const toUnixSeconds = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
};

const normalizeTimeRange = (input = {}) => {
  const preset = String(input?.preset || '7d');
  const now = new Date();
  if (preset === 'custom') {
    const from = input?.from ? new Date(input.from) : null;
    const to = input?.to ? new Date(`${input.to}T23:59:59`) : null;
    return {
      preset,
      from: from && !Number.isNaN(from.getTime()) ? from : null,
      to: to && !Number.isNaN(to.getTime()) ? to : null
    };
  }

  const days = preset === '90d' ? 90 : preset === '30d' ? 30 : 7;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { preset, from, to: now };
};

const mapNoteType = (notebookType) => {
  const allowed = ['monitoring', 'developmental', 'archive'];
  if (allowed.includes(notebookType)) return notebookType;
  return 'developmental';
};

const MOOD_EVENT_PRESETS = [
  { label: '工作', keywords: ['工作', '项目', '加班', '老板', '同事', '任务'] },
  { label: '朋友', keywords: ['朋友', '同学', '聚会', '社交', '聊天'] },
  { label: '家人', keywords: ['家人', '父母', '孩子', '家庭'] },
  { label: '健康', keywords: ['健康', '身体', '锻炼', '运动', '生病'] },
  { label: '成长', keywords: ['学习', '成长', '自我', '阅读'] }
];

const detectMoodEventType = (text) => {
  if (!text) return '其他';
  const lowered = text.toLowerCase();
  for (const preset of MOOD_EVENT_PRESETS) {
    const hit = preset.keywords.some(
      (keyword) => lowered.includes(keyword) || text.includes(keyword)
    );
    if (hit) return preset.label;
  }
  return '其他';
};

const buildNoteText = (note) => {
  if (!note) return '';
  const componentText = Object.values(note.component_data || {})
    .map((value) => {
      if (value && typeof value === 'object') {
        if (typeof value.value === 'string') return value.value;
        if (typeof value.text === 'string') return value.text;
      }
      return typeof value === 'string' ? value : '';
    })
    .filter(Boolean)
    .join(' ');
  return [note.title, note.content_text, componentText].filter(Boolean).join(' ');
};

const FINANCE_TOPIC_PRESETS = [
  { label: '宏观', keywords: ['cpi', 'pmi', '通胀', '利率', '加息', '降息', '美联储', '央行', 'fomc', '就业', '宏观'] },
  { label: '美股', keywords: ['美股', '纳指', '标普', '道指', 'nasdaq', 's&p', 'dow', 'spx', 'ndx'] },
  { label: 'A股/港股', keywords: ['a股', '沪深', '上证', '深证', '港股', '恒生', '科创'] },
  { label: 'AI/科技', keywords: ['ai', '大模型', 'gpt', 'openai', 'claude', '英伟达', 'nvda', '芯片', '半导体', '科技'] },
  { label: 'Crypto', keywords: ['crypto', '比特币', 'btc', '以太坊', 'eth', 'sol', '链上'] },
  { label: 'ETF/基金', keywords: ['etf', '基金', '指数基金', '主动基金'] },
  { label: '公司财报', keywords: ['财报', '业绩', '营收', '利润', '指引', 'earnings'] },
  { label: '政策/监管', keywords: ['政策', '监管', '财政', '税', '法案', '制裁'] }
];

const AI_TOPIC_PRESETS = [
  { label: '模型发布', keywords: ['发布', '上线', 'new model', 'release', '更新', 'openai', 'anthropic', 'google', 'meta', 'gpt', 'claude', 'gemini', 'llama'] },
  { label: '能力评测', keywords: ['benchmark', '评测', '榜单', 'sota', 'mmlu', 'math', 'arena', '对比'] },
  { label: '应用/产品', keywords: ['应用', '产品', '工具', '插件', 'copilot', 'agent', 'workflow', '落地'] },
  { label: '技术方案', keywords: ['rag', '向量', '检索', '微调', 'sft', '训练', '推理', 'token', 'prompt', '多模态'] },
  { label: '行业/商业', keywords: ['融资', '商业化', '成本', '价格', '生态', 'to b', 'to c', '市场'] }
];

const STOP_TICKERS = new Set(['AI', 'ETF', 'FOMC', 'CPI', 'PMI', 'USD', 'US', 'CN', 'HK', 'IPO', 'CEO']);

const classifyByPresets = (text, presets) => {
  const lowered = String(text || '').toLowerCase();
  for (const preset of presets || []) {
    const hit = (preset.keywords || []).some((kw) => lowered.includes(String(kw).toLowerCase()));
    if (hit) return preset.label;
  }
  return '其他';
};

const extractEntities = (text, { mode }) => {
  const t = String(text || '');
  const lowered = t.toLowerCase();
  const entities = new Set();

  const addIfHit = (label, keywords) => {
    if (entities.size >= 10) return;
    const hit = (keywords || []).some((kw) => lowered.includes(String(kw).toLowerCase()));
    if (hit) entities.add(label);
  };

  if (mode === 'finance') {
    addIfHit('英伟达', ['nvda', '英伟达']);
    addIfHit('特斯拉', ['tsla', '特斯拉']);
    addIfHit('苹果', ['aapl', '苹果']);
    addIfHit('微软', ['msft', '微软']);
    addIfHit('标普500', ['spx', '标普', 's&p']);
    addIfHit('纳斯达克', ['ndx', '纳指', 'nasdaq']);
    addIfHit('比特币', ['btc', '比特币']);
    addIfHit('以太坊', ['eth', '以太坊']);
  } else if (mode === 'ai') {
    addIfHit('OpenAI', ['openai', 'gpt']);
    addIfHit('Anthropic', ['anthropic', 'claude']);
    addIfHit('Google', ['google', 'gemini']);
    addIfHit('Meta', ['meta', 'llama']);
    addIfHit('Mistral', ['mistral']);
  }

  const tickers = t.match(/\b[A-Z]{2,6}\b/g) || [];
  tickers.forEach((ticker) => {
    const cleaned = String(ticker || '').trim();
    if (!cleaned || STOP_TICKERS.has(cleaned)) return;
    entities.add(cleaned);
  });

  const limited = Array.from(entities).slice(0, 3);
  return limited;
};

const bucketDateLabel = (rawDate, preset = '7d') => {
  const d = new Date(rawDate || '');
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString().slice(0, 10);
  if (preset === '7d') return iso;
  // 30d/90d/custom：按周聚合（周一作为起点）
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
  return monday.toISOString().slice(0, 10);
};

const buildTopicHeatmapCandidate = ({ notes, preset, topicPresets }) => {
  const byKey = new Map();
  const topicSet = new Set();
  const bucketSet = new Set();

  (notes || []).forEach((note) => {
    const raw = note.created_at || note.updated_at;
    const bucket = bucketDateLabel(raw, preset);
    if (!bucket) return;
    const text = buildNoteText(note);
    const topic = classifyByPresets(text, topicPresets);
    topicSet.add(topic);
    bucketSet.add(bucket);
    const key = `${bucket}|||${topic}`;
    byKey.set(key, (byKey.get(key) || 0) + 1);
  });

  const buckets = Array.from(bucketSet).sort();
  const topics = Array.from(topicSet);
  if (buckets.length < 2 || topics.length < 1) return null;

  const totalCells = Math.max(1, buckets.length * topics.length);
  const density = byKey.size / totalCells;
  if (density < 0.08) return null;

  const rows = [];
  for (const bucket of buckets) {
    for (const topic of topics) {
      const count = byKey.get(`${bucket}|||${topic}`) || 0;
      if (!count) continue;
      rows.push({ timeBucket: bucket, topic, count });
    }
  }

  return {
    key: 'topic_heatmap',
    question: preset === '7d' ? '过去7天各主题热度如何？' : '近期各主题热度如何变化？',
    type: 'heatmap',
    data: { xKey: 'timeBucket', yKey: 'topic', valueKey: 'count', rows },
    coverage: 0.74,
    confidence: 0.72,
    meta: { categoryCount: topics.length }
  };
};

const buildTopicDistributionCandidate = ({ notes, topicPresets }) => {
  const counts = new Map();
  (notes || []).forEach((note) => {
    const topic = classifyByPresets(buildNoteText(note), topicPresets);
    counts.set(topic, (counts.get(topic) || 0) + 1);
  });
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length < 1) return null;

  const top = entries.slice(0, 10);
  const rows = top.map(([topic, count]) => ({ topic, count }));
  const type = rows.length === 1 ? 'bar' : rows.length <= 8 ? 'pie' : 'bar';
  return {
    key: 'topic_distribution',
    question: '我最近主要关注哪些主题？',
    type,
    data: {
      categoryKey: 'topic',
      valueKey: 'count',
      rows
    },
    coverage: 0.78,
    confidence: 0.74,
    meta: { categoryCount: rows.length }
  };
};

const buildEntityTopNCandidate = ({ notes, mode }) => {
  const counts = new Map();
  (notes || []).forEach((note) => {
    const entities = extractEntities(buildNoteText(note), { mode });
    if (!entities.length) return;
    entities.forEach((entity) => {
      counts.set(entity, (counts.get(entity) || 0) + 1);
    });
  });
  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([entity, count]) => ({ entity, count }));
  if (rows.length < 1) return null;
  return {
    key: 'entity_topn',
    question: mode === 'finance' ? '我最近最常关注哪些标的？' : '我最近最常关注哪些主体/模型？',
    type: 'bar',
    data: { categoryKey: 'entity', valueKey: 'count', rows },
    coverage: 0.72,
    confidence: 0.7,
    meta: { categoryCount: rows.length }
  };
};

const buildInsightPayload = (insights, noteIds, chartQuestion = '') => {
  const slots = [
    { key: 'state', fallback: 'The current notes show a baseline structure and focus.' },
    { key: 'change', fallback: 'Recent changes need more data points to confirm.' },
    { key: 'pattern', fallback: 'No stable pattern detected yet; keep logging.' }
  ];

  return slots.map((slot, index) => {
    const item = insights?.[index] || {};
    const summary = item.summary || item.description || item.title || slot.fallback;
    return {
      key: slot.key,
      what: summary,
      canDo: '',
      whatElse: chartQuestion || '',
      coverage: Number(item.confidence ?? 0.7),
      confidence: Number(item.confidence ?? 0.7)
    };
  });
};

const inferFieldRole = (type = '') => {
  const lower = String(type).toLowerCase();
  if (lower.includes('number') || lower.includes('metric') || lower.includes('chart')) return 'metric';
  return 'dimension';
};

const inferFieldDataType = (type = '') => {
  const lower = String(type).toLowerCase();
  if (lower.includes('date') || lower.includes('time')) return 'date';
  if (lower.includes('number') || lower.includes('metric') || lower.includes('chart')) return 'number';
  return 'text';
};

const buildDebugFields = (notes, componentInstances) => {
  const parsedNotes = Array.isArray(notes) ? notes : [];
  const fields = [];

  componentInstances.forEach((instance) => {
    if (!instance?.id || !instance?.title) return;
    const values = parsedNotes.map((note) => {
      const data = note.component_data || {};
      const raw = data[instance.id];
      if (raw && typeof raw === 'object' && 'value' in raw) return raw.value;
      return raw ?? '';
    });
    const total = values.length || 1;
    const missing = values.filter((value) => value === null || value === undefined || value === '').length;
    const sample = values.find((value) => value !== null && value !== undefined && value !== '');
    fields.push({
      name: instance.title,
      role: inferFieldRole(instance.type),
      dataType: inferFieldDataType(instance.type),
      source: 'notebook',
      missingRate: Number((missing / total).toFixed(2)),
      sample: sample === undefined ? '' : String(sample)
    });
  });

  fields.push({
    name: '创建时间',
    role: 'dimension',
    dataType: 'date',
    source: 'system',
    missingRate: 0,
    sample: parsedNotes[0]?.created_at || ''
  });

  return fields;
};

const buildAxisSuggestions = (fields) => {
  const xCandidates = fields.filter((f) => f.dataType === 'date').map((f) => f.name);
  const yCandidates = fields.filter((f) => f.role === 'metric').map((f) => f.name);
  const dim2Candidates = fields.filter((f) => f.role === 'dimension' && f.dataType !== 'date').map((f) => f.name);
  if (!yCandidates.includes('笔记数')) {
    yCandidates.push('笔记数');
  }
  return { xCandidates, yCandidates, dim2Candidates };
};

const buildChartConfigs = (charts) => {
  const supported = new Set(['line', 'bar', 'pie']);
  return (charts || [])
    .filter((chart) => supported.has(chart.type))
    .map((chart, index) => {
      const rows = Array.isArray(chart.data?.rows) ? chart.data.rows : [];
      const xField = chart.data?.xKey || chart.data?.categoryKey || 'x';
      const yField = chart.data?.yKey || chart.data?.valueKey || 'y';
      const categoryField = chart.data?.categoryKey || xField;
      const data = rows.map((row) => ({
        ...row,
        x: row[xField],
        y: row[yField],
        title: row[categoryField] ?? row[xField] ?? ''
      }));
      return {
        id: `chart_${index}`,
        type: chart.type,
        config: {
          xField,
          yField,
          title: chart.question || 'Chart',
          xAxis: xField,
          yAxis: yField,
          axisDisplay: {
            x: [xField],
            y: [yField]
          }
        },
        data,
        rendered: false
      };
    });
};

const buildChartCandidates = (notes, timeRange, notebookType) => {
  const rows = [];
  const counts = new Map();
  const parsedNotes = Array.isArray(notes) ? notes : [];
  parsedNotes.forEach((note) => {
    const dateStr = (note.created_at || note.updated_at || '').slice(0, 10);
    if (!dateStr) return;
    counts.set(dateStr, (counts.get(dateStr) || 0) + 1);
  });
  const dates = Array.from(counts.keys()).sort();
  dates.forEach((date) => {
    rows.push({ date, count: counts.get(date) });
  });

  const preset = timeRange?.preset || '7d';
  const dayLabel = preset === '90d' ? '90天' : preset === '30d' ? '30天' : '7天';
  const trendQuestion = preset === 'custom' ? '选定时间段如何变化？' : `过去${dayLabel}趋势如何变化？`;

  const candidates = [];
  if (notebookType === 'finance' || notebookType === 'ai') {
    const topicPresets = notebookType === 'finance' ? FINANCE_TOPIC_PRESETS : AI_TOPIC_PRESETS;
    const heatmap = buildTopicHeatmapCandidate({ notes: parsedNotes, preset, topicPresets });
    const topicDist = buildTopicDistributionCandidate({ notes: parsedNotes, topicPresets });
    const entityTopN = buildEntityTopNCandidate({ notes: parsedNotes, mode: notebookType });
    if (heatmap) candidates.push(heatmap);
    if (topicDist) candidates.push(topicDist);
    if (entityTopN) candidates.push(entityTopN);
  }

  if (rows.length >= 2) {
    candidates.push({
      key: 'trend',
      question: trendQuestion,
      type: 'line',
      data: {
        xKey: 'date',
        yKey: 'count',
        rows,
        granularity: 'day'
      },
      coverage: 0.72,
      confidence: 0.74
    });
  }

  const weekdayCounts = new Map();
  parsedNotes.forEach((note) => {
    const raw = note.created_at || note.updated_at;
    if (!raw) return;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return;
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) || 0) + 1);
  });
  if (weekdayCounts.size >= 2) {
    const weekdayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const weekdayRows = weekdayOrder
      .filter((day) => weekdayCounts.has(day))
      .map((weekday) => ({
        weekday,
        count: weekdayCounts.get(weekday)
      }));
    candidates.push({
      key: 'weekday',
      question: '一周内哪些天记录最多？',
      type: 'bar',
      data: {
        categoryKey: 'weekday',
        valueKey: 'count',
        rows: weekdayRows
      },
      coverage: 0.68,
      confidence: 0.71
    });
  }

  if (notebookType === 'mood') {
    const eventCounts = new Map();
    parsedNotes.forEach((note) => {
      const text = buildNoteText(note);
      const eventType = detectMoodEventType(text);
      eventCounts.set(eventType, (eventCounts.get(eventType) || 0) + 1);
    });
    const eventRows = Array.from(eventCounts.entries()).map(([eventType, count]) => ({
      eventType,
      count
    }));
    if (eventRows.length >= 2) {
      candidates.push({
        key: 'mood_event',
        question: '情绪事件类型占比如何？',
        type: 'pie',
        data: {
          categoryKey: 'eventType',
          valueKey: 'count',
          rows: eventRows
        },
        coverage: 0.66,
        confidence: 0.72,
        meta: { categoryCount: eventRows.length }
      });
    }
  } else {
    const lengthBuckets = new Map([
      ['short', 0],
      ['medium', 0],
      ['long', 0]
    ]);
    parsedNotes.forEach((note) => {
      const text = note.content_text || '';
      const length = text.length;
      if (length < 120) {
        lengthBuckets.set('short', (lengthBuckets.get('short') || 0) + 1);
      } else if (length < 400) {
        lengthBuckets.set('medium', (lengthBuckets.get('medium') || 0) + 1);
      } else {
        lengthBuckets.set('long', (lengthBuckets.get('long') || 0) + 1);
      }
    });
    const lengthOrder = ['short', 'medium', 'long'];
    const lengthRows = lengthOrder
      .filter((bucket) => (lengthBuckets.get(bucket) || 0) > 0)
      .map((bucket) => ({ bucket, count: lengthBuckets.get(bucket) || 0 }));
    if (lengthRows.length >= 2) {
      candidates.push({
        key: 'length',
        question: '笔记长度分布如何？',
        type: 'pie',
        data: {
          categoryKey: 'bucket',
          valueKey: 'count',
          rows: lengthRows
        },
        coverage: 0.64,
        confidence: 0.7
      });
    }
  }

  const strategy = ANALYSIS_V3_CHART_STRATEGY[notebookType] || ANALYSIS_V3_CHART_STRATEGY.default;
  const rules = strategy.candidateRules || {};
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const picked = [];
  const used = new Set();

  const pushCandidate = (key) => {
    if (used.has(key)) return;
    const candidate = byKey.get(key);
    if (!candidate) return;
    const rule = rules[key];
    if (rule?.minCategories && (candidate.meta?.categoryCount || 0) < rule.minCategories) {
      return;
    }
    used.add(key);
    picked.push(candidate);
  };

  (strategy.preferredCandidates || []).forEach(pushCandidate);
  if (picked.length < 3) {
    (strategy.fallbackCandidates || []).forEach(pushCandidate);
  }
  if (picked.length < 3) {
    candidates.forEach((candidate) => pushCandidate(candidate.key));
  }

  return picked.slice(0, 3).map(({ meta, ...candidate }) => candidate);
};

const extractNotes = (rows = []) =>
  rows.map((note) => {
    let componentData = {};
    if (note.component_data) {
      try {
        componentData = typeof note.component_data === 'string'
          ? JSON.parse(note.component_data)
          : note.component_data || {};
      } catch {
        componentData = {};
      }
    }
    let componentInstances = [];
    if (note.component_instances) {
      try {
        componentInstances = typeof note.component_instances === 'string'
          ? JSON.parse(note.component_instances)
          : note.component_instances || [];
      } catch {
        componentInstances = [];
      }
    }
    return {
      id: String(note.note_id),
      title: note.title || '',
      content_text: note.content_text || '',
      created_at: note.created_at || '',
      updated_at: note.updated_at || note.created_at || '',
      component_data: componentData,
      component_instances: componentInstances
    };
  });

export const initAnalysisV3Routes = ({ db, aiService } = {}) => {
  const router = express.Router();
  const ai = aiService instanceof AIService ? aiService : new AIService();

  router.post('/api/analysis/v3', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({ success: false, message: 'database not connected' });
      }
      const notebookId = String(req.body?.notebookId || '').trim();
      if (!notebookId) {
        return res.status(400).json({ success: false, message: 'notebookId is required' });
      }

      const timeRange = normalizeTimeRange(req.body?.timeRange || {});
      const withDebug = Boolean(req.body?.withDebug);
      const noteIds = Array.isArray(req.body?.noteIds) ? req.body.noteIds.map((id) => String(id)) : [];

      const notebook = await db.get('SELECT * FROM notebooks WHERE notebook_id = ?', [notebookId]);
      if (!notebook) {
        return res.status(404).json({ success: false, message: 'notebook not found' });
      }

      let notesQuery = 'SELECT * FROM notes WHERE notebook_id = ?';
      const params = [notebookId];
      if (noteIds.length > 0) {
        const placeholders = noteIds.map(() => '?').join(',');
        notesQuery += ` AND note_id IN (${placeholders})`;
        params.push(...noteIds);
      } else {
        if (timeRange.from) {
          notesQuery += ' AND created_at >= ?';
          params.push(timeRange.from.toISOString());
        }
        if (timeRange.to) {
          notesQuery += ' AND created_at <= ?';
          params.push(timeRange.to.toISOString());
        }
      }
      notesQuery += ' ORDER BY created_at ASC';
      const noteRows = await db.all(notesQuery, params);
      const parsedNotes = extractNotes(noteRows);
      const notebookType = resolveNotebookType(notebook, parsedNotes);

      const analysisId = buildAnalysisId();
      const noteCount = parsedNotes.length;
      const startAt = toUnixSeconds(parsedNotes[0]?.created_at) ?? toUnixSeconds(timeRange.from);
      const endAt = toUnixSeconds(parsedNotes[parsedNotes.length - 1]?.created_at) ?? toUnixSeconds(timeRange.to);

      const prompt = buildInsightsPrompt(notebookType);
      const aiInsights = await ai.generateInsights(notebookType, prompt, parsedNotes);
      const noteIdsForInsight = parsedNotes.map((note) => note.id);

      let componentInstances = [];
      try {
        const config = typeof notebook.component_config === 'string'
          ? JSON.parse(notebook.component_config)
          : notebook.component_config || {};
        componentInstances = Array.isArray(config?.componentInstances) ? config.componentInstances : [];
      } catch {
        componentInstances = [];
      }

      const charts = buildChartCandidates(parsedNotes, timeRange, notebookType);
      const defaultKey = charts[0]?.key || '';
      const insightsByChartKey = charts.reduce((acc, chart) => {
        acc[chart.key] = buildInsightPayload(aiInsights, noteIdsForInsight, chart.question || '');
        return acc;
      }, {});
      const insights = defaultKey && insightsByChartKey[defaultKey]
        ? insightsByChartKey[defaultKey]
        : buildInsightPayload(aiInsights, noteIdsForInsight, '');

      const debugFields = buildDebugFields(parsedNotes, componentInstances);
      const debug = {
        fields: debugFields,
        axisSuggestions: buildAxisSuggestions(debugFields),
        downgradeReasons: {}
      };

      const payload = {
        analysisId,
        meta: {
          recordCount: noteCount,
          startAt: startAt || null,
          endAt: endAt || null
        },
        noteType: {
          value: mapNoteType(notebook?.type),
          confidence: 0.6
        },
        notebookType,
        insights,
        insightsByChartKey,
        charts: {
          defaultKey,
          items: charts
        },
        cache: { hit: false, ttlSec: 0 }
      };

      const dateRangePayload = {
        from: timeRange.from ? timeRange.from.toISOString().slice(0, 10) : '',
        to: timeRange.to ? timeRange.to.toISOString().slice(0, 10) : ''
      };

      const analysisData = {
        version: 'analysis_v3',
        selectedNotes: {
          notebookId,
          noteIds: parsedNotes.map((note) => note.id),
          dateRange: dateRangePayload
        },
        selectedAnalysisComponents: ['chart', 'ai-custom'],
        componentConfigs: {
          chart: {
            chartConfigs: buildChartConfigs(charts),
            processedData: {
              notes: parsedNotes,
              metadata: {
                noteCount,
                dateRange: dateRangePayload,
                notebookId,
                noteIds: parsedNotes.map((note) => note.id)
              }
            }
          },
          'ai-custom': {
            insights: Array.isArray(aiInsights) ? aiInsights : []
          }
        },
        insights,
        insightsByChartKey,
        charts: payload.charts
      };

      try {
        const now = new Date().toISOString();
        await db.run(
          `INSERT INTO analysis_results (id, notebook_id, notebook_type, mode, analysis_data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            analysisId,
            notebookId,
            notebookType,
            'ai',
            JSON.stringify(analysisData),
            now,
            now
          ]
        );
      } catch (persistError) {
        console.error('[analysis-v3] failed to persist analysis:', persistError);
      }

      analysisCache.set(analysisId, {
        createdAt: Date.now(),
        payload,
        debug
      });

      const responseBody = withDebug ? { ...payload, debug } : payload;
      return res.json(responseBody);
    } catch (error) {
      console.error('[analysis-v3] failed:', error);
      return res.status(500).json({ success: false, message: 'analysis failed', error: error?.message || error });
    }
  });

  router.get('/api/analysis/v3/:analysisId/debug', (req, res) => {
    const analysisId = String(req.params.analysisId || '');
    const cached = analysisCache.get(analysisId);
    if (!cached) {
      return res.status(404).json({ success: false, message: 'debug not found' });
    }
    const isExpired = Date.now() - cached.createdAt > ANALYSIS_TTL_MS;
    if (isExpired) {
      analysisCache.delete(analysisId);
      return res.status(404).json({ success: false, message: 'debug expired' });
    }
    return res.json({ success: true, analysisId, debug: cached.debug });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of analysisCache.entries()) {
      if (now - entry.createdAt > ANALYSIS_TTL_MS) {
        analysisCache.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  return router;
};
