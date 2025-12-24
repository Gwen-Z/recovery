import axios from 'axios';
import https from 'https';
import { isAbortError, looksLikeHtml } from './parse-utils.js';

const COZE_API_URL = 'https://api.coze.cn/v1/workflow/run';
const DEFAULT_TIMEOUT_MS = 300000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 提取 Coze workflow 响应中的文本答案
export const extractCozeAnswer = (data) => {
  if (!data) return '';
  const messages = data.messages || data.data || [];
  if (Array.isArray(messages)) {
    const assistantMsg = [...messages].reverse().find(
      (m) =>
        (m.role === 'assistant' || m.type === 'answer') &&
        typeof m.content === 'string' &&
        m.content.trim()
    );
    if (assistantMsg?.content) return assistantMsg.content.trim();
  }
  if (typeof data === 'string') return data;
  if (data.answer) return data.answer;
  if (data.result) return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
  return JSON.stringify(data);
};

export const callCozeWorkflow = async ({
  articleUrl,
  query,
  accessToken,
  workflowId,
  appId,
  maxRetries = 2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console
}) => {
  if (!accessToken || !workflowId) {
    throw new Error('Coze Workflow 配置未设置：缺少 access token 或 workflow id');
  }
  if (!articleUrl || !articleUrl.trim()) {
    throw new Error('articleUrl 不能为空');
  }

  const parameters = { input: articleUrl.trim() };
  if (query) parameters.query = query;

  const apiPayload = {
    workflow_id: workflowId,
    parameters,
    is_async: false
  };
  if (appId) apiPayload.app_id = appId;

  const agent = new https.Agent({
    keepAlive: false,
    family: 4,
    // 显式指定 SNI，避免部分网络/代理环境下握手不带 server_name 导致服务端 reset
    servername: 'api.coze.cn',
    minVersion: 'TLSv1.2',
    ciphers: [
      'ECDHE-ECDSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-ECDSA-CHACHA20-POLY1305',
      'ECDHE-RSA-CHACHA20-POLY1305',
      'DHE-RSA-AES128-GCM-SHA256',
      'DHE-RSA-AES256-GCM-SHA384'
    ].join(':')
  });
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      logger?.log?.(`🔄 调用 Coze Workflow: ${COZE_API_URL}`);
      logger?.log?.(`📦 Workflow ID: ${workflowId}`);
      logger?.log?.(
        `🔑 使用 ACCESS_TOKEN 前缀: ${accessToken ? accessToken.substring(0, 10) + '...' : '未配置'}`
      );

      const apiResponse = await axios.post(COZE_API_URL, apiPayload, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        responseType: 'json',
        timeout: timeoutMs,
        proxy: false,
        validateStatus: (status) => status < 500,
        httpsAgent: agent
      });

      const statusCode = apiResponse.status;
      const contentType = apiResponse.headers['content-type'] || '';
      logger?.log?.(`📊 Workflow 响应状态码: ${statusCode}`);
      logger?.log?.(`📄 响应 Content-Type: ${contentType}`);

      if (statusCode === 401 || statusCode === 403 || apiResponse.data?.code === 4100) {
        throw new Error(
          `Coze Workflow 鉴权失败 (${statusCode}): 请检查 COZE_ACCESS_TOKEN 是否有效、是否有 workflow:run 权限，且与 workflow 同一空间`
        );
      }

      const data = apiResponse.data;

      if (contentType.includes('text/html') || looksLikeHtml(data?.toString?.() || '')) {
        const preview = typeof data === 'string' ? data.substring(0, 500) : '';
        logger?.error?.(`❌ Coze Workflow 返回了 HTML 页面 (状态码: ${statusCode}):`, preview);
        throw new Error(
          `Coze Workflow 返回了 HTML 登录页 (状态码: ${statusCode})，说明请求未授权或参数错误。`
        );
      }

      if (data?.code && data.code !== 0) {
        throw new Error(`Coze Workflow 返回状态 failed，code=${data.code} msg=${data.msg || ''}`);
      }

      const answer = extractCozeAnswer(data?.data);
      return {
        answer,
        responseData: data,
        chatId: null,
        conversationId: null
      };
    } catch (err) {
      lastError = err;
      logger?.error?.(
        `❌ Coze API调用失败(第${attempt + 1}次):`,
        err.message,
        err?.code || ''
      );
      if (isAbortError(err) && attempt < maxRetries - 1) {
        await sleep(1000);
        continue;
      }
      if (err.response) {
        logger?.error?.('响应状态码:', err.response.status);
        logger?.error?.('响应头:', err.response.headers);
      }
      throw err;
    }
  }

  throw lastError || new Error('调用 Coze Workflow 失败');
};
