#!/usr/bin/env node

/**
 * 直接测试 Coze Workflow Run（v1/workflow/run）
 * 用于排查 ECONNRESET/socket hang up 等网络问题
 */

import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量（与后端 server.js 同逻辑，优先使用 CLOUD_VERSION/.env.local）
const envPaths = [
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../../.env.local'),
  path.join(__dirname, '.env.local')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, override: true });
  if (!result.error) {
    console.log(`✓ 从 ${envPath} 加载环境变量`);
    break;
  }
}

const COZE_ACCESS_TOKEN = (process.env.COZE_ACCESS_TOKEN || '').trim();
const COZE_WORKFLOW_ID = (process.env.COZE_WORKFLOW_ID || '').trim();
const COZE_APP_ID = (process.env.COZE_APP_ID || '').trim();

const targetUrl =
  process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) ||
  'https://wallstreetcn.com/articles/3760816';

if (!COZE_ACCESS_TOKEN || !COZE_WORKFLOW_ID) {
  console.error('❌ 缺少配置：需要 COZE_ACCESS_TOKEN 与 COZE_WORKFLOW_ID');
  process.exitCode = 1;
} else {
  const httpsAgent = new https.Agent({
    keepAlive: false,
    family: 4,
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

  const apiPayload = {
    workflow_id: COZE_WORKFLOW_ID,
    parameters: { input: targetUrl },
    is_async: false
  };
  if (COZE_APP_ID) apiPayload.app_id = COZE_APP_ID;

  console.log('='.repeat(60));
  console.log('🧪 测试 Coze Workflow Run');
  console.log('='.repeat(60));
  console.log(`URL: https://api.coze.cn/v1/workflow/run`);
  console.log(`workflow_id: ${COZE_WORKFLOW_ID}`);
  console.log(`token 前缀: ${COZE_ACCESS_TOKEN.slice(0, 10)}... (len=${COZE_ACCESS_TOKEN.length})`);
  console.log(`input url: ${targetUrl}`);
  console.log('='.repeat(60));

  const startedAt = Date.now();
  try {
    const resp = await axios.post('https://api.coze.cn/v1/workflow/run', apiPayload, {
      headers: {
        Authorization: `Bearer ${COZE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 180_000,
      responseType: 'json',
      httpsAgent,
      validateStatus: () => true
    });

    const ms = Date.now() - startedAt;
    console.log(`✅ 响应: ${resp.status} (${ms}ms)`);
    const logId =
      resp.headers?.['x-tt-logid'] ||
      resp.headers?.['x-tt-logid'.toLowerCase()] ||
      resp.headers?.['x-tt-logid'.toUpperCase()];
    if (logId) console.log(`x-tt-logid: ${logId}`);
    console.log(`content-type: ${resp.headers?.['content-type'] || ''}`);
    console.log(`body preview: ${JSON.stringify(resp.data).slice(0, 600)}`);
    process.exitCode = resp.status === 200 ? 0 : 2;
  } catch (err) {
    const ms = Date.now() - startedAt;
    console.error(`❌ 请求异常 (${ms}ms):`, err?.message || err);
    console.error('code:', err?.code || '');
    console.error('errno:', err?.errno || '');
    console.error('syscall:', err?.syscall || '');
    process.exitCode = 3;
  } finally {
    httpsAgent.destroy();
  }
}
