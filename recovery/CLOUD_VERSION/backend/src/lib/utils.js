/**
 * 工具函数库
 * 包含 Coze 流处理、数据转换等通用工具
 */

/**
 * 消费 Coze API 的流式响应
 * @param {Stream} stream - Node.js 流对象
 * @returns {Promise<{chatId: string, conversationId: string, answer: string, events: Array}>}
 */
export const consumeCozeStream = (stream) => {
  return new Promise((resolve, reject) => {
    if (!stream) {
      resolve({ answer: '', events: [] });
      return;
    }

    stream.setEncoding('utf8');

    let buffer = '';
    let chatId = null;
    let conversationId = null;
    let answerChunks = [];
    let finalAnswer = '';
    const events = [];
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (!finalAnswer && answerChunks.length) {
        finalAnswer = answerChunks.join('');
      }
      resolve({
        chatId,
        conversationId,
        answer: (finalAnswer || '').trim(),
        events
      });
    };

    const handleSegment = (segment) => {
      if (!segment) return;
      const lines = segment.split('\n').filter(Boolean);
      if (!lines.length) return;

      let eventName = null;
      let dataPayload = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const payload = line.slice(5);
          dataPayload = dataPayload ? `${dataPayload}\n${payload}` : payload;
        }
      }

      if (!dataPayload) return;

      if (eventName === 'done') {
        finish();
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(dataPayload);
      } catch {
        return;
      }

      events.push({ event: eventName, data: parsed });

      if (!chatId && (parsed.chat_id || parsed.id)) {
        chatId = parsed.chat_id || parsed.id;
      }
      if (!conversationId && parsed.conversation_id) {
        conversationId = parsed.conversation_id;
      }

      if (eventName === 'conversation.chat.failed') {
        const message =
          parsed?.last_error?.msg ||
          parsed?.last_error?.message ||
          'Coze chat failed';
        reject(new Error(message));
        resolved = true;
        stream.destroy();
        return;
      }

      if (eventName === 'conversation.message.delta' && parsed?.type === 'answer') {
        if (parsed.content) {
          answerChunks.push(parsed.content);
        }
      }

      if (eventName === 'conversation.message.completed' && parsed?.type === 'answer') {
        finalAnswer = parsed.content || finalAnswer;
      }
    };

    stream.on('data', (chunk) => {
      buffer += chunk;
      const segments = buffer.split('\n\n');
      buffer = segments.pop() || '';
      segments.forEach(handleSegment);
    });

    stream.on('end', () => {
      if (!resolved) {
        if (buffer) handleSegment(buffer);
        finish();
      }
    });

    stream.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      reject(error);
    });
  });
};

/**
 * 解析 JSON 数组
 * @param {any} value - 要解析的值
 * @returns {Array}
 */
export const parseJsonArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

/**
 * 尝试解析 JSON
 * @param {any} value - 要解析的值
 * @param {any} fallback - 解析失败时的默认值
 * @returns {any}
 */
export const tryParseJSON = (value, fallback = {}) => {
  if (!value) return { ...(fallback || {}) };
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return { ...(fallback || {}) };
  }
};

/**
 * 规范化解析历史状态
 * @param {string} status - 原始状态
 * @returns {string}
 */
export const normalizeParseHistoryStatus = (status) => {
  if (!status) return '解析中';
  const map = {
    completed: '解析成功',
    processing: '解析中',
    failed: '解析失败',
    pending: '解析中',
    assigned: '解析成功',
    '解析完成': '解析成功',
    '解析成功': '解析成功',
    '解析失败': '解析失败',
    '解析中': '解析中'
  };
  return map[status] || status;
};

/**
 * 获取解析历史状态的所有变体（用于查询）
 * @param {string} status - 状态
 * @returns {Array<string>}
 */
export const getParseHistoryStatusVariants = (status) => {
  if (!status) return [];
  const normalized = normalizeParseHistoryStatus(status);
  const STATUS_VARIANTS_MAP = {
    解析中: ['解析中', 'processing', 'pending', '解析处理中', 'created', 'waiting'],
    解析成功: ['解析成功', '解析完成', 'completed', 'assigned', 'success'],
    解析失败: ['解析失败', 'failed', 'error']
  };
  const variants = STATUS_VARIANTS_MAP[normalized];
  if (!variants) {
    return [status, normalized].filter(Boolean);
  }
  return Array.from(new Set([normalized, ...variants]));
};

/**
 * 解析 Coze 响应数据
 * @param {any} raw - 原始数据
 * @returns {object|null}
 */
export const parseCozeResponseData = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('⚠️ 无法解析 coze_response_data:', error?.message);
    return null;
  }
};

/**
 * 映射查询结果行（将数组数组转换为对象数组）
 * @param {object} result - 查询结果
 * @returns {Array<object>}
 */
export const mapQueryResultRows = (result) => {
  if (!result || !Array.isArray(result.rows) || !Array.isArray(result.columns)) {
    return [];
  }
  return result.rows.map((row) => {
    const record = {};
    result.columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
};

