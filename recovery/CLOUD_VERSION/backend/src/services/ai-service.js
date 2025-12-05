/**
 * AI 服务
 * 支持豆包 API 和 OpenAI API
 */

export default class AIService {
  constructor() {
    // 豆包配置
    this.doubaoBaseUrl = process.env.DOUBAO_BASE_URL || '';
    this.doubaoApiKey = process.env.DOUBAO_API_KEY || '';
    this.doubaoModel = process.env.DOUBAO_MODEL || 'ep-m-20250820074553-br22h';
    this.doubaoConfigured = !!(this.doubaoBaseUrl && this.doubaoApiKey);

    // OpenAI 配置
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.openaiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    this.openaiModel = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

    // 确定使用的提供商
    this.provider = this.doubaoConfigured ? 'doubao' : (this.openaiApiKey ? 'openai' : 'mock');
    
    // Anthropic 配置（可选）
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  }

  /**
   * 调用 AI API 生成文本
   * @param {string} prompt - 提示词
   * @param {object} options - 选项
   * @returns {Promise<string>}
   */
  async generateText(prompt, options = {}) {
    if (this.provider === 'mock') {
      return 'AI 服务未配置，返回模拟响应';
    }

    const messages = options.messages || [
      { role: 'user', content: prompt }
    ];
    const temperature = options.temperature || 0.7;
    const maxTokens = options.maxTokens || 2000;

    if (this.provider === 'doubao') {
      return this._callDoubaoAPI(messages, { temperature, maxTokens });
    } else if (this.provider === 'openai') {
      return this._callOpenAIAPI(messages, { temperature, maxTokens });
    }
  }

  /**
   * 调用豆包 API
   * @private
   */
  async _callDoubaoAPI(messages, options = {}) {
    try {
      const response = await fetch(`${this.doubaoBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.doubaoApiKey}`
        },
        body: JSON.stringify({
          model: this.doubaoModel,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000
        })
      });

      if (!response.ok) {
        throw new Error(`Doubao API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('❌ 豆包 API 调用失败:', error);
      throw error;
    }
  }

  /**
   * 调用 OpenAI API
   * @private
   */
  async _callOpenAIAPI(messages, options = {}) {
    try {
      const response = await fetch(`${this.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: this.openaiModel,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.maxTokens || 2000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('❌ OpenAI API 调用失败:', error);
      throw error;
    }
  }

  /**
   * 从文本生成笔记草稿
   * @param {string} text - 文本内容
   * @param {Array} notebooks - 笔记本列表
   * @param {object} options - 选项
   * @returns {Promise<object>}
   */
  async generateNoteDraftsFromText(text, notebooks = [], options = {}) {
    if (!text || !text.trim()) {
      return { drafts: [], metadata: { usedFallback: true, reason: 'empty_text' } };
    }

    try {
      const prompt = `请分析以下文本内容，生成笔记草稿：

${text}

请按以下 JSON 格式返回：
{
  "title": "笔记标题",
  "summary": "笔记摘要",
  "content": "笔记内容",
  "keywords": ["关键词1", "关键词2"],
  "suggestedNotebook": {
    "name": "推荐的笔记本名称",
    "reason": "推荐理由"
  }
}`;

      const aiResponse = await this.generateText(prompt, {
        temperature: 0.7,
        maxTokens: 2000
      });

      // 解析 AI 响应
      let parsed;
      try {
        // 清理可能的 markdown 代码块
        let cleaned = aiResponse.trim();
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.replace(/```json\s*/i, '').replace(/```\s*$/, '');
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/```\s*/i, '').replace(/```\s*$/, '');
        }
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.warn('⚠️ 解析 AI 响应失败，使用回退方案:', parseError);
        return {
          drafts: [{
            title: text.split('\n')[0].slice(0, 60) || '未命名笔记',
            summary: text.slice(0, 200),
            content: text,
            topics: [],
            confidence: 0.5
          }],
          metadata: { usedFallback: true, reason: 'parse_error' }
        };
      }

      // 构建草稿
      const draft = {
        title: parsed.title || text.split('\n')[0].slice(0, 60) || '未命名笔记',
        summary: parsed.summary || text.slice(0, 200),
        content: parsed.content || text,
        topics: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        confidence: 0.8,
        suggestedNotebookId: null,
        suggestedNotebookName: parsed.suggestedNotebook?.name || null,
        suggestedNewNotebook: parsed.suggestedNotebook || null
      };

      // 查找匹配的笔记本
      if (draft.suggestedNotebookName) {
        const match = notebooks.find(nb => 
          nb.name && nb.name.toLowerCase() === draft.suggestedNotebookName.toLowerCase()
        );
        if (match) {
          draft.suggestedNotebookId = match.notebook_id;
        }
      }

      return {
        drafts: [draft],
        metadata: { usedFallback: false }
      };
    } catch (error) {
      console.error('❌ 生成笔记草稿失败:', error);
      return {
        drafts: [{
          title: text.split('\n')[0].slice(0, 60) || '未命名笔记',
          summary: text.slice(0, 200),
          content: text,
          topics: [],
          confidence: 0.5
        }],
        metadata: { usedFallback: true, reason: error.message }
      };
    }
  }

  /**
   * 分析心情数据
   * @param {string} moodText - 心情文本
   * @returns {Promise<object>}
   */
  async analyzeMoodData(moodText) {
    if (!moodText || !moodText.trim()) {
      return {
        mood_emoji: '😐',
        mood_event: '无特别事件',
        mood_score: 0,
        mood_category: '中性'
      };
    }

    try {
      const prompt = `请分析以下心情描述，返回 JSON 格式：
{
  "mood_emoji": "表情符号",
  "mood_event": "主要事件",
  "mood_score": 心情分数（-5到5的整数）,
  "mood_category": "心情类别（如：开心、难过、平静等）"
}

心情描述：${moodText}`;

      const aiResponse = await this.generateText(prompt);
      
      // 解析响应
      let parsed;
      try {
        let cleaned = aiResponse.trim();
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.replace(/```json\s*/i, '').replace(/```\s*$/, '');
        } else if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/```\s*/i, '').replace(/```\s*$/, '');
        }
        parsed = JSON.parse(cleaned);
      } catch (parseError) {
        console.warn('⚠️ 解析心情分析失败:', parseError);
        return {
          mood_emoji: '😐',
          mood_event: '无特别事件',
          mood_score: 0,
          mood_category: '中性'
        };
      }

      return {
        mood_emoji: parsed.mood_emoji || '😐',
        mood_event: parsed.mood_event || '无特别事件',
        mood_score: typeof parsed.mood_score === 'number' ? parsed.mood_score : 0,
        mood_category: parsed.mood_category || '中性'
      };
    } catch (error) {
      console.error('❌ 分析心情数据失败:', error);
      return {
        mood_emoji: '😐',
        mood_event: '无特别事件',
        mood_score: 0,
        mood_category: '中性'
      };
    }
  }

  /**
   * 调用 AI 服务（统一入口）
   * @param {string} prompt - 提示词
   * @param {object} options - 选项
   * @returns {Promise<string>}
   */
  async callAI(prompt, options = {}) {
    // 优先使用豆包
    if (this.doubaoConfigured) {
      return await this._callDoubaoAPI([{ role: 'user', content: prompt }], {
        temperature: options.temperature || 0.7,
        maxTokens: options.maxTokens || 2000
      });
    }
    // 备用使用 OpenAI
    else if (this.openaiApiKey) {
      return await this._callOpenAIAPI([{ role: 'user', content: prompt }], {
        temperature: options.temperature || 0.7,
        maxTokens: options.maxTokens || 2000
      });
    }
    // 如果都没有配置，返回空字符串（由上层处理fallback）
    else {
      throw new Error('AI服务未配置');
    }
  }

  /**
   * 使用自定义prompt生成AI洞察
   * @param {string} notebookType - 笔记本类型
   * @param {string} customPrompt - 自定义提示词
   * @param {Array} notes - 笔记数组
   * @returns {Promise<Array>}
   */
  async generateInsights(notebookType, customPrompt, notes) {
    try {
      if (!notes || notes.length === 0) {
        return this.getEmptyInsights();
      }

      // 如果没有可用的外部AI服务，使用规则驱动的洞察生成
      const hasAIService = this.openaiApiKey || this.anthropicApiKey || this.doubaoConfigured;
      if (!hasAIService) {
        console.warn('⚠️ [generateInsights] 没有配置AI服务，使用规则驱动的洞察');
        return this.generateRuleBasedInsights(notebookType, notes);
      }

      // 准备笔记数据摘要
      const notesSummary = this.prepareNotesSummary(notes);
      
      // 构建完整的prompt
      const fullPrompt = `${customPrompt}

数据摘要：
${notesSummary}

请严格按照以下格式输出三个方面的洞察，每部分用标题开头，内容不超过100字：

1. 一句话总结：
[这里填写一句话总结]

2. 笔记要点：
[这里填写笔记要点]

3. 延伸方向：
[这里填写延伸方向]`;

      // 调用AI服务
      console.log('🤖 [generateInsights] 调用AI服务，prompt长度:', fullPrompt.length);
      const response = await this.callAI(fullPrompt);
      console.log('🤖 [generateInsights] AI返回响应，长度:', response?.length || 0);
      
      // 解析AI响应
      try {
        const parsedInsights = this.parseInsightsResponse(response, notebookType);
        console.log('✅ [generateInsights] 解析后的insights数量:', parsedInsights?.length || 0);
        if (parsedInsights && parsedInsights.length > 0) {
          return parsedInsights;
        } else {
          console.warn('⚠️ [generateInsights] 解析后insights为空，使用规则洞察');
          throw new Error('解析后insights为空');
        }
      } catch (parseError) {
        console.error('❌ [generateInsights] 解析失败:', parseError?.message || parseError);
        throw parseError;
      }
    } catch (error) {
      console.error('❌ [generateInsights] AI洞察生成失败:', error?.message || error);
      
      // 如果是没有API key的情况，直接返回规则洞察
      const hasAIService = this.openaiApiKey || this.anthropicApiKey || this.doubaoConfigured;
      if (!hasAIService) {
        console.log('⚠️ [generateInsights] 没有配置AI服务，使用规则洞察');
        return this.generateRuleBasedInsights(notebookType, notes || []);
      }
      
      // 如果是API调用错误，优先返回基于真实数据的规则洞察
      try {
        console.log('⚠️ [generateInsights] 使用规则洞察作为备选方案');
        return this.generateRuleBasedInsights(notebookType, notes || []);
      } catch (e) {
        console.error('❌ [generateInsights] 规则洞察生成失败，退回默认模板:', e?.message || e);
        return this.getFallbackInsights(notebookType);
      }
    }
  }

  /**
   * 生成基于规则的洞察
   */
  generateRuleBasedInsights(notebookType, notes) {
    const totalNotes = notes.length;
    const dateRange = this.getDateRange(notes);
    const titles = notes.map(note => note.title).filter(Boolean);
    const recentTitles = titles.slice(-3);
    const totalContentLength = notes.reduce((sum, note) => sum + ((note.content_text || note.content || '').length), 0);
    const averageLength = totalNotes ? Math.round(totalContentLength / totalNotes) : 0;
    const longestNote = notes.reduce((longest, current) => {
      const currentLen = (current.content_text || current.content || '').length;
      const longestLen = (longest?.content_text || longest?.content || '').length;
      return currentLen > longestLen ? current : longest;
    }, null);
    const uniqueDays = new Set(
      notes
        .map(note => (note.created_at || '').slice(0, 10))
        .filter(day => day)
    );

    const keyFindingParts = [];
    keyFindingParts.push(`共记录 ${totalNotes} 条笔记`);
    if (dateRange && dateRange !== '无日期信息') {
      keyFindingParts.push(`覆盖时间范围 ${dateRange}`);
    }
    if (recentTitles.length) {
      keyFindingParts.push(`近期主题包括「${recentTitles.join('」「')}」`);
    }
    if (longestNote && (longestNote.content_text || longestNote.content)) {
      keyFindingParts.push(`记录《${longestNote.title || '未命名'}》内容最为详实`);
    }

    let trendText = '';
    if (uniqueDays.size === totalNotes && totalNotes > 2) {
      trendText = '记录几乎分布在不同日期，习惯保持得较稳定。';
    } else if (uniqueDays.size > 0) {
      trendText = `共有 ${uniqueDays.size} 天留下记录，${uniqueDays.size < totalNotes ? '部分日期集中记录较多' : '频率较均匀' }。`;
    } else {
      trendText = '记录日期信息不完整，可以补充具体时间以便分析趋势。';
    }

    let recommendation = '建议继续保持记录习惯，定期整理并标注关键洞察。';
    if (averageLength < 80) {
      recommendation = '笔记平均篇幅较短，可以尝试补充更多细节与反思，方便后续分析。';
    }
    if (uniqueDays.size <= Math.max(2, Math.ceil(totalNotes / 3))) {
      recommendation = '记录主要集中在少数日期，可设置提醒让记录更均匀，便于观察长期变化。';
    }

    const insights = {
      keyFindings: keyFindingParts.join('，'),
      trends: trendText,
      recommendations: recommendation
    };

    return this.formatInsights(insights, notebookType);
  }

  /**
   * 准备笔记数据摘要
   */
  prepareNotesSummary(notes) {
    const totalNotes = notes.length;
    const dateRange = this.getDateRange(notes);
    const contentSummary = this.getContentSummary(notes);
    
    return `总笔记数：${totalNotes}条
时间范围：${dateRange}
内容摘要：${contentSummary}`;
  }

  /**
   * 获取日期范围
   */
  getDateRange(notes) {
    if (notes.length === 0) return '无数据';
    
    const dates = notes.map(note => note.created_at || note.date).filter(Boolean);
    if (dates.length === 0) return '无日期信息';
    
    const sortedDates = dates.sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    
    return startDate === endDate ? startDate : `${startDate} 至 ${endDate}`;
  }

  /**
   * 获取内容摘要
   */
  getContentSummary(notes) {
    const titles = notes.map(note => note.title).filter(Boolean);
    const contents = notes.map(note => note.content || note.content_text).filter(Boolean);
    
    const titleSummary = titles.length > 0 ? `标题示例：${titles.slice(0, 3).join('、')}` : '';
    const contentSummary = contents.length > 0 ? `内容长度：${contents.reduce((sum, content) => sum + content.length, 0)}字符` : '';
    
    return [titleSummary, contentSummary].filter(Boolean).join('；');
  }

  /**
   * 解析AI洞察响应
   */
  parseInsightsResponse(response, notebookType) {
    try {
      if (!response) {
        console.warn('⚠️ [parseInsightsResponse] 响应为空');
        throw new Error('AI响应为空');
      }

      console.log('🔍 [parseInsightsResponse] 开始解析响应，类型:', typeof response, '长度:', typeof response === 'string' ? response.length : 'N/A');
      
      // 尝试解析JSON格式的响应
      if (typeof response === 'string' && response.includes('{')) {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log('✅ [parseInsightsResponse] JSON解析成功');
            return this.formatInsights(parsed, notebookType);
          } catch (jsonError) {
            console.warn('⚠️ [parseInsightsResponse] JSON解析失败，尝试文本解析:', jsonError?.message);
          }
        }
      }

      // 解析文本格式的响应
      console.log('🔍 [parseInsightsResponse] 尝试文本格式解析');
      const insights = this.parseTextInsights(response);
      const formatted = this.formatInsights(insights, notebookType);
      
      // 如果格式化后没有内容，说明解析失败
      if (!formatted || formatted.length === 0) {
        console.warn('⚠️ [parseInsightsResponse] 文本解析后没有有效内容');
        throw new Error('解析后没有有效内容');
      }
      
      return formatted;
    } catch (error) {
      console.error('❌ [parseInsightsResponse] 解析失败:', error?.message || error);
      throw error;
    }
  }

  /**
   * 解析文本格式的洞察
   */
  parseTextInsights(text) {
    if (!text || typeof text !== 'string') {
      console.warn('⚠️ [parseTextInsights] 输入不是字符串:', typeof text);
      return { keyFindings: '', trends: '', recommendations: '' };
    }

    const insights = {
      keyFindings: '',
      trends: '',
      recommendations: ''
    };

    // 优先匹配新格式：一句话总结、笔记要点、延伸方向
    const summaryPatterns = [
      /(?:1\.|一、)?\s*一句话总结[：:：\s]+\s*(.+?)(?=\d\.|二、|2\.|笔记要点|趋势分析|建议|延伸方向|$)/s,
      /一句话总结[：:：\s]+\s*(.+?)(?=\d\.|二、|2\.|笔记要点|趋势分析|建议|延伸方向|$)/s,
      /1\.\s*(.+?)(?=\d\.|二、|2\.|笔记要点|趋势分析|建议|延伸方向|$)/s
    ];
    const pointsPatterns = [
      /(?:2\.|二、)?\s*笔记要点[：:：\s]+\s*(.+?)(?=\d\.|三、|3\.|延伸方向|建议|$)/s,
      /笔记要点[：:：\s]+\s*(.+?)(?=\d\.|三、|3\.|延伸方向|建议|$)/s,
      /2\.\s*(.+?)(?=\d\.|三、|3\.|延伸方向|建议|$)/s
    ];
    const directionPatterns = [
      /(?:3\.|三、)?\s*延伸方向[：:：\s]+\s*(.+?)$/s,
      /延伸方向[：:：\s]+\s*(.+?)$/s,
      /3\.\s*(.+?)$/s
    ];
    
    let summaryMatch = null;
    let pointsMatch = null;
    let directionMatch = null;
    
    for (const pattern of summaryPatterns) {
      summaryMatch = text.match(pattern);
      if (summaryMatch) break;
    }
    
    for (const pattern of pointsPatterns) {
      pointsMatch = text.match(pattern);
      if (pointsMatch) break;
    }
    
    for (const pattern of directionPatterns) {
      directionMatch = text.match(pattern);
      if (directionMatch) break;
    }

    // 如果新格式匹配成功，使用新格式
    if (summaryMatch || pointsMatch || directionMatch) {
      if (summaryMatch) {
        insights.keyFindings = summaryMatch[1].trim();
      }
      if (pointsMatch) {
        insights.trends = pointsMatch[1].trim();
      }
      if (directionMatch) {
        insights.recommendations = directionMatch[1].trim();
      }
    } else {
      // 否则尝试旧格式（向后兼容）
      const findingsMatch = text.match(/(?:1\.|一、)?\s*关键发现[：:\s]+(.+?)(?=\d\.|二、|2\.|趋势分析|建议|$)/s) ||
                           text.match(/关键发现[：:\s]+(.+?)(?=\d\.|二、|2\.|趋势分析|建议|$)/s);
      const trendsMatch = text.match(/(?:2\.|二、)?\s*趋势分析[：:\s]+(.+?)(?=\d\.|三、|3\.|建议|$)/s) ||
                         text.match(/趋势分析[：:\s]+(.+?)(?=\d\.|三、|3\.|建议|$)/s);
      const recommendationsMatch = text.match(/(?:3\.|三、)?\s*(?:建议|建议与行动)[：:\s]+(.+?)$/s) ||
                                  text.match(/(?:建议|建议与行动)[：:\s]+(.+?)$/s);

      if (findingsMatch) {
        insights.keyFindings = findingsMatch[1].trim();
      }
      if (trendsMatch) {
        insights.trends = trendsMatch[1].trim();
      }
      if (recommendationsMatch) {
        insights.recommendations = recommendationsMatch[1].trim();
      }
    }

    return insights;
  }

  /**
   * 格式化洞察数据
   */
  formatInsights(insights, notebookType) {
    const keyFinding = insights.keyFindings || insights.finding || insights.summary || '';
    const trendText = insights.trends || insights.trend || insights.points || '';
    const recommendation = insights.recommendations || insights.suggestion || insights.direction || '';

    const result = [];
    
    // 如果有关键发现或总结，添加"一句话总结"
    if (keyFinding && keyFinding.trim()) {
      result.push({
        id: 'insight_1',
        title: '一句话总结',
        summary: keyFinding.trim(),
        description: keyFinding.trim(),
        type: 'positive',
        confidence: 0.85,
        actionable: false,
        evidence: []
      });
    }
    
    // 如果有趋势或要点，添加"笔记要点"
    if (trendText && trendText.trim()) {
      result.push({
        id: 'insight_2',
        title: '笔记要点',
        summary: trendText.trim(),
        description: trendText.trim(),
        type: 'trend',
        confidence: 0.78,
        actionable: false,
        evidence: []
      });
    }
    
    // 如果有建议或延伸方向，添加"延伸方向"
    if (recommendation && recommendation.trim()) {
      result.push({
        id: 'insight_3',
        title: '延伸方向',
        summary: recommendation.trim(),
        description: recommendation.trim(),
        type: 'suggestion',
        confidence: 0.82,
        actionable: true,
        evidence: [],
        suggestions: typeof recommendation === 'string' ? recommendation.split(/\n+/).filter(Boolean) : []
      });
    }

    return result;
  }

  /**
   * 获取空洞察
   */
  getEmptyInsights() {
    return [
      {
        id: 'insight_1',
        title: '一句话总结',
        summary: '暂无足够数据进行分析',
        description: '暂无足够数据进行分析',
        type: 'positive',
        confidence: 0.0,
        actionable: false,
        evidence: []
      },
      {
        id: 'insight_2',
        title: '笔记要点',
        summary: '请先记录您的数据',
        description: '请先记录您的数据',
        type: 'trend',
        confidence: 0.0,
        actionable: false,
        evidence: []
      },
      {
        id: 'insight_3',
        title: '延伸方向',
        summary: '至少需要两条记录才能生成分析',
        description: '至少需要两条记录才能生成分析',
        type: 'suggestion',
        confidence: 0.0,
        actionable: false,
        evidence: [],
        suggestions: []
      }
    ];
  }

  /**
   * 获取备用洞察
   */
  getFallbackInsights(notebookType) {
    const fallbackContent = {
      mood: {
        keyFindings: '您的情绪记录显示整体状态良好，积极情绪占主导地位。',
        trends: '心情变化呈现一定的规律性，工作压力是主要影响因素。',
        recommendations: '建议保持当前的情绪管理方式，适当增加放松活动。'
      },
      study: {
        keyFindings: '学习记录显示您有良好的学习习惯，知识掌握较为扎实。',
        trends: '学习效率在工作日的上午时段较高，存在明显的时间分布特征。',
        recommendations: '建议优化时间分配，在高效时段安排重要学习任务。'
      },
      work: {
        keyFindings: '工作记录显示任务完成情况良好，项目进展顺利。',
        trends: '工作效率在工作日的上午和下午时段较高，存在明显的时间模式。',
        recommendations: '建议保持当前的工作节奏，注意工作与生活的平衡。'
      },
      life: {
        keyFindings: '生活记录显示您有规律的生活习惯，生活质量较高。',
        trends: '生活活动分布较为均匀，周末活动相对较少。',
        recommendations: '建议适当增加周末活动，丰富生活内容。'
      },
      custom: {
        keyFindings: '数据记录显示您有良好的记录习惯，信息收集较为完整。',
        trends: '数据变化呈现一定的规律性，存在明显的时间分布特征。',
        recommendations: '建议继续保持记录习惯，定期回顾和分析数据。'
      }
    };

    const content = fallbackContent[notebookType] || fallbackContent.custom;
    
    return [
      {
        id: 'insight_1',
        title: '一句话总结',
        summary: content.keyFindings,
        description: content.keyFindings,
        type: 'positive',
        confidence: 0.7,
        actionable: false,
        evidence: []
      },
      {
        id: 'insight_2',
        title: '笔记要点',
        summary: content.trends,
        description: content.trends,
        type: 'trend',
        confidence: 0.7,
        actionable: false,
        evidence: []
      },
      {
        id: 'insight_3',
        title: '延伸方向',
        summary: content.recommendations,
        description: content.recommendations,
        type: 'suggestion',
        confidence: 0.7,
        actionable: true,
        evidence: [],
        suggestions: []
      }
    ];
  }
}

