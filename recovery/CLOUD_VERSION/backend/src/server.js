/**
 * 后端服务器主入口
 * 集成解析功能、数据库连接等
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDB } from './lib/db.js';
import { initParseRoutes } from './routes/parse.js';
import AIService from './services/ai-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量（优先加载 .env.local）
// 尝试多个可能的路径
const envPaths = [
  path.join(__dirname, '../../../../.env.local'), // 从 backend/src 到项目根目录
  path.join(__dirname, '../../../.env.local'),   // 从 backend/src 到 CLOUD_VERSION
  path.join(__dirname, '../../.env.local'),     // 从 backend/src 到 backend
  '/Users/guanchenzhan/Desktop/VSCODE/个人网站/.env.local' // 绝对路径
];

let envLoaded = false;
for (const envPath of envPaths) {
  try {
    const result = dotenv.config({ path: envPath, override: true });
    if (!result.error) {
      console.log(`✅ 已加载环境变量: ${envPath}`);
      envLoaded = true;
      break;
    }
  } catch (error) {
    // 继续尝试下一个路径
  }
}

if (!envLoaded) {
  console.warn('⚠️ 未找到 .env.local 文件，尝试加载默认 .env');
  dotenv.config(); // 如果 .env.local 不存在，则加载默认的 .env
}

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 全局变量
let db = null;

const NOTE_FIELDS =
  'note_id, notebook_id, title, content_text, images, image_urls, source_url, source, original_url, author, upload_time, component_data, component_instances, created_at, updated_at';

const sanitizeString = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return String(value);
  return value.trim();
};

const generateNoteId = () => `note_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const generateComponentId = (type = 'text-short') =>
  `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeComponentInstances = (instances) => {
  if (!Array.isArray(instances)) return [];
  return instances
    .filter(item => item && typeof item === 'object')
    .map((item) => {
      const type = sanitizeString(item.type || 'text-short', 'text-short');
      return {
        id: sanitizeString(item.id, generateComponentId(type)) || generateComponentId(type),
        type,
        title: sanitizeString(item.title || ''),
        config: item.config && typeof item.config === 'object' ? item.config : {},
        dataMapping: item.dataMapping && typeof item.dataMapping === 'object' ? item.dataMapping : {}
      };
    });
};

const buildDefaultComponentConfig = () => {
  const defaults = [
    { type: 'text-short', title: '标题' },
    { type: 'text-long', title: '正文' },
    { type: 'date', title: '日期' }
  ];

  return JSON.stringify({
    componentInstances: defaults.map((item) => ({
      id: generateComponentId(item.type),
      type: item.type,
      title: item.title,
      config: {},
      dataMapping: {}
    }))
  });
};

const resolveNotebookComponentConfig = (rawConfig) => {
  if (!rawConfig) {
    return buildDefaultComponentConfig();
  }

  let normalized = rawConfig;
  if (typeof rawConfig === 'string') {
    try {
      normalized = JSON.parse(rawConfig);
    } catch (error) {
      console.warn('Failed to parse incoming component_config:', error);
      normalized = null;
    }
  }

  if (normalized && typeof normalized === 'object') {
    const candidateInstances =
      Array.isArray(normalized.componentInstances)
        ? normalized.componentInstances
        : Array.isArray(normalized.instances)
          ? normalized.instances
          : Array.isArray(normalized)
            ? normalized
            : [];

    const sanitized = normalizeComponentInstances(candidateInstances);
    if (sanitized.length > 0) {
      return JSON.stringify({ componentInstances: sanitized });
    }
  }

  return buildDefaultComponentConfig();
};

const parseComponentConfigValue = (rawConfig) => {
  if (!rawConfig) return null;
  if (typeof rawConfig === 'string') {
    try {
      return JSON.parse(rawConfig);
    } catch (error) {
      console.warn('Failed to parse component_config:', error);
      return null;
    }
  }
  if (typeof rawConfig === 'object') {
    return rawConfig;
  }
  return null;
};

const ensureTemplateInstances = (instances = []) => {
  return normalizeComponentInstances(instances).map((instance) => ({
    id: instance.id || generateComponentId(instance.type),
    type: instance.type,
    title: instance.title || getComponentTitle(instance.type),
    config: instance.config || {},
    dataMapping: instance.dataMapping || {}
  }));
};

const mergeComponentInstances = (templateInstances = [], existingInstances = []) => {
  const sanitizedTemplate = ensureTemplateInstances(templateInstances);
  const mapping = {};
  const usedTemplateIndexes = new Set();

  (Array.isArray(existingInstances) ? existingInstances : []).forEach((existing) => {
    const matchIndex = sanitizedTemplate.findIndex(
      (template, idx) => !usedTemplateIndexes.has(idx) && template.type === existing.type
    );
    if (matchIndex >= 0 && existing?.id) {
      mapping[existing.id] = sanitizedTemplate[matchIndex].id;
      usedTemplateIndexes.add(matchIndex);
    }
  });

  return { instances: sanitizedTemplate, idMapping: mapping };
};

const getComponentTitle = (type) => {
  const record = [
    { id: 'text-short', label: '短文本' },
    { id: 'text-long', label: '长文本' },
    { id: 'date', label: '日期' },
    { id: 'number', label: '数字' },
    { id: 'image', label: '图片' },
    { id: 'video', label: '视频' },
    { id: 'audio', label: '音频' },
    { id: 'file', label: '文件' },
    { id: 'ai-custom', label: 'AI 摘要' },
    { id: 'chart', label: '图表' }
  ];
  const entry = record.find((item) => item.id === type);
  return entry ? entry.label : '未命名组件';
};

const aiService = new AIService();

const isMeaningfulText = (value) => {
  if (value === null || value === undefined) return false;
  const text = typeof value === 'string' ? value : String(value || '');
  return text.trim().length > 0;
};

const normalizeParseFields = (parseFields) => {
  if (Array.isArray(parseFields) && parseFields.length) {
    return Array.from(new Set(parseFields.map((f) => String(f).toLowerCase()))).filter(Boolean);
  }
  return ['summary', 'keywords'];
};

const ensureComponent = (instances, id, title, type, source = '') => {
  const found = (instances || []).find(
    (inst) =>
      inst?.id === id ||
      (inst?.dataMapping && inst.dataMapping.source === source) ||
      String(inst?.title || '').toLowerCase() === String(title || '').toLowerCase()
  );
  if (found) return found.id || id;
  const newInst = {
    id,
    type,
    title,
    config: {},
    dataMapping: source ? { source } : {}
  };
  instances.push(newInst);
  return newInst.id;
};

async function generateKeywordsAndSummaryForNote({
  noteId,
  title,
  content,
  componentData = {},
  componentInstances = [],
  needSummary = true,
  needKeywords = true
}) {
  try {
    const hasTitle = isMeaningfulText(title);
    const hasContent = isMeaningfulText(content);
    if (!hasTitle && !hasContent) {
      console.warn('⚠️ 标题和正文都为空，跳过AI解析');
      return;
    }

    const combined = [
      hasTitle ? `标题：${String(title).trim()}` : '',
      hasContent ? `正文：${String(content).trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n\n');

    const prompt = `请分析以下笔记内容，生成关键词和摘要：

${combined}

请按以下格式返回纯JSON（不要包含任何其他文字或markdown代码块）：
{
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "summary": "一句话摘要，简洁概括主要内容，不超过100字"
}

要求：
1. keywords 为字符串数组，3-5 个关键词，准确反映主题
2. summary 为一句话，简洁明了，不超过100字
3. 如果内容较少，可减少关键词数量`;

    let keywords = [];
    let summary = '';

    try {
      const aiResponse = await aiService.generateText(prompt, { temperature: 0.4, maxTokens: 500 });
      let cleaned = aiResponse.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/```json\s*/i, '').replace(/```\s*$/, '');
      else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/```\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.keywords)) {
        keywords = parsed.keywords.map((k) => String(k || '').trim()).filter(Boolean);
      }
      if (isMeaningfulText(parsed.summary)) {
        summary = String(parsed.summary).trim();
      }
    } catch (aiError) {
      console.warn('⚠️ AI 解析失败，使用兜底:', aiError?.message || aiError);
    }

    if (needKeywords && !keywords.length) {
      // 简易兜底关键词
      const words = combined
        .replace(/[^\u4e00-\u9fa5\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.trim().length >= 2);
      keywords = Array.from(new Set(words)).slice(0, 5);
    }

    if (needSummary && !isMeaningfulText(summary)) {
      summary = combined.slice(0, 80) || '待生成';
    }

    if (!needKeywords) keywords = [];
    if (!needSummary) summary = '';

    // 更新组件数据
    const updatedData = { ...(componentData || {}) };
    const updatedInstances = Array.isArray(componentInstances) ? [...componentInstances] : [];

    if (keywords.length && needKeywords) {
      const kwId = ensureComponent(updatedInstances, 'keywords', '关键词', 'tag', 'keywords');
      updatedData[kwId] = {
        ...(updatedData[kwId] || {}),
        type: 'tag',
        title: updatedData[kwId]?.title || '关键词',
        value: keywords.join(', '),
        items: keywords
      };
    } else if (needKeywords) {
      const kwId = ensureComponent(updatedInstances, 'keywords', '关键词', 'tag', 'keywords');
      updatedData[kwId] = {
        ...(updatedData[kwId] || {}),
        type: 'tag',
        title: updatedData[kwId]?.title || '关键词',
        value: '待生成'
      };
    }

    if (needSummary && isMeaningfulText(summary)) {
      const sumId = ensureComponent(updatedInstances, 'summary', 'AI 摘要', 'text-long', 'summary');
      updatedData[sumId] = {
        ...(updatedData[sumId] || {}),
        type: 'text-long',
        title: updatedData[sumId]?.title || 'AI 摘要',
        value: summary
      };
    } else if (needSummary) {
      const sumId = ensureComponent(updatedInstances, 'summary', 'AI 摘要', 'text-long', 'summary');
      updatedData[sumId] = {
        ...(updatedData[sumId] || {}),
        type: 'text-long',
        title: updatedData[sumId]?.title || 'AI 摘要',
        value: '待生成'
      };
    }

    const now = new Date().toISOString();
    await db.run(
      'UPDATE notes SET component_data = ?, component_instances = ?, updated_at = ? WHERE note_id = ?',
      [JSON.stringify(updatedData), JSON.stringify(updatedInstances), now, noteId]
    );
    console.log('✅ AI 解析结果已写入笔记:', noteId, {
      keywordsCount: keywords.length,
      hasSummary: isMeaningfulText(summary)
    });
  } catch (error) {
    console.error('❌ 生成关键词和摘要失败:', error);
  }
}

async function getNotebookById(notebookId) {
  if (!db) return null;
  return await db.get(
    'SELECT notebook_id, name, description, note_count, component_config, created_at, updated_at FROM notebooks WHERE notebook_id = ?',
    [notebookId]
  );
}

async function updateNotebookNoteCount(notebookId) {
  if (!db || !notebookId) return;
  const stats = await db.get('SELECT COUNT(*) as count FROM notes WHERE notebook_id = ?', [notebookId]);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE notebooks SET note_count = ?, updated_at = ? WHERE notebook_id = ?',
    [stats?.count ?? 0, now, notebookId]
  );
}

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'backend running',
    database: db ? 'connected' : 'not connected'
  });
});

// 获取笔记本列表
app.get('/api/notebooks', async (_req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ 
        success: false, 
        error: '数据库未连接' 
      });
    }

    try {
      const notebooks = await db.all(
        'SELECT notebook_id, name, description, note_count, component_config, created_at, updated_at FROM notebooks ORDER BY updated_at DESC'
      );

      return res.json({
        success: true,
        data: notebooks || []
      });
    } catch (queryError) {
      // 如果这里因为 Turso/网络问题抛出 fetch failed，不要让前端 500，
      // 而是返回一个空列表，并在后台打印错误以便排查。
      console.error('❌ 查询 notebooks 失败，返回空列表:', queryError);
      return res.json({
        success: true,
        data: [],
        fallback: true,
        message: 'notebooks query failed, fallback to empty list'
      });
    }
  } catch (error) {
    console.error('❌ 获取笔记本列表失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取笔记本列表失败'
    });
  }
});

// 获取指定笔记本的笔记
app.get('/api/notes', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未连接'
      });
    }

    const notebookId = sanitizeString(req.query?.notebook_id || req.query?.notebookId);
    if (!notebookId) {
      return res.status(400).json({
        success: false,
        message: '请提供 notebook_id'
      });
    }

    const notebook = await getNotebookById(notebookId);
    if (!notebook) {
      return res.status(404).json({
        success: false,
        message: '笔记本不存在'
      });
    }

    const notes = await db.all(
      `SELECT ${NOTE_FIELDS} FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC`,
      [notebookId]
    );

    res.json({
      success: true,
      notebook,
      notes: notes || []
    });
  } catch (error) {
    console.error('❌ 获取笔记失败:', error);
    res.status(500).json({
      success: false,
      message: error.message || '获取笔记失败'
    });
  }
});

// 获取单条笔记详情（兼容旧版 NoteDetailPage 调用）
app.get('/api/note-detail-data', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未连接'
      });
    }

    const rawId = req.query?.id || req.query?.note_id || req.query?.noteId;
    const noteId = sanitizeString(rawId);

    if (!noteId) {
      return res.status(400).json({
        success: false,
        error: '请提供笔记 ID（id 或 note_id）'
      });
    }

    const note = await db.get(
      `SELECT ${NOTE_FIELDS} FROM notes WHERE note_id = ?`,
      [noteId]
    );

    if (!note) {
      return res.status(404).json({
        success: false,
        error: '笔记不存在'
      });
    }

    const notebook = await getNotebookById(note.notebook_id);

    res.json({
      success: true,
      note,
      notebook: notebook || null
    });
  } catch (error) {
    console.error('❌ 获取笔记详情失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '获取笔记详情失败'
    });
  }
});

// 创建笔记
app.post('/api/notes', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未连接'
      });
    }

  const {
    notebook_id,
    title,
    content_text,
    component_data,
    component_instances,
    source_url,
    skipAI = false,
    parseFields
  } = req.body || {};
  const notebookId = sanitizeString(notebook_id);

    if (!notebookId) {
      return res.status(400).json({ success: false, message: '请提供 notebook_id' });
    }

    const notebook = await getNotebookById(notebookId);
    if (!notebook) {
      return res.status(404).json({ success: false, message: '笔记本不存在' });
    }

    const resolvedTitle = sanitizeString(title, '未命名笔记') || '未命名笔记';
    const resolvedContent = sanitizeString(content_text);
    if (!resolvedTitle && !resolvedContent) {
      return res.status(400).json({ success: false, message: '请至少提供标题或内容' });
    }

  const noteId = generateNoteId();
  const now = new Date().toISOString();

    await db.run(
      `
        INSERT INTO notes (
          note_id,
          notebook_id,
          title,
          content_text,
          images,
          image_urls,
          source_url,
          source,
          original_url,
          author,
          upload_time,
          component_data,
          component_instances,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        noteId,
        notebookId,
        resolvedTitle,
        resolvedContent,
        null,
        null,
        sanitizeString(source_url) || null,
        sanitizeString(source) || null,
        sanitizeString(original_url) || null,
        sanitizeString(author) || null,
        sanitizeString(upload_time) || null,
        component_data ? JSON.stringify(component_data) : null,
        component_instances ? JSON.stringify(component_instances) : null,
        now,
        now
      ]
    );

    await updateNotebookNoteCount(notebookId);

  // AI 触发逻辑
  const normalizedParseFields = normalizeParseFields(parseFields);
  const wantSummary = normalizedParseFields.includes('summary');
  const wantKeywords = normalizedParseFields.includes('keywords');
  const wantAI = !skipAI && (wantSummary || wantKeywords);

  const parsedComponentData =
    component_data && typeof component_data === 'object'
      ? component_data
      : component_data && typeof component_data === 'string'
        ? (() => {
            try { return JSON.parse(component_data); } catch { return {}; }
          })()
        : {};
  const parsedComponentInstances = Array.isArray(component_instances) ? component_instances : [];

  const hasUserSummary = Object.values(parsedComponentData || {}).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const titleLower = String(entry.title || '').toLowerCase();
    const sourceLower = String(entry.sourceField || '').toLowerCase();
    return (titleLower.includes('摘要') || titleLower.includes('summary') || sourceLower === 'summary') &&
      isMeaningfulText(entry.value);
  });
  const hasUserKeywords = Object.values(parsedComponentData || {}).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const titleLower = String(entry.title || '').toLowerCase();
    const sourceLower = String(entry.sourceField || '').toLowerCase();
    return (titleLower.includes('关键词') || titleLower.includes('keyword') || sourceLower === 'keywords') &&
      isMeaningfulText(entry.value);
  });

  if (
    wantAI &&
    (isMeaningfulText(resolvedTitle) || isMeaningfulText(resolvedContent)) &&
    (!hasUserSummary || !hasUserKeywords)
  ) {
    // 异步 AI 生成，不阻塞创建
    generateKeywordsAndSummaryForNote({
      noteId,
      title: resolvedTitle,
      content: resolvedContent,
      componentData: parsedComponentData,
      componentInstances: parsedComponentInstances,
      needSummary: wantSummary && !hasUserSummary,
      needKeywords: wantKeywords && !hasUserKeywords
    }).catch((err) => {
      console.error('❌ 后台AI解析失败（不影响笔记创建）:', err);
    });
  } else if (wantAI && !isMeaningfulText(resolvedTitle) && !isMeaningfulText(resolvedContent)) {
    // 没有内容也想要AI时，标记待生成
    const placeholderData = {
      ...parsedComponentData,
      summary: {
        type: 'text-long',
        title: 'AI 摘要',
        value: '待生成'
      },
      keywords: {
        type: 'tag',
        title: '关键词',
        value: '待生成'
      }
    };
    await db.run(
      'UPDATE notes SET component_data = ?, updated_at = ? WHERE note_id = ?',
      [JSON.stringify(placeholderData), new Date().toISOString(), noteId]
    );
  }

  res.status(201).json({
    success: true,
    note: {
      note_id: noteId,
      notebook_id: notebookId,
      title: resolvedTitle,
      content_text: resolvedContent,
      source_url: sanitizeString(source_url) || null,
      component_data: component_data || null,
      component_instances: component_instances || null,
      status: 'success',
      created_at: now,
      updated_at: now
    }
  });
  } catch (error) {
    console.error('❌ 创建笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '创建笔记失败' });
  }
});

// 重命名笔记
app.post('/api/note-rename', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }
    const { id, title } = req.body || {};
    const noteId = sanitizeString(id);
    if (!noteId || !title) {
      return res.status(400).json({ success: false, message: '请提供笔记ID和新标题' });
    }
    const now = new Date().toISOString();
    await db.run('UPDATE notes SET title = ?, updated_at = ? WHERE note_id = ?', [sanitizeString(title), now, noteId]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 重命名笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '重命名笔记失败' });
  }
});

// 删除单个笔记
app.post('/api/note-delete', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }
    const { id } = req.body || {};
    const noteId = sanitizeString(id);
    if (!noteId) {
      return res.status(400).json({ success: false, message: '请提供笔记ID' });
    }

    const note = await db.get('SELECT notebook_id FROM notes WHERE note_id = ?', [noteId]);
    if (!note) {
      return res.status(404).json({ success: false, message: '笔记不存在' });
    }

    await db.run('DELETE FROM notes WHERE note_id = ?', [noteId]);
    await updateNotebookNoteCount(note.notebook_id);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ 删除笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '删除笔记失败' });
  }
});

// 批量删除笔记
app.post('/api/notes-batch-delete', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const noteIds = Array.isArray(req.body?.note_ids) ? req.body.note_ids.filter(Boolean) : [];
    if (noteIds.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的笔记ID列表' });
    }

    const placeholders = noteIds.map(() => '?').join(',');
    const notes = await db.all(
      `SELECT DISTINCT notebook_id FROM notes WHERE note_id IN (${placeholders})`,
      noteIds
    );

    await db.run(`DELETE FROM notes WHERE note_id IN (${placeholders})`, noteIds);

    await Promise.all((notes || []).map((row) => updateNotebookNoteCount(row.notebook_id)));

    res.json({ success: true, deleted: noteIds.length });
  } catch (error) {
    console.error('❌ 批量删除笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '批量删除笔记失败' });
  }
});

// 移动单个笔记
app.post('/api/note-move', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const { note_id, noteId, target_notebook_id } = req.body || {};
    const sourceNoteId = sanitizeString(note_id || noteId);
    const targetNotebookId = sanitizeString(target_notebook_id);

    if (!sourceNoteId || !targetNotebookId) {
      return res.status(400).json({ success: false, message: '请提供笔记ID和目标笔记本ID' });
    }

    const note = await db.get('SELECT notebook_id FROM notes WHERE note_id = ?', [sourceNoteId]);
    if (!note) {
      return res.status(404).json({ success: false, message: '笔记不存在' });
    }

    const targetNotebook = await getNotebookById(targetNotebookId);
    if (!targetNotebook) {
      return res.status(404).json({ success: false, message: '目标笔记本不存在' });
    }

    const now = new Date().toISOString();
    await db.run(
      'UPDATE notes SET notebook_id = ?, updated_at = ? WHERE note_id = ?',
      [targetNotebookId, now, sourceNoteId]
    );

    await updateNotebookNoteCount(note.notebook_id);
    await updateNotebookNoteCount(targetNotebookId);

    res.json({ success: true });
  } catch (error) {
    console.error('❌ 移动笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '移动笔记失败' });
  }
});

// 批量移动笔记
app.post('/api/notes-batch-move', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const noteIds = Array.isArray(req.body?.note_ids) ? req.body.note_ids.filter(Boolean) : [];
    const targetNotebookId = sanitizeString(req.body?.target_notebook_id);

    if (noteIds.length === 0 || !targetNotebookId) {
      return res.status(400).json({ success: false, message: '请提供笔记ID列表和目标笔记本ID' });
    }

    const targetNotebook = await getNotebookById(targetNotebookId);
    if (!targetNotebook) {
      return res.status(404).json({ success: false, message: '目标笔记本不存在' });
    }

    const placeholders = noteIds.map(() => '?').join(',');
    const notes = await db.all(
      `SELECT DISTINCT notebook_id FROM notes WHERE note_id IN (${placeholders})`,
      noteIds
    );

    const now = new Date().toISOString();
    await db.run(
      `UPDATE notes SET notebook_id = ?, updated_at = ? WHERE note_id IN (${placeholders})`,
      [targetNotebookId, now, ...noteIds]
    );

    await Promise.all((notes || []).map((row) => updateNotebookNoteCount(row.notebook_id)));
    await updateNotebookNoteCount(targetNotebookId);

    res.json({ success: true, moved: noteIds.length });
  } catch (error) {
    console.error('❌ 批量移动笔记失败:', error);
    res.status(500).json({ success: false, message: error.message || '批量移动笔记失败' });
  }
});

// 创建笔记本
app.post('/api/notebooks', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        success: false,
        error: '数据库未连接'
      });
    }

    const { name, description, component_config, componentConfig } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的笔记本名称'
      });
    }

    const notebookId = `notebook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const desc = typeof description === 'string' ? description.trim() : null;
    const resolvedConfig = resolveNotebookComponentConfig(componentConfig || component_config);

    await db.run(
      `
        INSERT INTO notebooks (notebook_id, name, description, note_count, component_config, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?)
      `,
      [notebookId, name.trim(), desc, resolvedConfig, now, now]
    );

    res.status(201).json({
      success: true,
      notebook: {
        notebook_id: notebookId,
        name: name.trim(),
        description: desc,
        note_count: 0,
        component_config: parseComponentConfigValue(resolvedConfig),
        created_at: now,
        updated_at: now
      }
    });
  } catch (error) {
    console.error('❌ 创建笔记本失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '创建笔记本失败'
    });
  }
});

// 获取单个笔记本
app.get('/api/notebooks/:id', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, message: '数据库未连接' });
    }

    const notebook = await db.get(
      'SELECT notebook_id, name, description, note_count, component_config, created_at, updated_at FROM notebooks WHERE notebook_id = ?',
      [req.params.id]
    );

    if (!notebook) {
      return res.status(404).json({ success: false, message: '笔记本不存在' });
    }

    const parsedConfig = parseComponentConfigValue(notebook.component_config);

    res.json({
      success: true,
      notebook: {
        ...notebook,
        component_config: parsedConfig
      }
    });
  } catch (error) {
    console.error('❌ 获取笔记本失败:', error);
    res.status(500).json({ success: false, message: error.message || '获取笔记本失败' });
  }
});

// 更新笔记本模板
app.put('/api/notebooks/:id', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, message: '数据库未连接' });
    }

    const { componentConfig, syncToNotes = false } = req.body || {};
    if (!componentConfig || !Array.isArray(componentConfig.componentInstances)) {
      return res.status(400).json({
        success: false,
        message: '请提供有效的 componentConfig'
      });
    }

    const sanitizedInstances = ensureTemplateInstances(componentConfig.componentInstances);
    const normalizedConfig = JSON.stringify({ componentInstances: sanitizedInstances });
    const now = new Date().toISOString();

    await db.run(
      'UPDATE notebooks SET component_config = ?, updated_at = ? WHERE notebook_id = ?',
      [normalizedConfig, now, req.params.id]
    );

    if (syncToNotes) {
      const notes = await db.all(
        'SELECT note_id, component_instances, component_data FROM notes WHERE notebook_id = ?',
        [req.params.id]
      );

      for (const note of notes || []) {
        let existingInstances = [];
        let existingData = {};

        if (note.component_instances) {
          try {
            const parsedInstances = JSON.parse(note.component_instances);
            existingInstances = Array.isArray(parsedInstances) ? parsedInstances : [];
          } catch {
            existingInstances = [];
          }
        }

        if (note.component_data) {
          try {
            const parsedData = JSON.parse(note.component_data);
            existingData = typeof parsedData === 'object' && parsedData ? parsedData : {};
          } catch {
            existingData = {};
          }
        }

        const { idMapping } = mergeComponentInstances(sanitizedInstances, existingInstances);
        const remappedData = {};
        Object.entries(existingData).forEach(([oldId, value]) => {
          const newId = idMapping[oldId];
          if (newId) {
            remappedData[newId] = value;
          }
        });

        await db.run(
          'UPDATE notes SET component_instances = ?, component_data = ?, updated_at = ? WHERE note_id = ?',
          [JSON.stringify(sanitizedInstances), JSON.stringify(remappedData), now, note.note_id]
        );
      }
    }

    res.json({
      success: true,
      message: syncToNotes ? '模板已同步到所有笔记' : '模板已更新',
      component_config: { componentInstances: sanitizedInstances }
    });
  } catch (error) {
    console.error('❌ 更新笔记本模板失败:', error);
    res.status(500).json({ success: false, message: error.message || '更新笔记本模板失败' });
  }
});

// ==================== 分析相关 API ====================

// 获取所有分析结果
app.get('/api/analysis', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const analyses = await db.all(
      'SELECT * FROM analysis_results ORDER BY created_at DESC'
    );

    const formattedAnalyses = (analyses || []).map(analysis => {
      let analysisData = {};
      try {
        analysisData = analysis.analysis_data 
          ? JSON.parse(analysis.analysis_data) 
          : {};
      } catch (parseError) {
        console.warn(`⚠️ 无法解析分析数据 (ID: ${analysis.id}):`, parseError.message);
        analysisData = {};
      }

      return {
        id: analysis.id,
        notebookId: analysis.notebook_id,
        notebookType: analysis.notebook_type,
        mode: analysis.mode || 'ai',
        selectedAnalysisComponents: analysisData.selectedAnalysisComponents || [],
        componentConfigs: analysisData.componentConfigs || {},
        analysisData: analysisData,
        metadata: {
          createdAt: analysis.created_at,
          updatedAt: analysis.updated_at,
          dataSource: {
            notebookId: analysis.notebook_id,
            noteIds: analysisData.selectedNotes?.noteIds || [],
            dateRange: analysisData.selectedNotes?.dateRange || null
          }
        }
      };
    });

    res.json({
      success: true,
      data: formattedAnalyses
    });
  } catch (error) {
    console.error('❌ 获取分析结果失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '获取分析结果失败', 
      error: error.message 
    });
  }
});

// 获取特定分析结果
app.get('/api/analysis/:analysisId', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const { analysisId } = req.params;
    
    console.log(`🔍 [GET /api/analysis/:analysisId] 查找分析结果: ${analysisId}`);
    
    const analysis = await db.get(
      'SELECT * FROM analysis_results WHERE id = ?',
      [analysisId]
    );
    
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: `分析结果不存在: ${analysisId}`
      });
    }
    
    console.log(`✅ [GET /api/analysis/:analysisId] 找到分析结果: ${analysis.id}`);

    // 解析存储的分析数据
    let analysisData;
    try {
      analysisData = JSON.parse(analysis.analysis_data || '{}');
    } catch (parseError) {
      console.warn(`⚠️ 无法解析分析数据，返回空结构: ${analysis.id}`, parseError);
      analysisData = {};
    }
    
    // 构建前端期望的完整数据结构
    const formattedAnalysis = {
      id: analysis.id,
      notebookId: analysis.notebook_id,
      notebookType: analysis.notebook_type,
      mode: analysis.mode || 'ai',
      selectedAnalysisComponents: analysisData.selectedAnalysisComponents || [],
      componentConfigs: analysisData.componentConfigs || {},
      data: analysisData.data || [],
      analysisData: {
        selectedAnalysisComponents: analysisData.selectedAnalysisComponents || [],
        componentConfigs: analysisData.componentConfigs || {},
        processedData: analysisData.processedData || analysisData.data || []
      },
      metadata: {
        createdAt: analysis.created_at,
        updatedAt: analysis.updated_at,
        processingTime: analysisData.processingTime || 0,
        dataSource: {
          notebookId: analysis.notebook_id,
          noteIds: analysisData.selectedNotes?.noteIds || analysisData.metadata?.dataSource?.noteIds || [],
          dateRange: analysisData.selectedNotes?.dateRange || analysisData.metadata?.dataSource?.dateRange || null
        }
      }
    };

    res.json({
      success: true,
      data: formattedAnalysis
    });
  } catch (error) {
    console.error('❌ 获取分析结果失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '获取分析结果失败', 
      error: error.message 
    });
  }
});

// 创建/更新分析结果
app.post('/api/analysis', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const { notebookId, notebookType, analysisData, mode = 'ai' } = req.body;
    
    if (!notebookId || !analysisData) {
      return res.status(400).json({ 
        success: false, 
        message: '缺少必要参数：notebookId, analysisData' 
      });
    }

    // 检查是否已存在该笔记本的分析结果（可选：根据 notebookId 查找）
    const existing = await db.all(
      'SELECT * FROM analysis_results WHERE notebook_id = ? ORDER BY created_at DESC LIMIT 1',
      [notebookId]
    );

    let analysisId;
    const now = new Date().toISOString();
    
    if (existing && existing.length > 0) {
      // 如果已存在，更新现有记录
      analysisId = existing[0].id;
      await db.run(
        'UPDATE analysis_results SET analysis_data = ?, mode = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(analysisData), mode, now, analysisId]
      );
      console.log(`✅ 成功更新分析结果: ${analysisId} (笔记本: ${notebookId})`);
    } else {
      // 如果不存在，创建新记录
      analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.run(
        `INSERT INTO analysis_results (id, notebook_id, notebook_type, mode, analysis_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [analysisId, notebookId, notebookType || 'custom', mode, JSON.stringify(analysisData), now, now]
      );
      console.log(`✅ 成功创建分析结果: ${analysisId} (笔记本: ${notebookId})`);
    }

    res.status(201).json({
      success: true,
      message: existing && existing.length > 0 ? '分析结果更新成功' : '分析结果创建成功',
      data: {
        id: analysisId,
        notebookId,
        notebookType: notebookType || 'custom',
        mode,
        createdAt: now
      }
    });
  } catch (error) {
    console.error('❌ 创建分析结果失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '创建分析结果失败', 
      error: error.message 
    });
  }
});

// 删除分析结果
app.delete('/api/analysis/:analysisId', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const { analysisId } = req.params;
    
    const analysis = await db.get(
      'SELECT * FROM analysis_results WHERE id = ?',
      [analysisId]
    );
    
    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: '分析结果不存在'
      });
    }

    await db.run('DELETE FROM analysis_results WHERE id = ?', [analysisId]);

    console.log(`✅ 成功删除分析结果: ${analysisId}`);

    res.json({
      success: true,
      message: '分析结果删除成功'
    });
  } catch (error) {
    console.error('❌ 删除分析结果失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '删除分析结果失败', 
      error: error.message 
    });
  }
});

// 运行分析并保存结果 (UnifiedAnalysisMode 调用)
app.post('/api/analysis-run', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const { notebookId, noteIds = [], dateRange = {}, fields = {}, chart = {}, prompt } = req.body || {};

    if (!notebookId) {
      return res.status(400).json({ success: false, message: 'notebookId is required' });
    }

    // 获取笔记本信息
    const notebook = await db.get('SELECT * FROM notebooks WHERE notebook_id = ?', [notebookId]);
    if (!notebook) {
      return res.status(404).json({ success: false, message: 'Notebook not found' });
    }

    let notebookComponentInstances = [];
    try {
      const config = typeof notebook.component_config === 'string'
        ? JSON.parse(notebook.component_config)
        : notebook.component_config || {};
      if (config?.componentInstances && Array.isArray(config.componentInstances)) {
        notebookComponentInstances = config.componentInstances;
      }
    } catch (error) {
      console.warn('⚠️ [analysis-run] 无法解析 notebook.component_config:', error.message);
    }

    const titleToId = {};
    const idToTitle = {};
    notebookComponentInstances.forEach((inst) => {
      if (!inst || typeof inst !== 'object') return;
      if (inst.title && inst.id) {
        titleToId[inst.title] = inst.id;
        idToTitle[inst.id] = inst.title;
      }
    });

    const resolveFieldId = (rawId, rawTitle) => {
      if (rawId && String(rawId).trim()) return String(rawId).trim();
      if (rawTitle && titleToId[rawTitle]) return titleToId[rawTitle];
      return rawTitle || rawId || '';
    };

    const normalizeTitle = (fieldId, providedTitle, fallback = '') => {
      if (providedTitle && String(providedTitle).trim()) return String(providedTitle).trim();
      if (fieldId && idToTitle[fieldId]) return idToTitle[fieldId];
      return fallback;
    };

    const rawTooltipIds = Array.isArray(fields.tooltipIds)
      ? fields.tooltipIds
      : (Array.isArray(fields.tooltipTitles) ? fields.tooltipTitles : []);

    const xId = resolveFieldId(fields.xId, fields.xTitle) || 'created_at';
    const yId = resolveFieldId(fields.yId, fields.yTitle) || 'title';
    const pointId = resolveFieldId(fields.pointId, fields.pointTitle);
    const tooltipIds = rawTooltipIds.map((item) => resolveFieldId(item, item)).filter(Boolean);

    const xTitleDisplay = normalizeTitle(xId, fields.xTitle, '日期');
    const yTitleDisplay = normalizeTitle(yId, fields.yTitle, '数值');
    const pointTitleDisplay = normalizeTitle(pointId, fields.pointTitle, '');
    const tooltipTitles = Array.isArray(fields.tooltipTitles)
      ? fields.tooltipTitles.map((title, index) => normalizeTitle(tooltipIds[index], title, ''))
      : tooltipIds.map((id, index) => normalizeTitle(id, rawTooltipIds[index], ''));

    // 构建查询
    let notesQuery = 'SELECT * FROM notes WHERE notebook_id = ?';
    const queryParams = [notebookId];

    if (Array.isArray(noteIds) && noteIds.length > 0) {
      const sanitizedIds = noteIds
        .map((id) => parseInt(id, 10))
        .filter((id) => Number.isFinite(id));
      if (sanitizedIds.length === 0) {
        return res.json({
          success: true,
          data: {
            chart: {
              chartConfigs: [],
              fieldMappings: [],
              processedData: { notes: [], metadata: { noteCount: 0, dateRange: dateRange || {}, notebookId, noteIds: [] } }
            },
            ai: { insights: [] },
            metadata: { noteCount: 0, dateRange: dateRange || {}, notebookId }
          }
        });
      }
      const placeholders = sanitizedIds.map(() => '?').join(',');
      notesQuery += ` AND note_id IN (${placeholders})`;
      queryParams.push(...sanitizedIds);
    } else {
      if (dateRange?.from) {
        notesQuery += ' AND created_at >= ?';
        queryParams.push(dateRange.from);
      }
      if (dateRange?.to) {
        notesQuery += ' AND created_at <= ?';
        queryParams.push(`${dateRange.to}T23:59:59`);
      }
    }

    notesQuery += ' ORDER BY created_at ASC';

    const noteRows = await db.all(notesQuery, queryParams);

    const parsedNotes = noteRows.map((note) => {
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
        title: note.title,
        content_text: note.content_text,
        created_at: note.created_at,
        updated_at: note.updated_at || note.created_at,
        component_data: componentData,
        component_instances: componentInstances
      };
    });

    const extractValue = (note, fieldId) => {
      if (!fieldId) return '';
      if (note.component_data && note.component_data[fieldId]) {
        const entry = note.component_data[fieldId];
        if (entry && typeof entry === 'object' && 'value' in entry) {
          return entry.value;
        }
      }
      if (fieldId === 'created_at') return note.created_at || '';
      if (fieldId === 'title') return note.title || '';
      if (fieldId === 'content_text') return note.content_text || '';
      return '';
    };

    const chartData = [];
    parsedNotes.forEach((note) => {
      const xRaw = extractValue(note, xId);
      const yRaw = extractValue(note, yId);
      if (xRaw === '' || yRaw === '') return;

      let xValue = xRaw;
      const date = new Date(xRaw);
      if (!Number.isNaN(date.getTime())) {
        xValue = date.toISOString().slice(0, 10);
      }

      let yValue = yRaw;
      if (typeof yRaw !== 'number') {
        const asNumber = Number(yRaw);
        if (Number.isFinite(asNumber)) {
          yValue = asNumber;
        }
      }

      const tooltip = tooltipIds.map((id, index) => ({
        id,
        label: tooltipTitles[index] || id,
        value: extractValue(note, id)
      }));

      const dataPoint = {
        x: xValue,
        y: yValue,
        id: note.id,
        title: note.title || '',
        tooltip
      };

      if (pointId) {
        const pointValue = extractValue(note, pointId);
        dataPoint.point = pointValue;
        dataPoint[pointId] = pointValue;
      }

      chartData.push(dataPoint);
    });

    const inferDataType = (fieldId, fallback = 'text') => {
      if (!fieldId) return fallback;
      const lower = String(fieldId).toLowerCase();
      if (lower.includes('date') || lower.includes('time') || lower === 'created_at') return 'date';
      if (lower.includes('score') || lower.includes('count') || lower.includes('value') || lower.includes('number')) return 'number';
      return fallback;
    };

    const buildFieldMapping = (fieldId, displayName, role) => {
      if (!fieldId) return null;
      const dataType = inferDataType(fieldId, role === 'x' ? 'date' : 'text');
      const targetField = displayName || idToTitle[fieldId] || fieldId;
      return {
        id: fieldId,
        sourceField: fieldId,
        targetField,
        dataType,
        role,
        status: 'user_confirmed',
        finalConfig: {
          targetField,
          dataType,
          role
        }
      };
    };

    const fieldMappings = [
      buildFieldMapping(xId, xTitleDisplay, 'x'),
      buildFieldMapping(yId, yTitleDisplay, 'y'),
      buildFieldMapping(pointId, pointTitleDisplay, 'point'),
      ...tooltipIds.map((tid, index) =>
        buildFieldMapping(tid, tooltipTitles[index] || tid, 'tooltip')
      )
    ].filter(Boolean);

    const chartType = chart?.chartType || 'line';
    const chartTitle = chart?.title || '智能分析图表';
    const axisDisplay = {
      x: xTitleDisplay ? [xTitleDisplay] : ['X 轴'],
      y: yTitleDisplay ? [yTitleDisplay] : ['Y 轴']
    };

    const fieldAliasMap = {};
    const registerAlias = (key, label) => {
      if (!key || !label) return;
      fieldAliasMap[String(key)] = String(label);
    };
    registerAlias(xId, xTitleDisplay || xId);
    registerAlias('x', xTitleDisplay || xId);
    registerAlias(yId, yTitleDisplay || yId);
    registerAlias('y', yTitleDisplay || yId);
    if (pointId) {
      registerAlias(pointId, pointTitleDisplay || pointId);
      registerAlias('point', pointTitleDisplay || pointId);
      registerAlias('pointField', pointTitleDisplay || pointId);
    }
    tooltipIds.forEach((tid, index) => {
      const label = tooltipTitles[index] || tid;
      registerAlias(tid, label);
      registerAlias(`tooltip${index}`, label);
    });

    const chartConfigs = [
      {
        id: 'chart_0',
        type: chartType,
        config: {
          xField: 'x',
          yField: 'y',
          title: chartTitle,
          pointField: pointId,
          pointDisplay: pointId ? [pointId] : [],
          tooltipFields: tooltipIds,
          axisDisplay,
          fieldAliasMap
        },
        data: chartData,
        rendered: false
      }
    ];

    let insights = [];
    const normalizedNotebookType = (notebook?.type && String(notebook.type).trim()) || 'custom';

    if (prompt && typeof prompt === 'string' && prompt.trim()) {
      try {
        const aiService = new AIService();
        insights = await aiService.generateInsights(normalizedNotebookType, prompt.trim(), parsedNotes);
      } catch (error) {
        console.error('❌ [analysis-run] AI insights error:', error?.message || error);
        insights = [];
      }
    }

    return res.json({
      success: true,
      data: {
        chart: {
          chartConfigs,
          fieldMappings,
          processedData: {
            notes: parsedNotes,
            metadata: {
              noteCount: parsedNotes.length,
              dateRange: dateRange || {},
              notebookType: normalizedNotebookType,
              notebookId,
              noteIds: parsedNotes.map((note) => note.id)
            }
          }
        },
        ai: { insights },
        metadata: {
          noteCount: parsedNotes.length,
          dateRange: dateRange || {},
          notebookId
        }
      }
    });
  } catch (error) {
    console.error('❌ [analysis-run] 分析失败:', error);
    const message = error?.message || '未知错误';
    return res.status(500).json({
      success: false,
      message: `分析失败: ${message}`,
      error: message
    });
  }
});

// 保存AI分析配置（图表和AI自定义配置）
app.post('/api/ai-analysis-config', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ success: false, error: '数据库未连接' });
    }

    const {
      notebook_id,
      notebook_type = 'custom',
      existing_fields = [],
      ai_recommended_fields = [],
      custom_fields = [],
      all_fields = [],
      custom_prompt = null,
      selected_prompt_id = null,
      selected_prompt_name = null,
      analysis_components = [],
      analysis_params = {}
    } = req.body || {};

    if (!notebook_id) {
      return res.status(400).json({ success: false, message: 'notebook_id is required' });
    }

    // 构建配置对象
    const configData = {
      existing_fields,
      ai_recommended_fields,
      custom_fields,
      all_fields,
      custom_prompt,
      selected_prompt_id,
      selected_prompt_name,
      analysis_components,
      analysis_params,
      updated_at: new Date().toISOString()
    };

    // 检查是否已存在配置
    const existing = await db.get(
      'SELECT * FROM ai_analysis_setting WHERE notebook_id = ?',
      [notebook_id]
    );

    if (existing) {
      // 更新现有配置
      await db.run(
        'UPDATE ai_analysis_setting SET config_data = ?, updated_at = ? WHERE notebook_id = ?',
        [JSON.stringify(configData), new Date().toISOString(), notebook_id]
      );
      console.log(`✅ 更新AI分析配置: ${notebook_id}`);
    } else {
      // 创建新配置
      await db.run(
        'INSERT INTO ai_analysis_setting (notebook_id, notebook_type, config_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [notebook_id, notebook_type, JSON.stringify(configData), new Date().toISOString(), new Date().toISOString()]
      );
      console.log(`✅ 创建AI分析配置: ${notebook_id}`);
    }

    res.json({
      success: true,
      message: '配置保存成功',
      data: {
        notebook_id,
        notebook_type,
        config: configData
      }
    });
  } catch (error) {
    console.error('❌ 保存AI分析配置失败:', error);
    res.status(500).json({
      success: false,
      message: '保存配置失败',
      error: error.message
    });
  }
});

// ==================== 分析相关 API 结束 ====================

// 初始化数据库和路由
async function startServer() {
  try {
    console.log('🔄 正在初始化数据库...');
    db = await initDB();
    console.log('✅ 数据库初始化完成');

    // 注册解析路由
    const parseRouter = initParseRoutes(db);
    app.use('/', parseRouter);

    // 启动服务器
    app.listen(PORT, () => {
      console.log(`[backend] listening on http://localhost:${PORT}`);
      console.log('📝 解析接口已启用:');
      console.log('  - POST /api/coze/parse-article');
      console.log('  - GET /api/coze/parse-history');
      console.log('  - GET /api/coze/parse-history/:id');
      console.log('  - PUT /api/coze/parse-history/:id');
      console.log('  - DELETE /api/coze/parse-history/:id');
      console.log('📊 分析接口已启用:');
      console.log('  - POST /api/analysis');
      console.log('  - GET /api/analysis');
      console.log('  - GET /api/analysis/:id');
      console.log('  - DELETE /api/analysis/:id');
    });
  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
}

// 启动服务器
startServer();
