/**
 * 解析相关路由
 * 包含文章解析、解析历史管理等接口
 */

import express from 'express';
import axios from 'axios';
import { consumeCozeStream, normalizeParseHistoryStatus, getParseHistoryStatusVariants, parseCozeResponseData } from '../lib/utils.js';
import AIService from '../services/ai-service.js';

const router = express.Router();

/**
 * 初始化解析路由
 * @param {object} db - 数据库实例
 * @returns {express.Router}
 */
export function initParseRoutes(db) {
  const aiService = new AIService();
  // 解析文章链接
  router.post('/api/coze/parse-article', async (req, res) => {
    try {
      const { articleUrl, query } = req.body;
      
      if (!articleUrl || typeof articleUrl !== 'string' || !articleUrl.trim()) {
        return res.status(400).json({ 
          success: false, 
          error: '请提供有效的文章URL' 
        });
      }

      // Coze工作流配置（从环境变量获取）
      const COZE_WEBHOOK_URL = (process.env.COZE_WEBHOOK_URL || '').trim();
      const COZE_API_KEY = (process.env.COZE_API_KEY || process.env.COZE_SERVICE_IDENTITY || '').trim();
      const COZE_WORKFLOW_ID = (process.env.COZE_WORKFLOW_ID || process.env.COZE_BOT_ID || '').trim();
      
      console.log('🔍 Coze配置检查:');
      console.log('- COZE_WEBHOOK_URL:', COZE_WEBHOOK_URL ? '已配置' : '未配置');
      console.log('- COZE_API_KEY:', COZE_API_KEY ? `${COZE_API_KEY.substring(0, 15)}...` : '未配置');
      console.log('- COZE_WORKFLOW_ID:', COZE_WORKFLOW_ID || '未配置');
      
      if (!COZE_WEBHOOK_URL && (!COZE_API_KEY || !COZE_WORKFLOW_ID)) {
        return res.status(500).json({ 
          success: false, 
          error: 'Coze API配置未设置，请在环境变量中配置 COZE_WEBHOOK_URL 或 COZE_API_KEY + COZE_WORKFLOW_ID' 
        });
      }

      console.log('📝 调用Coze工作流解析文章:', articleUrl);
      
      let parsedContent = '';
      let suggestedNotebookName = null;
      let historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let chatId = null;
      let conversationId = null;
      let responseData = null;
      
      // 方式1: 使用Webhook URL（推荐）
      if (COZE_WEBHOOK_URL) {
        try {
          const webhookPayload = {
            url: articleUrl.trim(),
            query: query || '请提取并整理这篇文章的主要内容，保留关键信息。同时根据文章内容推荐一个合适的笔记本分类（如果有）。'
          };

          const webhookResponse = await axios.post(COZE_WEBHOOK_URL, webhookPayload, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 90000 // 90秒超时
          });

          console.log('✅ Coze工作流调用成功');
          
          responseData = webhookResponse.data;
          if (typeof responseData === 'string') {
            parsedContent = responseData;
          } else if (responseData?.content) {
            parsedContent = responseData.content;
            suggestedNotebookName = responseData.suggestedNotebookName || responseData.notebook;
          } else if (responseData?.answer) {
            parsedContent = responseData.answer;
          } else if (responseData?.result) {
            parsedContent = typeof responseData.result === 'string' 
              ? responseData.result 
              : JSON.stringify(responseData.result, null, 2);
          } else {
            parsedContent = JSON.stringify(responseData, null, 2);
          }
          historyId = responseData?.historyId || historyId;
        } catch (webhookError) {
          console.error('❌ Coze Webhook调用失败:', webhookError.message);
          throw webhookError;
        }
      } 
      // 方式2: 使用Coze API（需要API Key）
      else if (COZE_API_KEY && COZE_WORKFLOW_ID) {
        try {
          const cozeApiUrl = `https://api.coze.cn/v3/chat`;

          const userMessage = query
            ? `请解析以下链接的文章内容：${articleUrl.trim()}\n\n具体要求：${query}`
            : `请解析以下链接的文章内容，提取并整理主要内容和关键信息，并根据文章主题推荐一个合适的笔记本分类：${articleUrl.trim()}`;

          const apiPayload = {
            bot_id: COZE_WORKFLOW_ID,
            user_id: 'article_parser',
            stream: true,
            auto_save_history: true,
            additional_messages: [
              {
                role: 'user',
                content: userMessage,
                content_type: 'text'
              }
            ]
          };

          console.log(`🔄 调用Coze API: ${cozeApiUrl}`);
          console.log(`📦 Bot ID: ${COZE_WORKFLOW_ID}`);

          const apiResponse = await axios.post(cozeApiUrl, apiPayload, {
            headers: {
              Authorization: `Bearer ${COZE_API_KEY}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            responseType: 'stream',
            timeout: 0,
            validateStatus: (status) => status < 500
          });

          const streamResult = await consumeCozeStream(apiResponse.data);
          chatId = streamResult.chatId || chatId;
          conversationId = streamResult.conversationId || conversationId;
          parsedContent = streamResult.answer || parsedContent;
          responseData = {
            chat_id: chatId,
            conversation_id: conversationId,
            events: streamResult.events
          };

          if (!parsedContent) {
            parsedContent = '对话仍在处理中（流式响应缺少最终内容），请稍后查看解析历史。';
          }
        } catch (apiError) {
          console.error('❌ Coze API调用失败:', apiError.message);
          if (apiError.response) {
            console.error('状态码:', apiError.response.status);
            const responseData = apiError.response.data;
            if (typeof responseData === 'string' && responseData.includes('<!DOCTYPE')) {
              throw new Error('Coze API返回了HTML页面而不是JSON，可能是端点错误或需要登录');
            }
          }
          throw apiError;
        }
      }

      // 确定状态
      let historyStatus = 'completed';
      if (!parsedContent || !parsedContent.trim()) {
        historyStatus = 'failed';
      } else if (parsedContent.includes('处理超时') || parsedContent.includes('处理中')) {
        historyStatus = 'processing';
      } else if (parsedContent.includes('失败') || parsedContent.includes('错误')) {
        historyStatus = 'failed';
      }

      // 查找推荐的笔记本ID（如果提供了笔记本名称）
      let suggestedNotebookId = null;
      if (suggestedNotebookName) {
        try {
          const notebookRow = await db.get(
            'SELECT notebook_id FROM notebooks WHERE name = ? LIMIT 1',
            [suggestedNotebookName]
          );
          if (notebookRow) {
            suggestedNotebookId = notebookRow.notebook_id;
          }
        } catch (nbError) {
          console.warn('查找推荐笔记本失败:', nbError);
        }
      }

      // 保存或更新解析历史记录
      const responseDataWithIds = {
        ...(responseData || {}),
        chat_id: chatId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString()
      };
      
      const now = new Date().toISOString();
      const contentToSave = parsedContent && parsedContent.trim() 
        ? parsedContent.trim() 
        : '解析中或解析失败，请稍后查看结果';
      
      try {
        // 检查历史记录是否已存在
        const existingHistory = await db.get(
          'SELECT id FROM article_parse_history WHERE source_url = ? AND created_at > datetime("now", "-5 minutes") ORDER BY created_at DESC LIMIT 1',
          [articleUrl.trim()]
        );
        
        if (existingHistory) {
          historyId = existingHistory.id;
          // 更新现有记录
          await db.run(
            `UPDATE article_parse_history SET 
             parsed_content = ?, suggested_notebook_id = ?, suggested_notebook_name = ?, 
             status = ?, coze_response_data = ?, updated_at = ?, parsed_at = ?
             WHERE id = ?`,
            [
              contentToSave,
              suggestedNotebookId,
              suggestedNotebookName || null,
              historyStatus,
              JSON.stringify(responseDataWithIds),
              now,
              now,
              existingHistory.id
            ]
          );
          console.log('✅ 解析历史已更新:', existingHistory.id);
        } else {
          // 创建新记录
          await db.run(
            `INSERT INTO article_parse_history 
             (id, source_url, parsed_content, suggested_notebook_id, suggested_notebook_name, 
              status, parse_query, coze_response_data, created_at, parsed_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              historyId,
              articleUrl.trim(),
              contentToSave,
              suggestedNotebookId,
              suggestedNotebookName || null,
              historyStatus,
              query || null,
              JSON.stringify(responseDataWithIds),
              now,
              now,
              now
            ]
          );
          console.log('✅ 解析历史已保存:', historyId);
        }
      } catch (historyError) {
        console.error('❌ 保存解析历史失败:', historyError);
      }

      res.json({
        success: true,
        data: {
          content: parsedContent.trim(),
          suggestedNotebookName: suggestedNotebookName,
          suggestedNotebookId: suggestedNotebookId,
          sourceUrl: articleUrl.trim(),
          historyId
        }
      });

    } catch (error) {
      console.error('❌ Coze工作流调用错误:', error);
      
      // 即使出错也要保存历史记录
      const urlToSave = req.body?.articleUrl;
      if (urlToSave) {
        try {
          const errorHistoryId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const now = new Date().toISOString();
          await db.run(
            `INSERT INTO article_parse_history 
             (id, source_url, parsed_content, status, parse_query, coze_response_data, created_at, parsed_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              errorHistoryId,
              urlToSave.trim(),
              `解析失败: ${error?.message || String(error)}`,
              'failed',
              req.body?.query || null,
              JSON.stringify({ 
                error: error?.message || String(error),
                error_code: error.response?.data?.code || null
              }),
              now,
              now,
              now
            ]
          );
          console.log('✅ 错误历史已保存:', errorHistoryId);
        } catch (historyError) {
          console.error('❌ 保存错误历史失败:', historyError);
        }
      }
      
      res.status(500).json({
        success: false,
        error: error.response?.data?.error || error.message || '调用Coze工作流失败',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

  // 获取解析历史列表
  router.get('/api/coze/parse-history', async (req, res) => {
    try {
      const { page = 1, limit = 20, status, notebook_id } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      let query = 'SELECT * FROM article_parse_history WHERE 1=1';
      const params = [];
      
      if (status && status !== 'all') {
        const variants = getParseHistoryStatusVariants(status);
        if (variants.length > 0) {
          query += ` AND status IN (${variants.map(() => '?').join(', ')})`;
          params.push(...variants);
        }
      }
      
      if (notebook_id) {
        query += ' AND (suggested_notebook_id = ? OR assigned_notebook_id = ?)';
        params.push(notebook_id, notebook_id);
      }
      
      query += ' ORDER BY COALESCE(parsed_at, created_at) DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
      
      const historyList = await db.all(query, params);
      
      // 获取总数
      let countQuery = 'SELECT COUNT(*) as total FROM article_parse_history WHERE 1=1';
      const countParams = [];
      
      if (status && status !== 'all') {
        const variants = getParseHistoryStatusVariants(status);
        if (variants.length > 0) {
          countQuery += ` AND status IN (${variants.map(() => '?').join(', ')})`;
          countParams.push(...variants);
        }
      }
      
      if (notebook_id) {
        countQuery += ' AND (suggested_notebook_id = ? OR assigned_notebook_id = ?)';
        countParams.push(notebook_id, notebook_id);
      }
      
      const countResult = await db.get(countQuery, countParams);
      
      res.json({
        success: true,
        data: {
          items: historyList || [],
          total: countResult?.total || 0,
          page: parseInt(page),
          limit: parseInt(limit)
        }
      });
    } catch (error) {
      console.error('❌ 获取解析历史失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 获取单个解析历史详情
  router.get('/api/coze/parse-history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      const history = await db.get('SELECT * FROM article_parse_history WHERE id = ?', [id]);
      
      if (!history) {
        return res.status(404).json({ success: false, error: '历史记录不存在' });
      }
      
      // 解析 parsed_fields 和 parsed_img_urls
      let parsedFields = null;
      let parsedImgUrls = null;
      
      if (history.parsed_fields) {
        try {
          parsedFields = typeof history.parsed_fields === 'string' 
            ? JSON.parse(history.parsed_fields) 
            : history.parsed_fields;
          
          // 提取图片URLs
          const imgValue = parsedFields.img_urls || parsedFields.images || parsedFields.image_urls;
          if (Array.isArray(imgValue) && imgValue.length > 0) {
            parsedImgUrls = imgValue;
          } else if (imgValue) {
            parsedImgUrls = [String(imgValue)];
          }
        } catch (e) {
          console.warn('解析 parsed_fields 失败:', e);
        }
      }
      
      res.json({
        success: true,
        data: {
          ...history,
          parsed_fields: parsedFields,
          parsed_img_urls: parsedImgUrls,
          status: normalizeParseHistoryStatus(history.status)
        }
      });
    } catch (error) {
      console.error('❌ 获取解析历史详情失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 更新解析历史
  router.put('/api/coze/parse-history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        assigned_notebook_id, 
        assigned_notebook_name,
        status,
        notes,
        tags,
        parsed_content,
        parsed_fields,
        parsed_title,
        parsed_summary,
        parsed_author,
        parsed_published_at,
        parsed_platform,
        parsed_source
      } = req.body;
      
      const updates = [];
      const params = [];
      
      if (assigned_notebook_id !== undefined) {
        updates.push('assigned_notebook_id = ?');
        params.push(assigned_notebook_id || null);
      }
      
      if (assigned_notebook_name !== undefined) {
        updates.push('assigned_notebook_name = ?');
        params.push(assigned_notebook_name || null);
      }
      
      if (status !== undefined) {
        updates.push('status = ?');
        params.push(normalizeParseHistoryStatus(status));
      }
      
      if (notes !== undefined) {
        updates.push('notes = ?');
        params.push(notes || null);
      }
      
      if (tags !== undefined) {
        updates.push('tags = ?');
        params.push(Array.isArray(tags) ? JSON.stringify(tags) : tags || null);
      }
      
      if (parsed_content !== undefined) {
        updates.push('parsed_content = ?');
        params.push(parsed_content || null);
      }
      
      if (parsed_fields !== undefined) {
        updates.push('parsed_fields = ?');
        params.push(typeof parsed_fields === 'object' ? JSON.stringify(parsed_fields) : parsed_fields || null);
      }
      
      if (parsed_title !== undefined) {
        updates.push('parsed_title = ?');
        params.push(parsed_title || null);
      }
      
      if (parsed_summary !== undefined) {
        updates.push('parsed_summary = ?');
        params.push(parsed_summary || null);
      }
      
      if (parsed_author !== undefined) {
        updates.push('parsed_author = ?');
        params.push(parsed_author || null);
      }
      
      if (parsed_published_at !== undefined) {
        updates.push('parsed_published_at = ?');
        params.push(parsed_published_at || null);
      }
      
      if (parsed_platform !== undefined) {
        updates.push('parsed_platform = ?');
        params.push(parsed_platform || null);
      }
      
      if (parsed_source !== undefined) {
        updates.push('parsed_source = ?');
        params.push(parsed_source || null);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ success: false, error: '没有要更新的字段' });
      }
      
      updates.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(id);
      
      await db.run(
        `UPDATE article_parse_history SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      
      res.json({ success: true, message: '更新成功' });
    } catch (error) {
      console.error('❌ 更新解析历史失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 删除解析历史
  router.delete('/api/coze/parse-history/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      await db.run('DELETE FROM article_parse_history WHERE id = ?', [id]);
      
      res.json({ success: true, message: '删除成功' });
    } catch (error) {
      console.error('❌ 删除解析历史失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 解析文本内容（手动输入笔记）
  router.post('/api/parse-text', async (req, res) => {
    try {
      const { title, content, summary, keywords, structuredFields, aiSummaryConfig } = req.body;
      
      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, error: '笔记内容不能为空' });
      }

      // 如果启用了 AI 摘要，生成摘要
      let finalSummary = summary;
      if (aiSummaryConfig?.enabled && aiSummaryConfig?.prompt) {
        try {
          const summaryPrompt = `${aiSummaryConfig.prompt}\n\n内容：${content}`;
          finalSummary = await aiService.generateText(summaryPrompt, {
            temperature: 0.7,
            maxTokens: 500
          });
        } catch (summaryError) {
          console.warn('⚠️ AI 摘要生成失败，使用原始摘要:', summaryError);
        }
      }

      // 生成历史记录 ID
      const historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      // 构建 parsed_fields
      const parsedFields = {
        title: title || content.split('\n')[0].slice(0, 60) || '未命名笔记',
        content: content.trim(),
        summary: finalSummary || null,
        keywords: Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []),
        ...(structuredFields || {})
      };

      // 保存到解析历史
      await db.run(
        `INSERT INTO article_parse_history 
         (id, source_url, parsed_content, parsed_title, parsed_summary, 
          status, parsed_fields, tags, created_at, parsed_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyId,
          null, // source_url 为 null（手动输入）
          content.trim(),
          parsedFields.title,
          finalSummary || null,
          'completed',
          JSON.stringify(parsedFields),
          parsedFields.keywords.length > 0 ? JSON.stringify(parsedFields.keywords) : null,
          now,
          now,
          now
        ]
      );

      console.log('✅ 文本解析历史已保存:', historyId);

      res.json({
        success: true,
        data: {
          historyId,
          title: parsedFields.title,
          content: content.trim(),
          summary: finalSummary,
          keywords: parsedFields.keywords
        }
      });
    } catch (error) {
      console.error('❌ 解析文本失败:', error);
      res.status(500).json({ success: false, error: error.message || '解析文本失败' });
    }
  });

  // 解析文本并自动分配
  router.post('/api/parse-and-assign-text', async (req, res) => {
    try {
      const { title, content, summary, keywords, structuredFields, aiSummaryConfig } = req.body;
      
      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, error: '笔记内容不能为空' });
      }

      // 获取笔记本列表
      const notebookRows = await db.all(
        'SELECT notebook_id, name, description, note_count FROM notebooks ORDER BY updated_at DESC'
      );
      const notebooks = (notebookRows || []).map((row) => ({
        notebook_id: row?.notebook_id ? String(row.notebook_id) : null,
        name: row?.name || '',
        description: row?.description || '',
        note_count: typeof row?.note_count === 'number' ? row.note_count : Number(row?.note_count || 0) || 0
      }));

      // 使用 AI 生成笔记草稿并推荐笔记本
      const aiResult = await aiService.generateNoteDraftsFromText(content, notebooks, {});

      const draft = aiResult.drafts && aiResult.drafts.length > 0 ? aiResult.drafts[0] : null;
      const suggestedNotebookName = draft?.suggestedNotebookName || null;
      const suggestedNotebookId = draft?.suggestedNotebookId || null;

      // 生成历史记录 ID
      const historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      // 如果启用了 AI 摘要，生成摘要
      let finalSummary = summary || draft?.summary;
      if (aiSummaryConfig?.enabled && aiSummaryConfig?.prompt) {
        try {
          const summaryPrompt = `${aiSummaryConfig.prompt}\n\n内容：${content}`;
          finalSummary = await aiService.generateText(summaryPrompt, {
            temperature: 0.7,
            maxTokens: 500
          });
        } catch (summaryError) {
          console.warn('⚠️ AI 摘要生成失败，使用原始摘要:', summaryError);
        }
      }

      // 构建 parsed_fields
      const parsedFields = {
        title: title || draft?.title || content.split('\n')[0].slice(0, 60) || '未命名笔记',
        content: content.trim(),
        summary: finalSummary || null,
        keywords: Array.isArray(keywords) ? keywords : 
                 (Array.isArray(draft?.topics) ? draft.topics : 
                 (keywords ? [keywords] : [])),
        ...(structuredFields || {})
      };

      // 保存到解析历史
      await db.run(
        `INSERT INTO article_parse_history 
         (id, source_url, parsed_content, parsed_title, parsed_summary, 
          suggested_notebook_id, suggested_notebook_name,
          status, parsed_fields, tags, created_at, parsed_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyId,
          null, // source_url 为 null（手动输入）
          content.trim(),
          parsedFields.title,
          finalSummary || null,
          suggestedNotebookId,
          suggestedNotebookName,
          'completed',
          JSON.stringify(parsedFields),
          parsedFields.keywords.length > 0 ? JSON.stringify(parsedFields.keywords) : null,
          now,
          now,
          now
        ]
      );

      console.log('✅ 文本解析并分配历史已保存:', historyId);

      res.json({
        success: true,
        data: {
          historyId,
          assigned: !!suggestedNotebookId,
          suggestedNotebookId,
          suggestedNotebookName,
          message: suggestedNotebookId 
            ? `解析成功并已自动分配到笔记本：${suggestedNotebookName || '未知'}`
            : '解析成功，但未找到推荐的笔记本',
          title: parsedFields.title,
          content: content.trim(),
          summary: finalSummary,
          keywords: parsedFields.keywords
        }
      });
    } catch (error) {
      console.error('❌ 解析文本并分配失败:', error);
      res.status(500).json({ success: false, error: error.message || '解析文本并分配失败' });
    }
  });

  // 解析并自动分配（从链接）
  router.post('/api/coze/parse-and-assign', async (req, res) => {
    try {
      const { articleUrl, query } = req.body;
      
      if (!articleUrl || typeof articleUrl !== 'string' || !articleUrl.trim()) {
        return res.status(400).json({ 
          success: false, 
          error: '请提供有效的文章URL' 
        });
      }

      // 复用解析文章的逻辑
      const COZE_WEBHOOK_URL = (process.env.COZE_WEBHOOK_URL || '').trim();
      const COZE_API_KEY = (process.env.COZE_API_KEY || process.env.COZE_SERVICE_IDENTITY || '').trim();
      const COZE_WORKFLOW_ID = (process.env.COZE_WORKFLOW_ID || process.env.COZE_BOT_ID || '').trim();
      
      if (!COZE_WEBHOOK_URL && (!COZE_API_KEY || !COZE_WORKFLOW_ID)) {
        return res.status(500).json({ 
          success: false, 
          error: 'Coze API配置未设置' 
        });
      }

      let parsedContent = '';
      let suggestedNotebookName = null;
      let historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let chatId = null;
      let conversationId = null;
      let responseData = null;
      
      // 方式1: 使用Webhook URL
      if (COZE_WEBHOOK_URL) {
        try {
          const webhookPayload = {
            url: articleUrl.trim(),
            query: query || '请提取并整理这篇文章的主要内容，保留关键信息。同时根据文章内容推荐一个合适的笔记本分类（如果有）。'
          };

          const webhookResponse = await axios.post(COZE_WEBHOOK_URL, webhookPayload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 90000
          });

          responseData = webhookResponse.data;
          if (typeof responseData === 'string') {
            parsedContent = responseData;
          } else if (responseData?.content) {
            parsedContent = responseData.content;
            suggestedNotebookName = responseData.suggestedNotebookName || responseData.notebook;
          } else if (responseData?.answer) {
            parsedContent = responseData.answer;
          } else {
            parsedContent = JSON.stringify(responseData, null, 2);
          }
          historyId = responseData?.historyId || historyId;
        } catch (webhookError) {
          console.error('❌ Coze Webhook调用失败:', webhookError.message);
          throw webhookError;
        }
      } 
      // 方式2: 使用Coze API
      else if (COZE_API_KEY && COZE_WORKFLOW_ID) {
        try {
          const cozeApiUrl = `https://api.coze.cn/v3/chat`;
          const userMessage = query
            ? `请解析以下链接的文章内容：${articleUrl.trim()}\n\n具体要求：${query}`
            : `请解析以下链接的文章内容，提取并整理主要内容和关键信息，并根据文章主题推荐一个合适的笔记本分类：${articleUrl.trim()}`;

          const apiPayload = {
            bot_id: COZE_WORKFLOW_ID,
            user_id: 'article_parser',
            stream: true,
            auto_save_history: true,
            additional_messages: [{
              role: 'user',
              content: userMessage,
              content_type: 'text'
            }]
          };

          const apiResponse = await axios.post(cozeApiUrl, apiPayload, {
            headers: {
              Authorization: `Bearer ${COZE_API_KEY}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            },
            responseType: 'stream',
            timeout: 0,
            validateStatus: (status) => status < 500
          });

          const streamResult = await consumeCozeStream(apiResponse.data);
          chatId = streamResult.chatId;
          conversationId = streamResult.conversationId;
          parsedContent = streamResult.answer || '对话仍在处理中，请稍后查看解析历史。';
          responseData = {
            chat_id: chatId,
            conversation_id: conversationId,
            events: streamResult.events
          };
        } catch (apiError) {
          console.error('❌ Coze API调用失败:', apiError.message);
          throw apiError;
        }
      }

      // 确定状态
      let historyStatus = 'completed';
      if (!parsedContent || !parsedContent.trim()) {
        historyStatus = 'failed';
      } else if (parsedContent.includes('处理超时') || parsedContent.includes('处理中')) {
        historyStatus = 'processing';
      }

      // 查找推荐的笔记本ID
      let suggestedNotebookId = null;
      if (suggestedNotebookName) {
        try {
          const notebookRow = await db.get(
            'SELECT notebook_id FROM notebooks WHERE name = ? LIMIT 1',
            [suggestedNotebookName]
          );
          if (notebookRow) {
            suggestedNotebookId = notebookRow.notebook_id;
          }
        } catch (nbError) {
          console.warn('查找推荐笔记本失败:', nbError);
        }
      }

      // 保存解析历史并自动分配
      const responseDataWithIds = {
        ...(responseData || {}),
        chat_id: chatId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString()
      };
      
      const now = new Date().toISOString();
      const contentToSave = parsedContent && parsedContent.trim() 
        ? parsedContent.trim() 
        : '解析中或解析失败，请稍后查看结果';
      
      try {
        const existingHistory = await db.get(
          'SELECT id FROM article_parse_history WHERE source_url = ? AND created_at > datetime("now", "-5 minutes") ORDER BY created_at DESC LIMIT 1',
          [articleUrl.trim()]
        );
        
        if (existingHistory) {
          historyId = existingHistory.id;
          await db.run(
            `UPDATE article_parse_history SET 
             parsed_content = ?, suggested_notebook_id = ?, suggested_notebook_name = ?, 
             assigned_notebook_id = ?, assigned_notebook_name = ?,
             status = ?, coze_response_data = ?, updated_at = ?, parsed_at = ?
             WHERE id = ?`,
            [
              contentToSave,
              suggestedNotebookId,
              suggestedNotebookName || null,
              suggestedNotebookId, // 自动分配
              suggestedNotebookName || null, // 自动分配
              historyStatus,
              JSON.stringify(responseDataWithIds),
              now,
              now,
              existingHistory.id
            ]
          );
        } else {
          await db.run(
            `INSERT INTO article_parse_history 
             (id, source_url, parsed_content, suggested_notebook_id, suggested_notebook_name, 
              assigned_notebook_id, assigned_notebook_name,
              status, parse_query, coze_response_data, created_at, parsed_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              historyId,
              articleUrl.trim(),
              contentToSave,
              suggestedNotebookId,
              suggestedNotebookName || null,
              suggestedNotebookId, // 自动分配
              suggestedNotebookName || null, // 自动分配
              historyStatus,
              query || null,
              JSON.stringify(responseDataWithIds),
              now,
              now,
              now
            ]
          );
        }
      } catch (historyError) {
        console.error('❌ 保存解析历史失败:', historyError);
      }

      res.json({
        success: true,
        data: {
          historyId,
          assigned: !!suggestedNotebookId,
          message: suggestedNotebookId 
            ? `解析成功并已自动分配到笔记本：${suggestedNotebookName || '未知'}`
            : '解析成功，但未找到推荐的笔记本',
          suggestedNotebookId,
          suggestedNotebookName,
          sourceUrl: articleUrl.trim()
        }
      });
    } catch (error) {
      console.error('❌ 解析并分配失败:', error);
      res.status(500).json({ 
        success: false, 
        error: error.response?.data?.error || error.message || '解析并分配失败' 
      });
    }
  });

  return router;
}

