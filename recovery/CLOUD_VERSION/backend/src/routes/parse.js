/**
 * 解析相关路由
 * 包含文章解析、解析历史管理等接口
 */

import express from 'express';
import axios from 'axios';
import https from 'https';
import { normalizeParseHistoryStatus, getParseHistoryStatusVariants } from '../lib/utils.js';
import { sanitizeString } from '../lib/string-utils.js';
import AIService from '../services/ai-service.js';

// Coze 在部分网络环境下可能对 TLS/代理/长连接较敏感：
// - 显式指定 SNI（servername）
// - 强制最低 TLS1.2
// - keepAlive 关闭，避免长连接被中间设备切断
// ⚠️ 不要在 Agent 上设置过短 timeout：Coze 解析可能 >60s，会导致 ECONNRESET/socket hang up
const createCozeHttpsAgent = () =>
  new https.Agent({
    keepAlive: false,
    // 强制走 IPv4，避免某些网络环境 IPv6 握手/路由不稳定导致 ECONNRESET
    family: 4,
    // 显式指定 SNI，避免部分网络/代理环境下握手不带 server_name 导致服务端直接 reset
    servername: 'api.coze.cn',
    minVersion: 'TLSv1.2',
    // 指定常见安全套件，提升兼容性（与诊断脚本保持一致）
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

const MAX_TITLE_LENGTH = 256;
const MAX_CONTENT_LENGTH = 100_000;

const clampText = (value, maxLen) => {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}\n\n（内容过长，已截断）`;
};

const decodeHtmlEntities = (input = '') => {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

const htmlToText = (html = '') => {
  if (!html || typeof html !== 'string') return '';
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|figure|h1|h2|h3|h4|h5|h6|li)>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);
  // 折叠多余空白
  text = text.replace(/\r/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
};

const extractImgUrlsFromHtml = (html = '') => {
  if (!html || typeof html !== 'string') return [];
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const src = (match[1] || '').trim();
    if (!src) continue;
    // 去掉 x-oss-process 等参数，保留原图在 original-src 上的情况
    if (!urls.includes(src)) urls.push(src);
  }
  // 兼容 longport 的 original-src
  const re2 = /original-src=["']([^"']+)["']/gi;
  while ((match = re2.exec(html))) {
    const src = (match[1] || '').trim();
    if (!src) continue;
    if (!urls.includes(src)) urls.push(src);
  }
  return urls;
};

const tryExtractFromJsonLd = (html = '') => {
  const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of matches) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      const type = obj?.['@type'];
      const isArticle = type === 'Article' || (Array.isArray(type) && type.includes('Article'));
      if (!isArticle && !obj?.headline) continue;
      const title = obj?.headline || '';
      const author = obj?.author?.name || (Array.isArray(obj?.author) ? obj.author?.[0]?.name : '') || '';
      const publishedAt = obj?.datePublished || obj?.dateModified || '';
      const images = Array.isArray(obj?.image) ? obj.image : obj?.image ? [obj.image] : [];
      const bodyHtml = obj?.articleBody || obj?.text || obj?.description || '';
      return {
        title,
        author,
        publishedAt,
        images: images.filter(Boolean),
        bodyHtml
      };
    } catch {
      // ignore
    }
  }
  return null;
};

const safeGet = (obj, path, fallback = null) => {
  try {
    return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj) ?? fallback;
  } catch {
    return fallback;
  }
};

const tryExtractFromNextData = (html = '') => {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  const raw = (m[1] || '').trim();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const pageProps = safeGet(data, 'props.pageProps', {}) || {};
    const topic =
      safeGet(data, 'props.pageProps.topic', null) ||
      safeGet(data, 'props.pageProps.data.topic', null) ||
      safeGet(data, 'props.pageProps.article', null) ||
      safeGet(data, 'props.pageProps.data.article', null);
    if (!topic) return null;
    const title = topic.title || topic.original_title || topic.headline || '';
    const author =
      safeGet(topic, 'user.name', '') ||
      safeGet(topic, 'author.name', '') ||
      safeGet(topic, 'user.nickname', '') ||
      safeGet(topic, 'author', '') ||
      '';
    const publishedAt =
      topic.published_at || topic.created_at || topic.updated_at || topic.publish_time || '';
    const bodyHtml =
      topic.body_html ||
      topic.content_html ||
      topic.body ||
      topic.content ||
      topic.html ||
      topic.mix_body ||
      topic.description_html ||
      '';
    const cover = topic.cover_image || safeGet(topic, 'link_info.image', '') || '';
    const imgs = [
      ...(Array.isArray(topic.images)
        ? topic.images
            .map((img) => img?.image_style?.original || img?.url || '')
            .filter(Boolean)
        : [])
    ];
    imgs.push(...extractImgUrlsFromHtml(bodyHtml));
    if (cover) imgs.unshift(cover);
    return { title, author, publishedAt, bodyHtml, images: imgs };
  } catch {
    return null;
  }
};

const tryFallbackParseByFetchingHtml = async (url) => {
  const startedAt = Date.now();
  try {
    const resp = await axios.get(url, {
      timeout: 30_000,
      responseType: 'text',
      maxContentLength: 8 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024,
      proxy: false,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const contentType = (resp.headers?.['content-type'] || '').toLowerCase();
    const html = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    if (!html || (!contentType.includes('text/html') && !html.trim().startsWith('<!DOCTYPE'))) return null;

    const jsonLd = tryExtractFromJsonLd(html);
    const nextData = tryExtractFromNextData(html);
    const title = clampText((jsonLd?.title || nextData?.title || '').trim(), MAX_TITLE_LENGTH);
    const author = clampText((jsonLd?.author || nextData?.author || '').trim(), 128);
    const publishedRaw = (jsonLd?.publishedAt || nextData?.publishedAt || '').trim();
    const publishedAt = publishedRaw ? formatToPublishedStyle(publishedRaw) : '';
    const jsonBodyHtml = (jsonLd?.bodyHtml || '').trim();
    const nextBodyHtml = (nextData?.bodyHtml || '').trim();
    // LongPort 等站点的 JSON-LD 可能只给 description，而 __NEXT_DATA__ 才有完整正文
    const bodyHtml =
      nextBodyHtml && nextBodyHtml.length > Math.max(800, jsonBodyHtml.length * 1.1)
        ? nextBodyHtml
        : jsonBodyHtml || nextBodyHtml;
    const contentText = clampText(htmlToText(bodyHtml || ''), MAX_CONTENT_LENGTH);
    const images = [
      ...(jsonLd?.images || []),
      ...(nextData?.images || []),
      ...extractImgUrlsFromHtml(bodyHtml || '')
    ]
      .map((u) => String(u || '').trim())
      .filter(Boolean);
    const uniqImages = [...new Set(images)].slice(0, 80);

    if (!title && contentText.length < 80) return null;

    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();
    const sourcePlatform = hostname.includes('longport') ? 'LongPort' : hostname || '';

    return {
      extractedFields: {
        title,
        content: contentText,
        author,
        published_at: publishedAt,
        link: url,
        img_urls: uniqImages,
        source_platform: sourcePlatform
      },
      meta: {
        provider: 'fallback_html',
        elapsedMs: Date.now() - startedAt,
        contentType
      }
    };
  } catch {
    return null;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 简单判断字符串是否疑似 HTML（例如 Coze 返回了登录页）
const looksLikeHtml = (text = '') => {
  if (!text || typeof text !== 'string') return false;
  const preview = text.trim().slice(0, 400).toLowerCase();
  return (
    preview.includes('<!doctype') ||
    preview.includes('<html') ||
    preview.includes('<body') ||
    (preview.includes('coze') && (preview.includes('登录') || preview.includes('login')))
  );
};

// 判定请求是否因超时/中断而终止
const isAbortError = (err) => {
  const msg = (err?.message || '').toLowerCase();
  const abortCodes = ['ECONNABORTED', 'ECONNRESET', 'EPIPE'];
  return (
    abortCodes.includes(err?.code) ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('connection reset')
  );
};

const buildCozeFailurePayload = (err, meta = {}) => {
  const payload = {
    ok: false,
    provider: 'coze',
    error: {
      message: err?.message || 'unknown',
      code: err?.code || null,
      errno: err?.errno || null,
      syscall: err?.syscall || null,
      address: err?.address || null,
      port: err?.port || null
    },
    meta
  };
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({ ok: false, error: { message: String(err?.message || err) }, meta });
  }
};

// 简单从正文中推断标题/作者/时间
const deriveMetaFromContent = (content = '') => {
  const lines = (content || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const dateRegex =
    /(\d{4}[./-]\d{1,2}[./-]\d{1,2}(?:[ T]?\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)/;
  const result = { title: null, author: null, published_at: null };
  if (lines.length > 0) {
    const first = lines[0];
    const m = first.match(dateRegex);
    // 如果第一行以日期开头，去掉日期部分作为标题
    if (m && m.index === 0) {
      const stripped = first.replace(dateRegex, '').trim();
      result.title = stripped || first;
    } else {
      result.title = first;
    }
  }
  if (lines.length > 1 && lines[1].length <= 20) {
    result.author = lines[1];
  }
  // 找包含日期/时间的行，优先最短匹配
  const dateLines = lines
    .map((l) => {
      const m = l.match(dateRegex);
      return m ? { line: l, match: m[1] || m[0], length: (m[1] || m[0]).length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  if (dateLines.length > 0) {
    result.published_at = dateLines[0].match;
  }
  return result;
};

// 将日期格式化为与 published_at 一致的样式：YYYY/M/D HH:mm:ss
const formatToPublishedStyle = (value) => {
  if (!value) return '';
  let normalized = value;
  if (typeof value === 'number') {
    normalized = value < 1e12 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const asNum = Number(trimmed);
      normalized = asNum < 1e12 ? asNum * 1000 : asNum;
    }
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

// 清洗摘要：去掉开头客套话、去除粗体符号等 Markdown 噪点
const sanitizeSummary = (summary = '') => {
  if (!summary || typeof summary !== 'string') return '';
  let cleaned = summary.trim();
  cleaned = cleaned.replace(/^好(的|吧)?，?这?是?为?您?整理的[:：]?\s*/i, '');
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1');
  return cleaned.trim();
};

// 清洗 Coze 文本里的工具调用/客套话
const cleanParsedContentText = (text = '') => {
  if (!text || typeof text !== 'string') return text;
  const lines = text.split('\n');
  const filtered = lines.filter((line) => {
    let original = line || '';
    let t = original.trim().toLowerCase();
    if (!t) return true; // 保留空行
    const killPrefixes = [
      '调用',
      'ts-extract_link',
      '用户需要解析链接文章内容',
      '用户需要解析文章链接的内容',
      '我来帮您解析这个链接的文章内容',
      '让我先提取链接中的信息',
      '正在提取链接文章内容',
      '正在提取链接'
    ];
    // 整行噪声直接丢弃
    if (killPrefixes.some((p) => t.startsWith(p))) return false;
    // 行内包含工具/提示语也直接丢弃
    const killContains = [
      'ts-extract_link',
      'extract_link',
      '调用 ts-extract',
      '调用ts-extract',
      '调用  ts-extract',
      '调用 ts-extract_link',
      '解析链接文章内容',
      '解析文章链接的内容',
      '解析文章内容'
    ];
    if (killContains.some((p) => t.includes(p))) return false;
    // 句中包含的提示语去除后保留其余文本
    const stripPhrases = [
      '调用 ts-extract_link-extract_link 函数提取链接文章的主要内容。',
      '调用 ts-extract_link 函数提取链接文章的主要内容。',
      '调用 ts-extract_link',
      '调用  ts-extract_link',
      '用户需要解析链接文章内容，调用 ts-extract_link-extract_link 函数完成解析。',
      '用户需要解析链接文章内容，调用 ts-extract_link 函数完成解析。',
      '用户需要解析文章链接的内容，调用 ts-extract_link-extract_link 函数进行文章解析。',
      '用户需要解析文章链接的内容，调用 ts-extract_link 函数进行文章解析。',
      '用户需要解析链接文章内容，调用 ts-extract_link-extract_link 函数获取文章的文本和图片信息。',
      '用户需要解析链接文章内容，调用 ts-extract_link 函数获取文章的文本和图片信息。'
    ];
    stripPhrases.forEach((phrase) => {
      if (original.includes(phrase)) {
        original = original.replace(phrase, '');
        t = original.trim().toLowerCase();
      }
    });
    // 进一步粗暴过滤：如果行里同时包含 "解析" 和 "ts-extract" 或 "extract_link"，直接丢弃
    if (t.includes('解析') && (t.includes('ts-extract') || t.includes('extract_link'))) return false;
    // 若清理后为空则丢弃
    if (!t) return false;
    return true;
  });
  return filtered.join('\n').trim();
};

// 判断内容是否仅包含工具调用（未返回正文）
const isToolCallOnlyPayload = (value) => {
  if (!value) return false;
  let text = '';
  if (typeof value === 'string') {
    text = value.trim();
  } else if (typeof value === 'object') {
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false;
    }
  }
  if (!text.startsWith('{')) return false;
  try {
    const obj = typeof value === 'object' ? value : JSON.parse(text);
    if (!obj || typeof obj !== 'object') return false;
    const hasToolShape =
      !!obj.name &&
      typeof obj.name === 'string' &&
      obj.parameters &&
      typeof obj.parameters === 'object' &&
      obj.parameters.input &&
      typeof obj.parameters.input === 'string';
    const hasContentFields =
      !!obj.content ||
      !!obj.answer ||
      !!obj.result ||
      !!obj.text ||
      !!obj.body;
    return hasToolShape && !hasContentFields;
  } catch (e) {
    return false;
  }
};

// 清洗提取到的字段，去掉工具调用/客套话
const sanitizeExtractedFields = (fields = {}) => {
  if (!fields || typeof fields !== 'object') return fields;
  const clone = { ...fields };
  const cleanValue = (val) => {
    if (typeof val === 'string') return cleanParsedContentText(val);
    if (Array.isArray(val)) return val.map((v) => cleanValue(v));
    return val;
  };
  ['title', 'content', 'summary', 'body', 'text'].forEach((key) => {
    if (clone[key]) clone[key] = cleanValue(clone[key]);
  });
  return clone;
};

// 统一字段规范化：无论 Coze 返回 JSON 还是纯文本，都产出完整键集
const normalizeParsedFields = ({
  extractedFields = {},
  fallbackContent = '',
  fallbackSummary = '',
  articleUrl = '',
  createdAt = ''
}) => {
  // 平台推断：优先结构化字段，其次域名
  const inferSourcePlatform = (explicitPlatform, url) => {
    if (explicitPlatform && explicitPlatform.trim()) return explicitPlatform.trim();
    let host = '';
    try {
      host = new URL(url).hostname || '';
    } catch (e) {
      host = '';
    }
    const h = host.toLowerCase();
    if (!h) return '';
    if (h.includes('weixin')) return '微信公众号';
    if (h.includes('douyin') || h.includes('tiktok')) return '抖音';
    if (h.includes('xiaohongshu')) return '小红书';
    if (h.includes('longbridge')) return '长桥';
    if (h.includes('wallstreetcn')) return '华尔街见闻';
    if (h.includes('cailianpress')) return '财联社';
    if (h.includes('caixin')) return '财新';
    return host;
  };

  // 简单的笔记类型推断：优先结构化字段，其次根据域名/标题猜测
  const inferNoteType = (explicitType, sourcePlatform, url, title) => {
    if (explicitType && explicitType.trim()) return explicitType.trim();
    const safeTitle = (title || '').toLowerCase();
    const safePlatform = (sourcePlatform || '').toLowerCase();
    let host = '';
    try {
      host = new URL(url).hostname || '';
    } catch (e) {
      host = '';
    }
    const safeHost = host.toLowerCase();

    // 平台/域名优先判断
    if (safeHost.includes('wallstreetcn') || safeHost.includes('cailianpress') || safeHost.includes('caixin') || safeHost.includes('finance')) {
      return '财经分析';
    }
    if (safePlatform.includes('财经')) return '财经分析';
    if (safeHost.includes('weixin')) return '公众号文章';
    if (safeHost.includes('xiaohongshu')) return '生活笔记';
    if (safeHost.includes('douyin') || safeHost.includes('tiktok')) return '短视频笔记';

    // 标题关键词兜底
    const financeKeywords = ['美联储', '降息', '加息', '股市', 'a股', '基金', 'etf', '央行', '经济', '通胀', '利率'];
    if (financeKeywords.some((k) => safeTitle.includes(k.toLowerCase()))) {
      return '财经分析';
    }
    return '';
  };

  // 如果传入的是纯文本字符串，视为正文内容包裹成对象
  if (typeof extractedFields === 'string') {
    extractedFields = { content: extractedFields };
  }
  const nowIso = new Date().toISOString();
  const pickString = (...values) => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const pickArray = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === 'string' ? v.trim() : String(v || '').trim()))
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  };
  const deriveKeywords = (title = '', contentText = '') => {
    const text = `${title} ${contentText}`.toLowerCase();
    if (!text.trim()) return [];
    const tokens = text
      .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
      .filter((t) => t && t.length >= 2 && /[a-zA-Z\u4e00-\u9fa5]/.test(t)); // 去掉纯数字
    const freq = {};
    tokens.forEach((t) => {
      freq[t] = (freq[t] || 0) + 1;
    });
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map((e) => e[0]);
  };

  const content = pickString(extractedFields.content, extractedFields.body, extractedFields.text, fallbackContent);
  const summary = sanitizeSummary(pickString(extractedFields.summary, fallbackSummary));
  const derived = deriveMetaFromContent(content);
  const noteTypeFinal = inferNoteType(
    pickString(extractedFields.note_type, extractedFields.noteType),
    pickString(extractedFields.source_platform, extractedFields.platform),
    articleUrl,
    derived.title || pickString(extractedFields.title)
  );
  const sourcePlatformFinal = inferSourcePlatform(
    pickString(extractedFields.source_platform, extractedFields.platform),
    articleUrl
  );
  const rawPublishedAt = pickString(
    extractedFields.published_at,
    extractedFields.publishedAt,
    extractedFields.publish_time,
    derived.published_at
  );
  const formattedPublishedAt = formatToPublishedStyle(rawPublishedAt);
  const rawNoteCreated = pickString(extractedFields.note_created_at, createdAt) || nowIso;
  const formattedNoteCreated = formatToPublishedStyle(rawNoteCreated) || formatToPublishedStyle(nowIso);

  return {
    title: pickString(extractedFields.title, derived.title),
    content,
    summary,
    published_at: formattedPublishedAt || rawPublishedAt,
    note_created_at: formattedNoteCreated,
    author: pickString(extractedFields.author, derived.author),
    link: pickString(extractedFields.link, extractedFields.url, extractedFields.source_url, articleUrl),
    img_urls: pickArray(extractedFields.img_urls || extractedFields.image_urls || extractedFields.images),
    source_platform: sourcePlatformFinal,
    note_type: noteTypeFinal,
    keywords:
      pickArray(extractedFields.keywords || extractedFields.tags).length > 0
      ? pickArray(extractedFields.keywords || extractedFields.tags)
      : deriveKeywords(pickString(extractedFields.title, derived.title), content)
  };
};

const sanitizeSourceUrlValue = (value, historyId = '') => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  if (/^manual:/i.test(trimmed)) return '';
  if (historyId && trimmed === historyId) return '';
  return trimmed;
};

const NOTE_FIELD_COMPONENTS = {
  title: { type: 'text-short', title: '标题' },
  content: { type: 'text-long', title: '正文' },
  summary: { type: 'text-long', title: '摘要' },
  keywords: { type: 'tag', title: '关键词' },
  img_urls: { type: 'image', title: '图片' },
  source_url: { type: 'text-short', title: '原文链接' },
  author: { type: 'text-short', title: '作者' },
  published_at: { type: 'date', title: '发布时间' },
  source_platform: { type: 'text-short', title: '来源平台' },
  note_type: { type: 'text-short', title: '笔记类型' },
  link: { type: 'text-short', title: '链接' },
  note_created_at: { type: 'date', title: '笔记创建时间' }
};

const FIELD_LABEL_TO_KEY = Object.entries(NOTE_FIELD_COMPONENTS).reduce((acc, [key, meta]) => {
  acc[meta.title] = key;
  return acc;
}, {});

const randomSuffix = () => Math.random().toString(36).slice(2, 10);
const generateNoteId = () => `note_${Date.now()}_${randomSuffix()}`;
const generateComponentInstanceId = (fieldKey = 'component') =>
  `${fieldKey}_${Date.now()}_${randomSuffix()}`;

const resolveFieldKeyFromInstance = (instance = {}) => {
  if (!instance || typeof instance !== 'object') return null;
  const mappingSource =
    instance?.dataMapping?.source ||
    instance?.dataMapping?.field ||
    instance?.dataMapping?.sourceField;
  if (mappingSource && NOTE_FIELD_COMPONENTS[mappingSource]) {
    return mappingSource;
  }
  const idCandidate = typeof instance.id === 'string' ? instance.id.split('_')[0] : '';
  if (idCandidate && NOTE_FIELD_COMPONENTS[idCandidate]) {
    return idCandidate;
  }
  const normalizedTitle = typeof instance.title === 'string' ? instance.title.trim() : '';
  if (normalizedTitle && FIELD_LABEL_TO_KEY[normalizedTitle]) {
    return FIELD_LABEL_TO_KEY[normalizedTitle];
  }
  return null;
};

const parseNotebookComponentInstances = (rawConfig) => {
  if (!rawConfig) return [];
  let parsed = rawConfig;
  if (typeof rawConfig === 'string') {
    try {
      parsed = JSON.parse(rawConfig);
    } catch {
      parsed = null;
    }
  }
  let candidate = [];
  if (Array.isArray(parsed)) {
    candidate = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.componentInstances)) {
      candidate = parsed.componentInstances;
    } else if (Array.isArray(parsed.instances)) {
      candidate = parsed.instances;
    }
  }
  return (candidate || [])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const fieldKey = resolveFieldKeyFromInstance(item) || '';
      const blueprint = NOTE_FIELD_COMPONENTS[fieldKey] || {};
      const id =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : generateComponentInstanceId(fieldKey || `field${index}`);
      return {
        id,
        type: item.type || blueprint.type || 'text-short',
        title:
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : blueprint.title || `字段${index + 1}`,
        config:
          item.config && typeof item.config === 'object' && !Array.isArray(item.config)
            ? item.config
            : {},
        dataMapping:
          item.dataMapping && typeof item.dataMapping === 'object' && !Array.isArray(item.dataMapping)
            ? { ...item.dataMapping }
            : fieldKey
              ? { source: fieldKey }
              : {}
      };
    });
};

const ensureNotebookComponentForField = (instances, fieldKey) => {
  if (!fieldKey) return { instances, instance: null, added: false };
  const normalized = String(fieldKey);
  const existing = (instances || []).find(
    (instance) => resolveFieldKeyFromInstance(instance) === normalized
  );
  if (existing) {
    if (!existing.dataMapping || typeof existing.dataMapping !== 'object') {
      existing.dataMapping = { source: normalized };
    } else if (!existing.dataMapping.source) {
      existing.dataMapping.source = normalized;
    }
    return { instances, instance: existing, added: false };
  }
  const blueprint = NOTE_FIELD_COMPONENTS[normalized] || { type: 'text-short', title: normalized };
  const newInstance = {
    id: generateComponentInstanceId(normalized),
    type: blueprint.type || 'text-short',
    title: blueprint.title || normalized,
    config: {},
    dataMapping: { source: normalized }
  };
  instances.push(newInstance);
  return { instances, instance: newInstance, added: true };
};

const normalizeStringArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeString(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,，;]/)
      .map((item) => sanitizeString(item))
      .filter(Boolean);
  }
  return [];
};

const formatFieldValue = (fieldKey, rawValue, fallbackValue = '') => {
  if (fieldKey === 'keywords') {
    const keywords = normalizeStringArray(rawValue);
    if (keywords.length) {
      return { hasValue: true, value: keywords.join(', '), extra: { items: keywords } };
    }
    const fallback = normalizeStringArray(fallbackValue);
    return fallback.length
      ? { hasValue: true, value: fallback.join(', '), extra: { items: fallback } }
      : { hasValue: false, value: '' };
  }
  if (fieldKey === 'img_urls') {
    const urls = normalizeStringArray(rawValue);
    return urls.length
      ? { hasValue: true, value: urls.join('\n'), extra: { urls } }
      : { hasValue: false, value: '' };
  }
  if (Array.isArray(rawValue)) {
    const list = normalizeStringArray(rawValue);
    return list.length ? { hasValue: true, value: list.join(', ') } : { hasValue: false, value: '' };
  }
  if (typeof rawValue === 'object' && rawValue !== null) {
    return { hasValue: true, value: JSON.stringify(rawValue) };
  }
  const candidate = sanitizeString(rawValue);
  if (candidate) {
    return { hasValue: true, value: candidate };
  }
  const fallback = sanitizeString(fallbackValue);
  if (fallback) {
    return { hasValue: true, value: fallback };
  }
  return { hasValue: false, value: '' };
};

const DOUBAO_SUMMARY_PROMPT =
  '请将内容整理为不超过5条的要点，突出文章核心信息，使用简洁的中文有序列表输出。';

const normalizeAiOutput = (raw) => {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';
  // Remove markdown code fences if any
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
};

const buildSummaryBlockText = (summary) => {
  const cleaned = sanitizeString(summary || '');
  if (!cleaned) return '';
  return `【摘要】\n${cleaned}\n\n`;
};

const buildKeywordsBlockText = (keywords) => {
  const list = Array.isArray(keywords)
    ? keywords.map((k) => sanitizeString(k)).filter(Boolean)
    : typeof keywords === 'string'
      ? keywords
          .split(/[,\n，]/)
          .map((k) => sanitizeString(k)).filter(Boolean)
      : [];
  if (!list.length) return '';
  return `【关键词】\n${list.join('、')}\n\n`;
};

const buildSourceBlockText = ({
  sourceType,
  sourceUrl,
  sourcePlatform,
  author,
  publishedAt,
  noteCreatedAt
}) => {
  const normalizedType = sanitizeString(sourceType).toLowerCase();
  const url = sanitizeString(sourceUrl || '');
  const platform = sanitizeString(sourcePlatform || '');
  const safeAuthor = sanitizeString(author || '');
  const safePublished = sanitizeString(publishedAt || '');
  const safeCreatedAt = sanitizeString(noteCreatedAt || '');

  if (normalizedType !== 'link' && !url && !platform && !safeAuthor && !safePublished && !safeCreatedAt) {
    return '';
  }

  const lines = ['【来源】'];
  if (url) lines.push(`来源链接：${url}`);
  if (platform) lines.push(`来源平台：${platform}`);
  if (safeAuthor) lines.push(`作者：${safeAuthor}`);
  if (safePublished) lines.push(`发布时间：${safePublished}`);
  if (safeCreatedAt) lines.push(`记录时间：${safeCreatedAt}`);
  return lines.length > 1 ? `${lines.join('\n')}\n\n` : '';
};

const buildImageBlockText = (imgUrls) => {
  const urls = Array.isArray(imgUrls) ? imgUrls : [];
  const cleaned = urls.map((u) => sanitizeString(u)).filter(Boolean);
  if (!cleaned.length) return '';
  return `\n\n【图片】\n${cleaned.join('\n')}`;
};

const buildComponentDataMap = (
  componentInstances,
  parsedFields,
  historyId,
  sourceUrl,
  sourceType
) => {
  const dataMap = {};
  const fallbackTitle = sanitizeString(parsedFields?.title, '未命名笔记') || '未命名笔记';
  const fallbackContent =
    sanitizeString(parsedFields?.content || parsedFields?.summary || '') || '';
  (componentInstances || []).forEach((instance) => {
    const fieldKey = resolveFieldKeyFromInstance(instance);
    if (!fieldKey || !NOTE_FIELD_COMPONENTS[fieldKey]) return;
    const formatted = formatFieldValue(
      fieldKey,
      parsedFields ? parsedFields[fieldKey] : null,
      fieldKey === 'title' ? fallbackTitle : fieldKey === 'content' ? fallbackContent : ''
    );
    if (!formatted.hasValue) return;
    dataMap[instance.id] = {
      type: instance.type,
      title: instance.title || NOTE_FIELD_COMPONENTS[fieldKey]?.title || fieldKey,
      value: formatted.value,
      sourceField: fieldKey
    };
    if (formatted.extra) {
      Object.assign(dataMap[instance.id], formatted.extra);
    }
  });
  if (historyId) {
    dataMap.article_parse_history = {
      type: 'article_parse_history',
      title: '解析记录',
      value: {
        historyId,
        sourceUrl: sourceUrl || null,
        parsedAt: new Date().toISOString(),
        fields: parsedFields,
        sourceType: sourceType || null
      }
    };
  }

  // 隐藏元数据：用于分析/图表，不在详情页按组件字段展示
  const normalizedSourceType = sanitizeString(sourceType).toLowerCase() === 'link' ? 'link' : 'manual';
  const metaImgUrls = Array.isArray(parsedFields?.img_urls)
    ? parsedFields.img_urls.map((u) => sanitizeString(u)).filter(Boolean)
    : [];
  const metaSourceUrl =
    sanitizeString(parsedFields?.link || parsedFields?.source_url || sourceUrl || '') || null;
  dataMap.note_meta = {
    type: 'meta',
    title: 'note_meta',
    value: {
      sourceType: normalizedSourceType,
      sourceUrl: metaSourceUrl,
      sourcePlatform: sanitizeString(parsedFields?.source_platform || '') || null,
      author: sanitizeString(parsedFields?.author || '') || null,
      publishedAt: sanitizeString(parsedFields?.published_at || '') || null,
      imgUrls: metaImgUrls,
      noteType: sanitizeString(parsedFields?.note_type || parsedFields?.noteType || '') || null
    }
  };

  return dataMap;
};

const getNotebookById = async (db, notebookId) => {
  if (!db || !notebookId) return null;
  return await db.get(
    'SELECT notebook_id, name, description, note_count, component_config FROM notebooks WHERE notebook_id = ?',
    [notebookId]
  );
};

const saveNotebookComponentConfig = async (db, notebookId, componentInstances) => {
  if (!db || !notebookId) return;
  const now = new Date().toISOString();
  const payload = JSON.stringify({ componentInstances });
  await db.run(
    'UPDATE notebooks SET component_config = ?, updated_at = ? WHERE notebook_id = ?',
    [payload, now, notebookId]
  );
};

const updateNotebookNoteCount = async (db, notebookId) => {
  if (!db || !notebookId) return;
  const stats = await db.get('SELECT COUNT(*) as count FROM notes WHERE notebook_id = ?', [notebookId]);
  const now = new Date().toISOString();
  await db.run(
    'UPDATE notebooks SET note_count = ?, updated_at = ? WHERE notebook_id = ?',
    [stats?.count ?? 0, now, notebookId]
  );
};

const buildAutoNotebookComponentConfig = () => {
  const baseInstances = [];
  // 保持笔记本结构最小化：避免 link/manual 混用导致字段结构不一致
  const defaultFields = ['title', 'content', 'note_created_at'];
  defaultFields.forEach((fieldKey) => {
    ensureNotebookComponentForField(baseInstances, fieldKey);
  });
  return JSON.stringify({ componentInstances: baseInstances });
};

const findNotebookByName = async (db, name) => {
  if (!db || !name) return null;
  return await db.get('SELECT notebook_id, name FROM notebooks WHERE name = ? LIMIT 1', [name]);
};

const ensureNotebookForClassification = async (db, noteTypeRaw) => {
  const name = sanitizeString(noteTypeRaw || '');
  if (!db || !name) return null;
  const existing = await findNotebookByName(db, name);
  if (existing?.notebook_id) {
    return { notebook_id: existing.notebook_id, name: existing.name, created: false };
  }
  const notebookId = `notebook_${Date.now()}_${randomSuffix()}`;
  const now = new Date().toISOString();
  const description = `AI 自动创建（${name}）`;
  const componentConfig = buildAutoNotebookComponentConfig();
  await db.run(
    `INSERT INTO notebooks (notebook_id, name, description, note_count, component_config, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [notebookId, name, description, componentConfig, now, now]
  );
  return { notebook_id: notebookId, name, created: true };
};

const fetchNotebooks = async (db) => {
  const rows = await db.all(
    'SELECT notebook_id, name, description, note_count, component_config FROM notebooks ORDER BY updated_at DESC'
  );
  return (rows || []).map((row) => ({
    notebook_id: row?.notebook_id ? String(row.notebook_id) : null,
    name: row?.name || '',
    description: row?.description || '',
    note_count: typeof row?.note_count === 'number' ? row.note_count : Number(row?.note_count || 0) || 0,
    component_config: row?.component_config || null
  }));
};

const buildNotebookListText = (notebooks = []) => {
  if (!Array.isArray(notebooks) || notebooks.length === 0) return '（当前没有任何笔记本）';
  return notebooks
    .map((nb) => {
      const desc = nb.description ? nb.description.replace(/\n/g, ' ') : '无描述';
      return `${nb.name || '未命名'} | ${desc} | ${nb.note_count || 0}条`;
    })
    .join('\n');
};

const extractJsonFromAi = (text = '') => {
  if (!text || typeof text !== 'string') throw new Error('AI 响应为空');
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  }
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : cleaned;
  return JSON.parse(jsonText);
};

const buildNotebookPrompt = ({ notebooks, parsedFields }) => {
  const notebooksText = buildNotebookListText(notebooks);
  const contentPreview = sanitizeString(parsedFields.content || parsedFields.summary || '').slice(0, 500);
  const keywordsText =
    Array.isArray(parsedFields.keywords) && parsedFields.keywords.length > 0
      ? parsedFields.keywords.join('、')
      : '无';

  return `
你是笔记分类助手，请根据用户的笔记内容和现有笔记本列表，推荐一个最合适的笔记本；如果列表里没有合适的，再给出一个新的笔记本名称。
严格按以下 JSON 返回，不要输出多余文本：
{
  "suggestedNotebookName": "最合适的笔记本名称",
  "createNew": true 或 false,
  "reason": "简短推荐理由"
}

现有笔记本列表（名称 | 描述 | 笔记数量）：
${notebooksText}

待分类的笔记信息：
- 标题: ${parsedFields.title || '未命名笔记'}
- 摘要: ${parsedFields.summary || '无摘要'}
- 关键词: ${keywordsText}
- 来源平台: ${parsedFields.source_platform || '未知'}
- 正文预览（截取前500字）: ${contentPreview || '无正文'}
`.trim();
};

const selectNotebookWithAI = async ({ db, aiService, parsedFields }) => {
  if (!db || !aiService) throw new Error('缺少数据库或AI实例');
  const notebooks = await fetchNotebooks(db);
  const prompt = buildNotebookPrompt({ notebooks, parsedFields });
  let aiChoice = null;
  try {
    const aiResp = await aiService.generateText(prompt, { temperature: 0.3, maxTokens: 800 });
    aiChoice = extractJsonFromAi(aiResp);
  } catch (err) {
    console.warn('⚠️ AI 笔记本推荐失败，使用兜底分类:', err?.message || err);
  }

  let suggestedName = sanitizeString(aiChoice?.suggestedNotebookName || '');
  const createNew = !!aiChoice?.createNew;

  // 优先匹配现有笔记本（名称大小写无关）
  if (suggestedName) {
    const matched = notebooks.find(
      (nb) => nb.name && nb.name.trim().toLowerCase() === suggestedName.trim().toLowerCase()
    );
    if (matched && !createNew) {
      return {
        notebookId: matched.notebook_id,
        notebookName: matched.name,
        created: false,
        reason: aiChoice?.reason || 'AI 推荐使用已有笔记本'
      };
    }
  }

  // 需要新建或未匹配到，使用推荐名称或类型兜底创建
  const targetName =
    suggestedName ||
    parsedFields.note_type ||
    parsedFields.noteType ||
    parsedFields.source_platform ||
    '通用笔记';

  const fallbackNotebook = await ensureNotebookForClassification(db, targetName);
  if (!fallbackNotebook?.notebook_id) {
    throw new Error('AI 未能确定合适的笔记本，且兜底创建失败');
  }
  return {
    notebookId: fallbackNotebook.notebook_id,
    notebookName: fallbackNotebook.name,
    created: fallbackNotebook.created,
    reason: aiChoice?.reason || (fallbackNotebook.created ? 'AI 推荐并新建' : 'AI 推荐匹配')
  };
};

const createNoteFromParsedResult = async ({
  db,
  aiService,
  notebookId,
  parsedFields,
  historyId,
  sourceUrl,
  sourceType
}) => {
  if (!db || !notebookId) {
    throw new Error('缺少推荐的 notebookId');
  }
  const notebook = await getNotebookById(db, notebookId);
  if (!notebook) {
    throw new Error('推荐的笔记本不存在或已被删除');
  }
  const normalizedFields =
    parsedFields && typeof parsedFields === 'object' && !Array.isArray(parsedFields)
      ? parsedFields
      : {};

  // 不再基于解析结果修改笔记本字段结构，避免同一笔记本里 link/manual 结构不一致
  const componentInstances = parseNotebookComponentInstances(notebook.component_config);

  const componentData = buildComponentDataMap(
    componentInstances,
    normalizedFields,
    historyId,
    sourceUrl,
    sourceType
  );
  const noteId = generateNoteId();
  const now = new Date().toISOString();
  const resolvedTitle = sanitizeString(normalizedFields.title, '未命名笔记') || '未命名笔记';
  const baseContent = sanitizeString(normalizedFields.content || normalizedFields.summary || '') || '';
  const sanitizedSourceUrl =
    sanitizeString(normalizedFields.link || normalizedFields.source_url || sourceUrl) || '';
  const sanitizedOriginalUrl =
    sanitizeString(normalizedFields.link || normalizedFields.source_url || sourceUrl) || null;
  const sanitizedAuthor = sanitizeString(normalizedFields.author || '') || null;
  const uploadTime =
    sanitizeString(normalizedFields.note_created_at || normalizedFields.published_at || '') || null;
  const sourcePlatform =
    sanitizeString(normalizedFields.source_platform || '') || null;
  const imageUrls = Array.isArray(normalizedFields.img_urls)
    ? normalizedFields.img_urls.map((u) => sanitizeString(u)).filter(Boolean)
    : [];

  let aiSummary = '';
  try {
    const hasContentForSummary = baseContent && baseContent.trim().length >= 30;
    if (aiService && hasContentForSummary) {
      const summaryPrompt = `${DOUBAO_SUMMARY_PROMPT}\n\n内容：${baseContent}`;
      // 优先强制走豆包（若已配置），否则按 AIService 的 providerOrder 兜底
      const result =
        aiService.doubaoConfigured && typeof aiService._callDoubaoAPI === 'function'
          ? await aiService._callDoubaoAPI([{ role: 'user', content: summaryPrompt }], {
              temperature: 0.7,
              maxTokens: 500
            })
          : await aiService.generateText(summaryPrompt, { temperature: 0.7, maxTokens: 500 });
      aiSummary = normalizeAiOutput(result);
    }
  } catch (err) {
    console.warn('⚠️ 生成豆包摘要失败，忽略摘要:', err?.message || err);
  }

  // 除 title/note_type/status 外，其余字段一律写入“内容”组件（中文标签）
  const summaryBlock = buildSummaryBlockText(aiSummary || normalizedFields.summary || '');
  const keywordsBlock = buildKeywordsBlockText(normalizedFields.keywords || normalizedFields.tags || []);
  const sourceBlock = buildSourceBlockText({
    sourceType,
    sourceUrl: sanitizedSourceUrl,
    sourcePlatform,
    author: sanitizedAuthor,
    publishedAt: sanitizeString(normalizedFields.published_at || '') || '',
    noteCreatedAt: sanitizeString(normalizedFields.note_created_at || '') || ''
  });
  const imageBlock = buildImageBlockText(imageUrls);
  const resolvedContentText = `${summaryBlock}${sourceBlock}${keywordsBlock}${baseContent}${imageBlock}`.trim();

  await db.run(
    `INSERT INTO notes (
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      noteId,
      notebookId,
      resolvedTitle,
      resolvedContentText || null,
      null,
      imageUrls.length ? imageUrls.join('\n') : null,
      sanitizedSourceUrl,
      sourcePlatform,
      sanitizedOriginalUrl,
      sanitizedAuthor,
      uploadTime,
      JSON.stringify(componentData),
      JSON.stringify(componentInstances),
      now,
      now
    ]
  );

  await updateNotebookNoteCount(db, notebookId);

  return {
    success: true,
    noteId,
    notebookId,
    notebookName: notebook.name,
    componentInstances,
    componentData
  };
};

// 当 Coze 返回纯文本时，借助 AI 生成结构化 JSON
const generateStructuredFromText = async (aiService, { articleUrl = '', content = '' }) => {
  if (!aiService || !content || !content.trim()) return null;
  const prompt = `
你是一个信息提取助手，请严格从给定正文中抽取信息并输出唯一的 JSON。
不得添加任何解释、注释或多余内容，最终只输出 JSON。

请按以下规则提取字段：

1️⃣ title（标题提取）
取原文首行第一句，若长度 ≤ 60 字 则直接作为标题；
若超过 60 字，视为“无标题”，则需基于首段内容自动生成一个不超过 20 字的总结性标题。

2️⃣ content（正文内容提取）
从提供的正文中完整提取正文部分，并保持原有排版，规则如下：
必须保留：
- 自然段之间的空行
- 原文中的换行符 \\n
- 段首缩进
- 原有的列表符号（如 •、-、1. 等）
必须剔除：
- 正文中再次出现的 标题、发布时间、作者、地区 这四类重复信息
- 首段（或全文）中位于真正正文之前的“引子/导语”块，典型特征：单独成段、≤50 字；出现“记者/编辑/来源/作者”等署名关键词；与后续正文用空行或标点（如“——”）分隔。凡符合任一特征，整段直接删除，不保留任何字符。
不得进行任何合并、修改或重新排版。

3️⃣ published_at（发布时间）
识别正文或元信息中的发布时间；
输出格式必须为：YYYY/M/D HH:mm:ss
若无法识别，返回空字符串 ""。

4️⃣ author（作者）
识别作者或机构，规则如下：
- 如果出现多个名称，优先取第二个；
- 标题后 200 字内若出现“来源：”“文｜”后的机构名，优先选取；
- 必须过滤掉含有“记者”“编辑”的 2–4 字短人名；
- 若未识别到，再查 <meta name="author">；
- 若仍未识别，返回 "未知作者"。

5️⃣ link（原文链接）
保持用户输入的 URL，不做修改。

6️⃣ img_urls（图片链接数组）
检测正文中的所有图片链接；
若有多个，全部放入数组；
若无图片，返回 []；
若图片值为 null，则返回 null。

7️⃣ source_platform（来源平台识别）
根据 URL 域名判断来源平台：
- 包含 weixin → "微信公众号"
- 包含 douyin → "抖音"
- 包含 xiaohongshu → "小红书"
- 包含 longbridge → "长桥"
- 其他域名 → 返回对应平台名称（如“新浪新闻”等），国外平台提取英文即可
- 无法识别 → 返回空字符串 ""

8️⃣ note_type（内容类型）
结合正文内容自动判定类型，如：
时政新闻 / 财经分析 / 科技资讯 / AI 工具教程 / 生活笔记 / 产品测评
无法识别则返回 ""。

9️⃣ keywords（关键词）
从正文中提炼约 3 个关键词；
必须为字符串数组；
若无法识别，返回 []。

📌 最终输出格式（必须严格一致）：
{
  "title": "",
  "content": "",
  "published_at": "",
  "author": "",
  "link": "",
  "img_urls": [],
  "source_platform": "",
  "note_type": "",
  "keywords": ["", "", ""]
}

原文链接：${articleUrl || '（未提供）'}
正文：
${content}
  `.trim();

  try {
    const aiResult = await aiService.generateText(prompt, { temperature: 0.3, maxTokens: 500 });
    if (!aiResult || typeof aiResult !== 'string') return null;
    
    // Clean up possible markdown code blocks returned by the AI
    let cleaned = aiResult.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/```json\s*/i, '').replace(/```\s*$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```\s*/i, '').replace(/```\s*$/, '');
    }

    if (!cleaned.startsWith('{')) {
       console.warn('⚠️ AI structuring response does not start with "{" after cleanup');
       return null;
    }
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (err) {
    console.warn('⚠️ AI 生成结构化 JSON 失败:', err?.message || err);
  }
  return null;
};

const router = express.Router();

/**
 * 初始化解析路由
 * @param {object} db - 数据库实例
 * @returns {express.Router}
 */
export function initParseRoutes(db) {
  const aiService = new AIService();

  // 链接查重：判断文章是否已解析过
  router.post('/api/coze/check-article-exists', async (req, res) => {
    try {
      const { articleUrl } = req.body || {};
      if (!articleUrl || typeof articleUrl !== 'string' || !articleUrl.trim()) {
        return res.status(400).json({ success: false, error: '请提供有效的文章URL' });
      }

      const normalizedUrl = articleUrl.trim();
      const existing = await db.get(
        'SELECT id FROM article_parse_history WHERE source_url = ? ORDER BY parsed_at DESC LIMIT 1',
        [normalizedUrl]
      );

      res.json({
        success: true,
        exists: !!existing,
        existingHistoryId: existing?.id || null
      });
    } catch (error) {
      console.error('❌ 检查链接是否已解析失败:', error);
      res.status(500).json({ success: false, error: error.message || '检查失败' });
    }
  });
  // 解析文章链接
  router.post('/api/coze/parse-article', async (req, res) => {
    try {
      const { articleUrl, query, aiSummaryConfig } = req.body;
      
      if (!articleUrl || typeof articleUrl !== 'string' || !articleUrl.trim()) {
        return res.status(400).json({ 
          success: false, 
          error: '请提供有效的文章URL' 
        });
      }
      const cleanedArticleUrl = articleUrl.trim();

      // Coze配置（仅使用 Workflow，不走 bot/chat）
      const COZE_WEBHOOK_URL = ''; // 禁用 webhook
      const COZE_ACCESS_TOKEN = (process.env.COZE_ACCESS_TOKEN || '').trim(); // workflow:run token
      const COZE_WORKFLOW_ID = (process.env.COZE_WORKFLOW_ID || '').trim();
      const COZE_APP_ID = (process.env.COZE_APP_ID || '').trim(); // 可选

      console.log('🔍 Coze配置检查:');
      console.log('- COZE_WEBHOOK_URL: 已禁用（未使用 webhook）');
      console.log('- COZE_ACCESS_TOKEN:', COZE_ACCESS_TOKEN ? `${COZE_ACCESS_TOKEN.substring(0, 10)}... (长度: ${COZE_ACCESS_TOKEN.length})` : '未配置');
      console.log('- COZE_WORKFLOW_ID:', COZE_WORKFLOW_ID || '未配置');
      console.log('- COZE_APP_ID:', COZE_APP_ID || '未配置（可选）');
      
      if (!COZE_ACCESS_TOKEN || !COZE_WORKFLOW_ID) {
        // 这是配置问题，不应该以 500 形式让前端误判为“服务崩了”
        return res.json({
          success: false,
          code: 'COZE_NOT_CONFIGURED',
          error: 'Coze Workflow 未配置：请设置 COZE_ACCESS_TOKEN 与 COZE_WORKFLOW_ID（需要 workflow:run 权限）'
        });
      }

      console.log('📝 调用Coze工作流解析文章:', articleUrl);
      
      let parsedContent = '';
      let suggestedNotebookName = null;
      let historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let chatId = null;
      let conversationId = null;
      let responseData = null;
      let parsedSummary = null;
      let parsedFields = {};
      const normalizedSourceUrl = sanitizeSourceUrlValue(cleanedArticleUrl, historyId);
      const hostname = (() => {
        try {
          return new URL(cleanedArticleUrl).hostname || '';
        } catch {
          return '';
        }
      })();
      const preferHtmlFallback =
        hostname.includes('longportapp.') || hostname.includes('longbridge.') || hostname.includes('longport');

      // 某些站点（例如 LongPort）Coze 偶发/持续 ECONNRESET，但网页 HTML 中已包含完整正文（JSON-LD / __NEXT_DATA__）。
      // 这类站点优先走 HTML 兜底解析，避免用户长时间卡在“解析中”。
      if (preferHtmlFallback) {
        const fallback = await tryFallbackParseByFetchingHtml(cleanedArticleUrl);
        if (fallback?.extractedFields?.content) {
          parsedContent = JSON.stringify(fallback.extractedFields);
          responseData = { code: 0, msg: '', data: fallback.extractedFields, fallback: fallback.meta };
          console.log('✅ 已使用 HTML 兜底解析（跳过 Coze）:', fallback.meta);
        }
      }
      
      // 仅使用 Coze Workflow
      if (COZE_ACCESS_TOKEN && COZE_WORKFLOW_ID && !parsedContent) {
        const callCozeWorkflowOnce = async () => {
          const cozeApiUrl = `https://api.coze.cn/v1/workflow/run`;

          const parameters = { input: cleanedArticleUrl };
          if (query) parameters.query = query;

          const apiPayload = {
            workflow_id: COZE_WORKFLOW_ID,
            parameters,
            is_async: false
          };
          if (COZE_APP_ID) apiPayload.app_id = COZE_APP_ID;

          console.log(`🔄 调用 Coze Workflow: ${cozeApiUrl}`);
          console.log(`📦 Workflow ID: ${COZE_WORKFLOW_ID}`);
          console.log(`🔑 使用 ACCESS_TOKEN 前缀: ${COZE_ACCESS_TOKEN.substring(0, 10)}...`);

          const startedAt = Date.now();
          const apiResponse = await axios.post(cozeApiUrl, apiPayload, {
            headers: {
              Authorization: `Bearer ${COZE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            responseType: 'json',
            timeout: 300000,
            // 避免 axios 读取环境代理导致链路不一致
            proxy: false,
            httpsAgent: createCozeHttpsAgent(),
            validateStatus: (status) => status < 500
          });

          const statusCode = apiResponse.status;
          const contentType = apiResponse.headers['content-type'] || '';
          const logId =
            apiResponse.headers?.['x-tt-logid'] ||
            apiResponse.headers?.['x-tt-logid'.toLowerCase()] ||
            apiResponse.headers?.['x-tt-logid'.toUpperCase()];
          console.log(`📊 Workflow 响应状态码: ${statusCode}（${Date.now() - startedAt}ms）`);
          console.log(`📄 响应 Content-Type: ${contentType}`);
          if (logId) console.log(`🧾 X-Tt-Logid: ${logId}`);
          
          if (statusCode === 401 || statusCode === 403 || apiResponse.data?.code === 4100) {
            throw new Error(`Coze Workflow 鉴权失败 (${statusCode}): 请检查 COZE_ACCESS_TOKEN 是否有效、是否有 workflow:run 权限，且与 workflow 同一空间`);
          }
          
          if (contentType.includes('text/html')) {
            const preview = typeof apiResponse.data === 'string' ? apiResponse.data.substring(0, 500) : '';
            console.error(`❌ Coze Workflow 返回了 HTML 页面 (状态码: ${statusCode}):`, preview);
            throw new Error(`Coze Workflow 返回了 HTML 登录页 (状态码: ${statusCode})，说明请求未授权或参数错误`);
          }

          const data = apiResponse.data;
          if (data?.code && data.code !== 0) {
            throw new Error(`Coze Workflow 返回状态 failed，code=${data.code} msg=${data.msg || ''}`);
          }

          const parsedData = data?.data;
          const answer = (() => {
            const val = parsedData;
            if (!val) return '';
            const msgs = val.messages || val.data || [];
            if (Array.isArray(msgs)) {
              const assistantMsg = [...msgs].reverse().find(
                (m) =>
                  (m.role === 'assistant' || m.type === 'answer') &&
                  typeof m.content === 'string' &&
                  m.content.trim()
              );
              if (assistantMsg?.content) return assistantMsg.content.trim();
            }
            if (typeof val === 'string') return val;
            if (val.answer) return val.answer;
            if (val.result) return typeof val.result === 'string' ? val.result : JSON.stringify(val.result);
            return JSON.stringify(val);
          })();

          parsedContent = answer || parsedContent;
          responseData = data;
          chatId = null;
          conversationId = null;

          if (!parsedContent) {
            parsedContent = '对话仍在处理中，请稍后查看解析历史。';
          }
        };

        const maxAttempts = preferHtmlFallback ? 1 : 4;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStartedAt = Date.now();
          try {
            await callCozeWorkflowOnce();
            break;
          } catch (apiError) {
            console.error(`❌ Coze Workflow 调用失败(第${attempt + 1}次):`, apiError.message, apiError?.code || '');
            console.error(`⏱️ 本次失败耗时: ${Date.now() - attemptStartedAt}ms`);
            if (isAbortError(apiError)) {
              const backoff = Math.min(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 200), 6000);
              if (attempt < maxAttempts - 1) {
                await sleep(backoff);
                continue;
              }
              // 最终失败：尝试用“抓取网页 HTML”做兜底解析（例如 LongPort 某些链接 Coze 会持续 ECONNRESET）
              const fallback = await tryFallbackParseByFetchingHtml(cleanedArticleUrl);
              if (fallback?.extractedFields?.content) {
                parsedContent = JSON.stringify(fallback.extractedFields);
                responseData = {
                  code: 0,
                  msg: '',
                  data: fallback.extractedFields,
                  fallback: fallback.meta,
                  coze_error: buildCozeFailurePayload(apiError, {
                    workflowId: COZE_WORKFLOW_ID,
                    attempt: attempt + 1
                  })
                };
                console.warn('⚠️ Coze 失败，已启用 HTML 兜底解析:', fallback.meta);
                break;
              }

              // 兜底也失败：落库失败记录，便于排查
              try {
                const now = new Date().toISOString();
                await db.run(
                  `INSERT INTO article_parse_history
                   (id, source_url, status, parse_query, coze_response_data, created_at, parsed_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    historyId,
                    normalizedSourceUrl || cleanedArticleUrl,
                    'failed',
                    query || null,
                    buildCozeFailurePayload(apiError, { workflowId: COZE_WORKFLOW_ID, attempt: attempt + 1 }),
                    now,
                    now,
                    now
                  ]
                );
              } catch (persistErr) {
                console.warn('⚠️ 保存 Coze 失败记录到解析历史失败（已忽略）:', persistErr?.message || persistErr);
              }
              return res.status(504).json({
                success: false,
                historyId,
                error: 'Coze 请求超时或被中断（ECONNRESET/socket hang up），请稍后重试'
              });
            }
            if (apiError.response) {
              console.error('状态码:', apiError.response.status);
              console.error('响应头:', apiError.response.headers);
            }
            throw apiError;
          }
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

      // 生成 AI 摘要（可选）
      if (aiSummaryConfig?.enabled && aiSummaryConfig?.prompt) {
        try {
          const summaryPrompt = `${aiSummaryConfig.prompt}\n\n内容：${parsedContent}`;
          parsedSummary = await aiService.generateText(summaryPrompt, {
            temperature: 0.7,
            maxTokens: 500
          });
        } catch (summaryError) {
          console.warn('⚠️ 生成AI摘要失败，忽略摘要:', summaryError?.message || summaryError);
        }
      }

      // 如果不是 JSON，则先清洗掉工具调用/客套话
      let parsedContentForExtraction = parsedContent;
      let cleanedParsedContent = parsedContent;
      if (typeof parsedContent === 'string') {
        const trimmed = parsedContent.trim();
        const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        cleanedParsedContent = looksJson ? parsedContent : cleanParsedContentText(parsedContent);
        parsedContentForExtraction = cleanedParsedContent;
      }

      // 若仅返回工具调用而无正文，直接判定为失败
      if (isToolCallOnlyPayload(parsedContentForExtraction)) {
        const errorMsg = '解析失败：Coze 仅返回了工具调用结果，未获取到文章正文，请检查 workflow/工具配置或重试。';
        console.error('❌', errorMsg, '内容预览:', parsedContentForExtraction.slice(0, 200));
        return res.status(502).json({ success: false, error: errorMsg });
      }

      // 尝试从 parsedContent 中提取结构化字段（如果 Coze 返回的是 JSON 格式）
      let extractedFields = {};
      const tryParseFields = (value) => {
        if (!value) return null;
        try {
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
            const obj = JSON.parse(trimmed);
            return obj && typeof obj === 'object' ? obj : null;
          }
          if (typeof value === 'object') return value;
        } catch (e) {
          return null;
        }
        return null;
      };
      // 优先使用 Coze 返回的 parsed_fields 字段（如果有）
      const cozeParsedFields = tryParseFields(responseData?.parsed_fields);
      if (cozeParsedFields) {
        extractedFields = Array.isArray(cozeParsedFields) ? cozeParsedFields[0] : cozeParsedFields;
        console.log('🔍 使用 Coze 返回的 parsed_fields');
      }
      if (parsedContent && typeof parsedContent === 'string' && parsedContent.trim()) {
        const trimmedContent = parsedContentForExtraction.trim();
        
        // 尝试解析为 JSON
        try {
          // 检查是否是 JSON 格式（以 { 或 [ 开头），且尚未有提取结果
          if (!Object.keys(extractedFields).length && (trimmedContent.startsWith('{') || trimmedContent.startsWith('['))) {
            const parsedJson = JSON.parse(trimmedContent);
            
            if (typeof parsedJson === 'object' && parsedJson !== null) {
              console.log('🔍 检测到 Coze 返回了 JSON 格式，尝试提取结构化字段');
              console.log('  - JSON 键:', Object.keys(parsedJson));
              
              // 如果解析的是数组，取第一个元素
              const dataObj = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
              
              if (dataObj && typeof dataObj === 'object') {
                // 提取各个字段（支持多种可能的字段名）
                if (dataObj.title && typeof dataObj.title === 'string') {
                  extractedFields.title = dataObj.title.trim();
                  console.log('  ✅ 提取到 title:', extractedFields.title);
                }
                
                if (dataObj.author && typeof dataObj.author === 'string') {
                  extractedFields.author = dataObj.author.trim();
                  console.log('  ✅ 提取到 author:', extractedFields.author);
                }
                
                if (dataObj.source_platform || dataObj.platform) {
                  extractedFields.source_platform = (dataObj.source_platform || dataObj.platform).trim();
                  console.log('  ✅ 提取到 source_platform:', extractedFields.source_platform);
                }
                
                if (dataObj.note_type || dataObj.noteType) {
                  extractedFields.note_type = (dataObj.note_type || dataObj.noteType).trim();
                  console.log('  ✅ 提取到 note_type:', extractedFields.note_type);
                }
                
                if (dataObj.published_at || dataObj.publishedAt || dataObj.publish_time) {
                  extractedFields.published_at = (dataObj.published_at || dataObj.publishedAt || dataObj.publish_time).trim();
                  console.log('  ✅ 提取到 published_at:', extractedFields.published_at);
                }
                
                // 图片 URLs（可能是数组或字符串）
                if (dataObj.img_urls || dataObj.image_urls || dataObj.images) {
                  const imgUrls = dataObj.img_urls || dataObj.image_urls || dataObj.images;
                  if (Array.isArray(imgUrls) && imgUrls.length > 0) {
                    extractedFields.img_urls = imgUrls.filter(url => url && typeof url === 'string' && url.trim());
                    console.log('  ✅ 提取到 img_urls:', extractedFields.img_urls.length, '个');
                  } else if (typeof imgUrls === 'string' && imgUrls.trim()) {
                    extractedFields.img_urls = [imgUrls.trim()];
                    console.log('  ✅ 提取到 img_urls (单个):', extractedFields.img_urls[0]);
                  }
                }
                
                // 关键词（可能是数组或字符串）
                if (dataObj.keywords || dataObj.tags) {
                  const keywords = dataObj.keywords || dataObj.tags;
                  if (Array.isArray(keywords) && keywords.length > 0) {
                    extractedFields.keywords = keywords.filter(k => k && typeof k === 'string' && k.trim());
                    console.log('  ✅ 提取到 keywords:', extractedFields.keywords.length, '个');
                  } else if (typeof keywords === 'string' && keywords.trim()) {
                    // 如果是逗号分隔的字符串，分割成数组
                    extractedFields.keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
                    console.log('  ✅ 提取到 keywords (字符串):', extractedFields.keywords.length, '个');
                  }
                }
                
                // 内容字段（如果 JSON 中有单独的内容字段，使用它；否则使用整个 JSON 的字符串表示）
                if (dataObj.content && typeof dataObj.content === 'string' && dataObj.content.trim()) {
                  extractedFields.content = dataObj.content.trim();
                  console.log('  ✅ 提取到 content，长度:', extractedFields.content.length);
                } else if (dataObj.body && typeof dataObj.body === 'string' && dataObj.body.trim()) {
                  extractedFields.content = dataObj.body.trim();
                  console.log('  ✅ 提取到 body 作为 content，长度:', extractedFields.content.length);
                } else if (dataObj.text && typeof dataObj.text === 'string' && dataObj.text.trim()) {
                  extractedFields.content = dataObj.text.trim();
                  console.log('  ✅ 提取到 text 作为 content，长度:', extractedFields.content.length);
                }
                
                // 摘要字段
                if (dataObj.summary && typeof dataObj.summary === 'string') {
                  extractedFields.summary = dataObj.summary.trim();
                  console.log('  ✅ 提取到 summary:', extractedFields.summary.substring(0, 50));
                }
                
                // 链接字段
                if (dataObj.link || dataObj.url || dataObj.source_url) {
                  extractedFields.link = (dataObj.link || dataObj.url || dataObj.source_url).trim();
                  console.log('  ✅ 提取到 link:', extractedFields.link);
                }
              }
            }
          }
        } catch (jsonError) {
          // 不是 JSON 格式，继续使用原始内容
          console.log('ℹ️ parsedContent 不是 JSON 格式，使用原始文本内容');
        }
      }

      // 清洗提取字段中的噪声
      if (Object.keys(extractedFields).length) {
        extractedFields = sanitizeExtractedFields(extractedFields);
      }

      // 如果未能提取到结构化字段，尝试调用 AI 将纯文本转为 JSON
      const needAiStructure =
        Object.keys(extractedFields).length === 0 ||
        (!extractedFields.title && !extractedFields.published_at && !extractedFields.author && !extractedFields.keywords);
      if (needAiStructure && parsedContent && parsedContent.trim()) {
        console.log('🤖 尝试调用 AI 将纯文本转为结构化 JSON');
        const aiStructured = await generateStructuredFromText(aiService, {
          articleUrl,
          content: parsedContent
        });
        if (aiStructured && typeof aiStructured === 'object') {
          extractedFields = aiStructured;
          console.log('  ✅ AI 生成的结构化字段键:', Object.keys(extractedFields));
        } else {
          console.log('  ⚠️ AI 未返回有效 JSON，继续使用原始内容');
        }
      }

      // 清洗提取字段中的噪声
      if (Object.keys(extractedFields).length) {
        extractedFields = sanitizeExtractedFields(extractedFields);
      }

      // 标准化字段：无论 Coze 返回 JSON 还是纯文本，都输出完整键集
      const normalizedParsedFields = normalizeParsedFields({
        extractedFields,
        fallbackContent: parsedContentForExtraction || '',
        fallbackSummary: parsedSummary || '',
      articleUrl: articleUrl || ''
    });

      // 兜底：即使 AI 未返回结构化 JSON，也保证核心字段键存在
      // 避免只有 content 被保存导致 title/author/published_at 为空
      const ensuredParsedFields = { ...normalizedParsedFields };
      const ensure = (key, fallback) => {
        if (ensuredParsedFields[key] === undefined || ensuredParsedFields[key] === null) {
          ensuredParsedFields[key] = fallback;
        }
      };
      const firstLine = (parsedContent || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
      ensure('title', firstLine.slice(0, 60));
      ensure('author', '');
      ensure('published_at', '');
      ensure('summary', '');
      ensure('link', articleUrl || '');
      ensure('img_urls', []);
      ensure('keywords', []);
      ensure('note_created_at', formatToPublishedStyle(new Date().toISOString()));
      ensure('source_platform', '');
      ensure('note_type', '');
      
      console.log('📦 最终 parsedFields 键:', Object.keys(ensuredParsedFields));
      const finalParsedSummary = sanitizeSummary(parsedSummary || ensuredParsedFields.summary || '');
      const finalParsedTitle = ensuredParsedFields.title || null;
      const finalParsedAuthor = ensuredParsedFields.author || null;
      const finalParsedPublishedAt = ensuredParsedFields.published_at || null;
      const finalParsedPlatform = ensuredParsedFields.source_platform || null;
      const tagsValue =
        Array.isArray(ensuredParsedFields.keywords) && ensuredParsedFields.keywords.length > 0
          ? JSON.stringify(ensuredParsedFields.keywords)
          : null;
      parsedFields = ensuredParsedFields;

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
      if (!suggestedNotebookId) {
        const fallbackNotebook = await ensureNotebookForClassification(
          db,
          parsedFields.note_type || parsedFields.noteType
        );
        if (fallbackNotebook?.notebook_id) {
          suggestedNotebookId = fallbackNotebook.notebook_id;
          suggestedNotebookName = fallbackNotebook.name || parsedFields.note_type || null;
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
      if (!parsedFields.note_created_at) {
        parsedFields.note_created_at = formatToPublishedStyle(now);
      }
      const contentToSave =
        (parsedFields.content && parsedFields.content.trim()) ||
        (parsedContentForExtraction && parsedContentForExtraction.trim()) ||
        '解析中或解析失败，请稍后查看结果';
      let historySaved = false;
      try {
        // 检查历史记录是否已存在
        // 计算5分钟前的时间戳
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const existingHistory = await db.get(
          'SELECT id FROM article_parse_history WHERE source_url = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1',
          [cleanedArticleUrl, fiveMinutesAgo]
        );
        
        if (existingHistory) {
          historyId = existingHistory.id;
          // 更新现有记录
          await db.run(
            `UPDATE article_parse_history SET 
             parsed_content = ?, parsed_title = ?, parsed_summary = ?, parsed_author = ?, parsed_published_at = ?, parsed_platform = ?, 
             parsed_fields = ?, tags = ?, suggested_notebook_id = ?, suggested_notebook_name = ?, 
             status = ?, coze_response_data = ?, updated_at = ?, parsed_at = ?
             WHERE id = ?`,
            [
              contentToSave,
              finalParsedTitle,
              finalParsedSummary,
              finalParsedAuthor,
              finalParsedPublishedAt,
              finalParsedPlatform,
              Object.keys(parsedFields).length ? JSON.stringify(parsedFields) : null,
              tagsValue,
              suggestedNotebookId,
              suggestedNotebookName || null,
              historyStatus,
              JSON.stringify(responseDataWithIds),
              now,
              now,
              existingHistory.id
            ]
          );
          historySaved = true;
          console.log('✅ 解析历史已更新:', existingHistory.id);
        } else {
          // 创建新记录
          await db.run(
            `INSERT INTO article_parse_history 
             (id, source_url, parsed_content, parsed_title, parsed_summary, parsed_author, parsed_published_at, parsed_platform, 
              parsed_fields, tags, suggested_notebook_id, suggested_notebook_name, 
              status, parse_query, coze_response_data, created_at, parsed_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              historyId,
              articleUrl.trim(),
              contentToSave,
              finalParsedTitle,
              finalParsedSummary,
              finalParsedAuthor,
              finalParsedPublishedAt,
              finalParsedPlatform,
              Object.keys(parsedFields).length ? JSON.stringify(parsedFields) : null,
              tagsValue,
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
          historySaved = true;
          console.log('✅ 解析历史已保存:', historyId);
        }
      } catch (historyError) {
        console.error('❌ 保存解析历史失败:', historyError);
        return res.status(500).json({ success: false, error: '保存解析历史失败', details: historyError?.message });
      }

      if (!historySaved) {
        return res.status(500).json({ success: false, error: '解析历史未保存成功' });
      }

      res.json({
        success: true,
        data: {
          content: parsedContent.trim(),
          suggestedNotebookName: suggestedNotebookName,
          suggestedNotebookId: suggestedNotebookId,
          parsedSummary: finalParsedSummary,
          parsedFields,
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
      const { page = 1, limit = 20, status, notebook_id, keyword } = req.query;
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

      if (keyword && typeof keyword === 'string' && keyword.trim()) {
        const likeValue = `%${keyword.trim()}%`;
        query +=
          ' AND (parsed_title LIKE ? OR parsed_summary LIKE ? OR source_url LIKE ? OR parsed_content LIKE ?)';
        params.push(likeValue, likeValue, likeValue, likeValue);
      }
      
      query += ' ORDER BY COALESCE(parsed_at, created_at) DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), offset);
      
      const historyRows = (await db.all(query, params)) || [];
      const historyList = historyRows.map((row) => ({
        ...row,
        source_url: sanitizeSourceUrlValue(row?.source_url, row?.id)
      }));
      
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

      if (keyword && typeof keyword === 'string' && keyword.trim()) {
        const likeValue = `%${keyword.trim()}%`;
        countQuery +=
          ' AND (parsed_title LIKE ? OR parsed_summary LIKE ? OR source_url LIKE ? OR parsed_content LIKE ?)';
        countParams.push(likeValue, likeValue, likeValue, likeValue);
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
      history.source_url = sanitizeSourceUrlValue(history.source_url, history.id);
      
      // 解析 parsed_fields 和 parsed_img_urls
      let parsedFields = null;
      let parsedImgUrls = null;
      
      if (history.parsed_fields) {
        try {
          parsedFields = typeof history.parsed_fields === 'string' 
            ? JSON.parse(history.parsed_fields) 
            : history.parsed_fields;

          // 为旧数据做兜底规范化，确保字段完整
          parsedFields = normalizeParsedFields({
            extractedFields: parsedFields,
            fallbackContent: parsedFields?.content || history.parsed_content || '',
            fallbackSummary: parsedFields?.summary || history.parsed_summary || '',
            articleUrl: history.source_url || '',
            createdAt: history.created_at || ''
          });
          
          // 提取图片URLs
          const imgValue = parsedFields.img_urls || parsedFields.images || parsedFields.image_urls;
          if (Array.isArray(imgValue) && imgValue.length > 0) {
            parsedImgUrls = imgValue;
          } else if (imgValue) {
            parsedImgUrls = [String(imgValue)];
          }
        } catch (e) {
          console.warn('解析 parsed_fields 失败:', e);
          parsedFields = normalizeParsedFields({
            extractedFields: history.parsed_fields,
            fallbackContent: history.parsed_content || '',
            fallbackSummary: history.parsed_summary || '',
            articleUrl: history.source_url || '',
            createdAt: history.created_at || ''
          });
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

      const existingHistory = await db.get('SELECT * FROM article_parse_history WHERE id = ?', [id]);
      if (!existingHistory) {
        return res.status(404).json({ success: false, error: '历史记录不存在' });
      }
      
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
        let fieldsToSave = parsed_fields;
        if (typeof parsed_fields === 'object' && parsed_fields !== null) {
          fieldsToSave = normalizeParsedFields({
            extractedFields: parsed_fields,
            fallbackContent:
              parsed_fields.content ||
              existingHistory.parsed_content ||
              '',
            fallbackSummary:
              parsed_fields.summary ||
              existingHistory.parsed_summary ||
              '',
            articleUrl: existingHistory.source_url || '',
            createdAt: existingHistory.created_at || ''
          });
        }
        updates.push('parsed_fields = ?');
        params.push(typeof fieldsToSave === 'object' ? JSON.stringify(fieldsToSave) : fieldsToSave || null);
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

  // AI 自动分配解析记录到笔记本
  router.post('/api/coze/parse-history/:id/ai-assign', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ success: false, error: '缺少解析记录ID' });
      }

      const history = await db.get('SELECT * FROM article_parse_history WHERE id = ? LIMIT 1', [id]);
      if (!history) {
        return res.status(404).json({ success: false, error: '解析记录不存在' });
      }
      if (history.assigned_notebook_id) {
        return res.status(400).json({ success: false, error: 'AI 已完成分配，无法重复执行' });
      }
      if (!history.parsed_fields && !history.parsed_content) {
        return res.status(400).json({ success: false, error: '解析内容为空，无法分配' });
      }

      const normalizedSourceUrl = sanitizeSourceUrlValue(history.source_url, history.id);
      let parsedFields = {};
      if (history.parsed_fields) {
        try {
          parsedFields =
            typeof history.parsed_fields === 'string'
              ? JSON.parse(history.parsed_fields)
              : history.parsed_fields || {};
        } catch (err) {
          console.warn('⚠️ 解析 parsed_fields JSON 失败，使用空对象:', err?.message || err);
          parsedFields = {};
        }
      }

      const normalizedFields = normalizeParsedFields({
        extractedFields: parsedFields,
        fallbackContent: history.parsed_content || '',
        fallbackSummary: history.parsed_summary || '',
        articleUrl: normalizedSourceUrl || ''
      });

      const aiTextPayload = [
        normalizedFields.title,
        normalizedFields.summary,
        normalizedFields.content
      ]
        .filter((text) => typeof text === 'string' && text.trim())
        .join('\n\n');

      if (!aiTextPayload || !aiTextPayload.trim()) {
        return res.status(400).json({ success: false, error: '解析记录缺少正文内容，无法AI分配' });
      }

      let suggestedNotebookId = null;
      let suggestedNotebookName = null;
      let createdNotebookId = null;
      try {
        const selection = await selectNotebookWithAI({ db, aiService, parsedFields: normalizedFields });
        suggestedNotebookId = selection?.notebookId || null;
        suggestedNotebookName = selection?.notebookName || null;
        createdNotebookId = selection?.created ? selection.notebookId : null;
      } catch (selectionError) {
        console.error('❌ AI 自动分配选择笔记本失败:', selectionError);
        return res.status(500).json({ success: false, error: 'AI 未能确定合适的笔记本' });
      }

      let assignmentResult = null;
      try {
        assignmentResult = await createNoteFromParsedResult({
          db,
          aiService,
          notebookId: suggestedNotebookId,
          parsedFields: normalizedFields,
          historyId: history.id,
          sourceUrl: normalizedSourceUrl,
          sourceType: normalizedSourceUrl ? 'link' : 'manual'
        });
      } catch (assignError) {
        console.error('❌ AI 自动分配写入笔记失败:', assignError);
        return res.status(500).json({
          success: false,
          error: assignError?.message || '写入笔记失败'
        });
      }

      if (!assignmentResult?.success) {
        return res.status(500).json({
          success: false,
          error: assignmentResult?.error || 'AI 分配失败'
        });
      }

      const now = new Date().toISOString();
      await db.run(
        `UPDATE article_parse_history 
         SET assigned_notebook_id = ?, assigned_notebook_name = ?, 
             suggested_notebook_id = ?, suggested_notebook_name = ?, 
             note_ids = ?, status = ?, updated_at = ?
         WHERE id = ?`,
        [
          assignmentResult.notebookId,
          assignmentResult.notebookName,
          assignmentResult.notebookId,
          assignmentResult.notebookName,
          JSON.stringify([assignmentResult.noteId]),
          'assigned',
          now,
          history.id
        ]
      );

      res.json({
        success: true,
        data: {
          historyId: history.id,
          noteId: assignmentResult.noteId,
          notebookId: assignmentResult.notebookId,
          notebookName: assignmentResult.notebookName,
          createdNotebookId,
          message: `已分配到笔记本：${assignmentResult.notebookName}`
        }
      });
    } catch (error) {
      console.error('❌ AI 自动分配解析历史失败:', error);
      res.status(500).json({ success: false, error: error.message || 'AI 分配失败' });
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
      const rawFields = {
        title: title || content.split('\n')[0].slice(0, 60) || '未命名笔记',
        content: content.trim(),
        summary: finalSummary || null,
        keywords: Array.isArray(keywords) ? keywords : (keywords ? [keywords] : []),
        ...(structuredFields || {})
      };
      const parsedFields = normalizeParsedFields({
        extractedFields: rawFields,
        fallbackContent: content.trim(),
        fallbackSummary: finalSummary || ''
      });
      const normalizedSourceUrl = sanitizeSourceUrlValue(
        rawFields.link || rawFields.source_url || '',
        historyId
      );

      // 保存到解析历史
      await db.run(
        `INSERT INTO article_parse_history 
         (id, source_url, parsed_content, parsed_title, parsed_summary, 
          status, parsed_fields, tags, created_at, parsed_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyId,
          normalizedSourceUrl,
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

      // 使用 AI 生成笔记草稿（用于标题/摘要优化，分配逻辑另行调用 AI）
      const notebooks = await fetchNotebooks(db);
      const aiResult = await aiService.generateNoteDraftsFromText(content, notebooks, {});

      const draft = aiResult.drafts && aiResult.drafts.length > 0 ? aiResult.drafts[0] : null;

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
      const rawParsedFields = {
        title: title || draft?.title || content.split('\n')[0].slice(0, 60) || '未命名笔记',
        content: content.trim(),
        summary: finalSummary || null,
        keywords: Array.isArray(keywords) ? keywords : 
                 (Array.isArray(draft?.topics) ? draft.topics : 
                 (keywords ? [keywords] : [])),
        ...(structuredFields || {})
      };
      const normalizedSourceUrl = sanitizeSourceUrlValue(
        rawParsedFields.link || rawParsedFields.source_url || '',
        historyId
      );

      // 统一字段规范化，便于兜底分类
      const parsedFields = normalizeParsedFields({
        extractedFields: rawParsedFields,
        fallbackContent: content.trim(),
        fallbackSummary: finalSummary || '',
        articleUrl: normalizedSourceUrl || ''
      });

      // AI 选择/创建合适的笔记本
      let suggestedNotebookId = null;
      let suggestedNotebookName = null;
      let notebookReason = null;
      try {
        const selection = await selectNotebookWithAI({ db, aiService, parsedFields });
        suggestedNotebookId = selection?.notebookId || null;
        suggestedNotebookName = selection?.notebookName || null;
        notebookReason = selection?.reason || null;
      } catch (selectionError) {
        console.error('❌ AI 选择笔记本失败:', selectionError);
        return res.status(500).json({ success: false, error: 'AI 未能确定合适的笔记本' });
      }

      // 保存到解析历史
      await db.run(
        `INSERT INTO article_parse_history 
         (id, source_url, parsed_content, parsed_title, parsed_summary, 
          suggested_notebook_id, suggested_notebook_name,
          status, parsed_fields, tags, created_at, parsed_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyId,
          normalizedSourceUrl,
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

      // 兜底：若仍未拿到笔记本，强制按分类创建/匹配
      if (!suggestedNotebookId) {
        try {
          const fallbackNotebook = await ensureNotebookForClassification(
            db,
            parsedFields.note_type ||
              parsedFields.noteType ||
              parsedFields.source_platform ||
              '通用笔记'
          );
          if (fallbackNotebook?.notebook_id) {
            suggestedNotebookId = fallbackNotebook.notebook_id;
            suggestedNotebookName = fallbackNotebook.name || parsedFields.note_type || null;
            await db.run(
              'UPDATE article_parse_history SET suggested_notebook_id = ?, suggested_notebook_name = ?, updated_at = ? WHERE id = ?',
              [suggestedNotebookId, suggestedNotebookName, new Date().toISOString(), historyId]
            );
          }
        } catch (fallbackError) {
          console.error('❌ 文本解析兜底匹配笔记本失败:', fallbackError);
        }
      }

      let assignmentResult = null;
      if (suggestedNotebookId) {
        try {
          assignmentResult = await createNoteFromParsedResult({
            db,
            aiService,
            notebookId: suggestedNotebookId,
            parsedFields,
            historyId,
            sourceUrl: normalizedSourceUrl,
            sourceType: 'manual'
          });
          if (assignmentResult?.success) {
            const noteIdsPayload = JSON.stringify([assignmentResult.noteId]);
            await db.run(
              'UPDATE article_parse_history SET note_ids = ?, assigned_notebook_id = ?, assigned_notebook_name = ?, status = ?, updated_at = ? WHERE id = ?',
              [
                noteIdsPayload,
                assignmentResult.notebookId,
                assignmentResult.notebookName || suggestedNotebookName || null,
                'assigned',
                new Date().toISOString(),
                historyId
              ]
            );
          }
        } catch (assignError) {
          console.error('❌ 文本解析写入笔记失败:', assignError);
          assignmentResult = { success: false, error: assignError?.message || '写入笔记失败' };
        }
      }

      const assigned = Boolean(assignmentResult?.success);
      const resolvedNotebookName =
        assignmentResult?.notebookName || suggestedNotebookName || null;
      const responseMessage = assigned
        ? `解析成功并已自动分配到笔记本：${resolvedNotebookName || '未知'}`
        : suggestedNotebookId
          ? `解析成功，但写入笔记失败：${assignmentResult?.error || '未知错误'}`
          : '解析成功，但未找到推荐的笔记本';

      res.json({
        success: true,
        data: {
          historyId,
          assigned,
          noteId: assignmentResult?.noteId || null,
          suggestedNotebookId,
          suggestedNotebookName: resolvedNotebookName,
          message: responseMessage,
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
      const { articleUrl, query, aiSummaryConfig } = req.body;
      
      if (!articleUrl || typeof articleUrl !== 'string' || !articleUrl.trim()) {
        return res.status(400).json({ 
          success: false, 
          error: '请提供有效的文章URL' 
        });
      }
      const cleanedArticleUrl = articleUrl.trim();

      // 复用解析文章的逻辑（仅 Workflow，不走 bot/chat）
      const COZE_WEBHOOK_URL = '';
      const COZE_ACCESS_TOKEN = (process.env.COZE_ACCESS_TOKEN || '').trim(); // workflow:run token
      const COZE_WORKFLOW_ID = (process.env.COZE_WORKFLOW_ID || '').trim();
      const COZE_APP_ID = (process.env.COZE_APP_ID || '').trim(); // 可选
      
      if (!COZE_ACCESS_TOKEN || !COZE_WORKFLOW_ID) {
        // 这是配置问题，不应该以 500 形式让前端误判为“服务崩了”
        return res.json({
          success: false,
          code: 'COZE_NOT_CONFIGURED',
          error: 'Coze Workflow 未配置：请设置 COZE_ACCESS_TOKEN 与 COZE_WORKFLOW_ID（需要 workflow:run 权限）'
        });
      }

      let parsedContent = '';
      let suggestedNotebookName = null;
      let historyId = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let chatId = null;
      let conversationId = null;
      let responseData = null;
      let parsedSummary = null;
      let parsedFields = {};
      const normalizedSourceUrl = sanitizeSourceUrlValue(cleanedArticleUrl, historyId);
      const hostname = (() => {
        try {
          return new URL(cleanedArticleUrl).hostname || '';
        } catch {
          return '';
        }
      })();
      const preferHtmlFallback =
        hostname.includes('longportapp.') || hostname.includes('longbridge.') || hostname.includes('longport');

      // 某些站点（例如 LongPort）Coze 偶发/持续 ECONNRESET，但网页 HTML 中已包含完整正文（JSON-LD / __NEXT_DATA__）。
      // 这类站点优先走 HTML 兜底解析，避免用户长时间卡在“解析中”。
      if (preferHtmlFallback) {
        const fallback = await tryFallbackParseByFetchingHtml(cleanedArticleUrl);
        if (fallback?.extractedFields?.content) {
          parsedContent = JSON.stringify(fallback.extractedFields);
          responseData = { code: 0, msg: '', data: fallback.extractedFields, fallback: fallback.meta };
          console.log('✅ 已使用 HTML 兜底解析（跳过 Coze）:', fallback.meta);
        }
      }
      
      // 仅使用 Coze Workflow
      if (COZE_ACCESS_TOKEN && COZE_WORKFLOW_ID && !parsedContent) {
        const extractCozeAnswer = (data) => {
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

        const callCozeWorkflowOnce = async () => {
          const cozeApiUrl = `https://api.coze.cn/v1/workflow/run`;
          const parameters = { input: cleanedArticleUrl };
          if (query) parameters.query = query;

          const apiPayload = {
            workflow_id: COZE_WORKFLOW_ID,
            parameters,
            is_async: false
          };
          if (COZE_APP_ID) apiPayload.app_id = COZE_APP_ID;

          console.log(`🔄 调用 Coze Workflow: ${cozeApiUrl}`);
          console.log(`📦 Workflow ID: ${COZE_WORKFLOW_ID}`);
          console.log(`🔑 使用 ACCESS_TOKEN 前缀: ${COZE_ACCESS_TOKEN.substring(0, 10)}...`);

          const startedAt = Date.now();
          const apiResponse = await axios.post(cozeApiUrl, apiPayload, {
            headers: {
              Authorization: `Bearer ${COZE_ACCESS_TOKEN}`,
              'Content-Type': 'application/json'
            },
            responseType: 'json',
            timeout: 300000,
            proxy: false,
            httpsAgent: createCozeHttpsAgent(),
            validateStatus: (status) => status < 500
          });

          const statusCode = apiResponse.status;
          const contentType = apiResponse.headers['content-type'] || '';
          const logId =
            apiResponse.headers?.['x-tt-logid'] ||
            apiResponse.headers?.['x-tt-logid'.toLowerCase()] ||
            apiResponse.headers?.['x-tt-logid'.toUpperCase()];
          console.log(`📊 Workflow 响应状态码: ${statusCode}（${Date.now() - startedAt}ms）`);
          console.log(`📄 响应 Content-Type: ${contentType}`);
          if (logId) console.log(`🧾 X-Tt-Logid: ${logId}`);
          
          if (statusCode === 401 || statusCode === 403 || apiResponse.data?.code === 4100) {
            throw new Error(`Coze Workflow 鉴权失败 (${statusCode}): 请检查 COZE_ACCESS_TOKEN 是否有效、是否有 workflow:run 权限，且与 workflow 同一空间`);
          }

          const data = apiResponse.data;
          if (contentType.includes('text/html') || looksLikeHtml(data?.toString?.() || '')) {
            const preview = typeof data === 'string' ? data.substring(0, 500) : '';
            console.error(`❌ Coze Workflow 返回了 HTML 页面 (状态码: ${statusCode}):`, preview);
            throw new Error(`Coze Workflow 返回了 HTML 登录页 (状态码: ${statusCode})，说明请求未授权或参数错误。`);
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
        };

        const maxAttempts = preferHtmlFallback ? 1 : 4;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const attemptStartedAt = Date.now();
          try {
            const result = await callCozeWorkflowOnce();
            parsedContent = result.answer || parsedContent;
            responseData = result.responseData;
            chatId = result.chatId || chatId;
            conversationId = result.conversationId || conversationId;
            break;
          } catch (apiError) {
            console.error(`❌ Coze API调用失败(第${attempt + 1}次):`, apiError.message, apiError?.code || '');
            console.error(`⏱️ 本次失败耗时: ${Date.now() - attemptStartedAt}ms`);
            if (isAbortError(apiError)) {
              const backoff = Math.min(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 200), 6000);
              if (attempt < maxAttempts - 1) {
                await sleep(backoff);
                continue;
              }

              // 最终失败：尝试用“抓取网页 HTML”做兜底解析（例如 LongPort 某些链接 Coze 会持续 ECONNRESET）
              const fallback = await tryFallbackParseByFetchingHtml(cleanedArticleUrl);
              if (fallback?.extractedFields?.content) {
                parsedContent = JSON.stringify(fallback.extractedFields);
                responseData = {
                  code: 0,
                  msg: '',
                  data: fallback.extractedFields,
                  fallback: fallback.meta,
                  coze_error: buildCozeFailurePayload(apiError, {
                    workflowId: COZE_WORKFLOW_ID,
                    attempt: attempt + 1
                  })
                };
                console.warn('⚠️ Coze 失败，已启用 HTML 兜底解析:', fallback.meta);
                break;
              }

              // 兜底也失败：落库一条失败记录，便于排查
              try {
                const now = new Date().toISOString();
                await db.run(
                  `INSERT INTO article_parse_history
                   (id, source_url, status, parse_query, coze_response_data, created_at, parsed_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    historyId,
                    normalizedSourceUrl || cleanedArticleUrl,
                    'failed',
                    query || null,
                    buildCozeFailurePayload(apiError, { workflowId: COZE_WORKFLOW_ID, attempt: attempt + 1 }),
                    now,
                    now,
                    now
                  ]
                );
              } catch (persistErr) {
                console.warn('⚠️ 保存 Coze 失败记录到解析历史失败（已忽略）:', persistErr?.message || persistErr);
              }

              return res.status(504).json({
                success: false,
                historyId,
                error: 'Coze 请求超时或被中断（ECONNRESET/socket hang up），请稍后重试'
              });
            }
            if (apiError.response) {
              console.error('响应状态码:', apiError.response.status);
              console.error('响应头:', apiError.response.headers);
            }
            throw apiError;
          }
        }

        if (!parsedContent) {
          parsedContent = '对话仍在处理中，请稍后查看解析历史。';
        }
      }

      // 确定状态
      let historyStatus = 'completed';
      if (!parsedContent || !parsedContent.trim()) {
        historyStatus = 'failed';
      } else if (parsedContent.includes('处理超时') || parsedContent.includes('处理中')) {
        historyStatus = 'processing';
      }

      // 生成 AI 摘要（可选）
      if (aiSummaryConfig?.enabled && aiSummaryConfig?.prompt) {
        try {
          const summaryPrompt = `${aiSummaryConfig.prompt}\n\n内容：${parsedContent}`;
          parsedSummary = await aiService.generateText(summaryPrompt, {
            temperature: 0.7,
            maxTokens: 500
          });
        } catch (summaryError) {
          console.warn('⚠️ 链接解析生成AI摘要失败，忽略摘要:', summaryError?.message || summaryError);
        }
      }

      // 如果不是 JSON，则先清洗掉工具调用/客套话
      let parsedContentForExtraction = parsedContent;
      let cleanedParsedContent = parsedContent;
      if (typeof parsedContent === 'string') {
        const trimmed = parsedContent.trim();
        const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        cleanedParsedContent = looksJson ? parsedContent : cleanParsedContentText(parsedContent);
        parsedContentForExtraction = cleanedParsedContent;
        parsedContent = parsedContentForExtraction;
      }

      // 若仅返回工具调用而无正文，直接判定为失败
      if (isToolCallOnlyPayload(parsedContentForExtraction)) {
        const errorMsg = '解析失败：Coze 仅返回了工具调用结果，未获取到文章正文，请检查 workflow/工具配置或重试。';
        console.error('❌', errorMsg, '内容预览:', parsedContentForExtraction.slice(0, 200));
        return res.status(502).json({ success: false, error: errorMsg });
      }

      // 尝试从 parsedContent 中提取结构化字段（如果 Coze 返回的是 JSON 格式）
      let extractedFields = {};
      const tryParseFields = (value) => {
        if (!value) return null;
        try {
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
            const obj = JSON.parse(trimmed);
            return obj && typeof obj === 'object' ? obj : null;
          }
          if (typeof value === 'object') return value;
        } catch (e) {
          return null;
        }
        return null;
      };
      const cozeParsedFields = tryParseFields(responseData?.parsed_fields);
      if (cozeParsedFields) {
        extractedFields = Array.isArray(cozeParsedFields) ? cozeParsedFields[0] : cozeParsedFields;
        console.log('🔍 使用 Coze 返回的 parsed_fields');
      }
      if (parsedContent && typeof parsedContent === 'string' && parsedContent.trim()) {
        const trimmedContent = parsedContentForExtraction.trim();
        
        // 尝试解析为 JSON
        try {
          // 检查是否是 JSON 格式（以 { 或 [ 开头），且尚未有提取结果
          if (!Object.keys(extractedFields).length && (trimmedContent.startsWith('{') || trimmedContent.startsWith('['))) {
            const parsedJson = JSON.parse(trimmedContent);
            
            if (typeof parsedJson === 'object' && parsedJson !== null) {
              console.log('🔍 检测到 Coze 返回了 JSON 格式，尝试提取结构化字段');
              console.log('  - JSON 键:', Object.keys(parsedJson));
              
              // 如果解析的是数组，取第一个元素
              const dataObj = Array.isArray(parsedJson) ? parsedJson[0] : parsedJson;
              
              if (dataObj && typeof dataObj === 'object') {
                // 提取各个字段（支持多种可能的字段名）
                if (dataObj.title && typeof dataObj.title === 'string') {
                  extractedFields.title = dataObj.title.trim();
                  console.log('  ✅ 提取到 title:', extractedFields.title);
                }
                
                if (dataObj.author && typeof dataObj.author === 'string') {
                  extractedFields.author = dataObj.author.trim();
                  console.log('  ✅ 提取到 author:', extractedFields.author);
                }
                
                if (dataObj.source_platform || dataObj.platform) {
                  extractedFields.source_platform = (dataObj.source_platform || dataObj.platform).trim();
                  console.log('  ✅ 提取到 source_platform:', extractedFields.source_platform);
                }
                
                if (dataObj.note_type || dataObj.noteType) {
                  extractedFields.note_type = (dataObj.note_type || dataObj.noteType).trim();
                  console.log('  ✅ 提取到 note_type:', extractedFields.note_type);
                }
                
                if (dataObj.published_at || dataObj.publishedAt || dataObj.publish_time) {
                  extractedFields.published_at = (dataObj.published_at || dataObj.publishedAt || dataObj.publish_time).trim();
                  console.log('  ✅ 提取到 published_at:', extractedFields.published_at);
                }
                
                // 图片 URLs（可能是数组或字符串）
                if (dataObj.img_urls || dataObj.image_urls || dataObj.images) {
                  const imgUrls = dataObj.img_urls || dataObj.image_urls || dataObj.images;
                  if (Array.isArray(imgUrls) && imgUrls.length > 0) {
                    extractedFields.img_urls = imgUrls.filter(url => url && typeof url === 'string' && url.trim());
                    console.log('  ✅ 提取到 img_urls:', extractedFields.img_urls.length, '个');
                  } else if (typeof imgUrls === 'string' && imgUrls.trim()) {
                    extractedFields.img_urls = [imgUrls.trim()];
                    console.log('  ✅ 提取到 img_urls (单个):', extractedFields.img_urls[0]);
                  }
                }
                
                // 关键词（可能是数组或字符串）
                if (dataObj.keywords || dataObj.tags) {
                  const keywords = dataObj.keywords || dataObj.tags;
                  if (Array.isArray(keywords) && keywords.length > 0) {
                    extractedFields.keywords = keywords.filter(k => k && typeof k === 'string' && k.trim());
                    console.log('  ✅ 提取到 keywords:', extractedFields.keywords.length, '个');
                  } else if (typeof keywords === 'string' && keywords.trim()) {
                    // 如果是逗号分隔的字符串，分割成数组
                    extractedFields.keywords = keywords.split(',').map(k => k.trim()).filter(Boolean);
                    console.log('  ✅ 提取到 keywords (字符串):', extractedFields.keywords.length, '个');
                  }
                }
                
                // 内容字段（如果 JSON 中有单独的内容字段，使用它；否则使用整个 JSON 的字符串表示）
                if (dataObj.content && typeof dataObj.content === 'string' && dataObj.content.trim()) {
                  extractedFields.content = dataObj.content.trim();
                  console.log('  ✅ 提取到 content，长度:', extractedFields.content.length);
                } else if (dataObj.body && typeof dataObj.body === 'string' && dataObj.body.trim()) {
                  extractedFields.content = dataObj.body.trim();
                  console.log('  ✅ 提取到 body 作为 content，长度:', extractedFields.content.length);
                } else if (dataObj.text && typeof dataObj.text === 'string' && dataObj.text.trim()) {
                  extractedFields.content = dataObj.text.trim();
                  console.log('  ✅ 提取到 text 作为 content，长度:', extractedFields.content.length);
                }
                
                // 摘要字段
                if (dataObj.summary && typeof dataObj.summary === 'string') {
                  extractedFields.summary = dataObj.summary.trim();
                  console.log('  ✅ 提取到 summary:', extractedFields.summary.substring(0, 50));
                }
                
                // 链接字段
                if (dataObj.link || dataObj.url || dataObj.source_url) {
                  extractedFields.link = (dataObj.link || dataObj.url || dataObj.source_url).trim();
                  console.log('  ✅ 提取到 link:', extractedFields.link);
                }
              }
            }
          }
        } catch (jsonError) {
          // 不是 JSON 格式，继续使用原始内容
          console.log('ℹ️ parsedContent 不是 JSON 格式，使用原始文本内容');
        }
      }
      
      // 标准化字段：无论 Coze 返回 JSON 还是纯文本，都输出完整键集
    const normalizedParsedFields = normalizeParsedFields({
      extractedFields,
      fallbackContent: parsedContentForExtraction || '',
      fallbackSummary: parsedSummary || '',
      articleUrl: articleUrl || ''
    });
      
      console.log('📦 最终 parsedFields 键:', Object.keys(normalizedParsedFields));
      const finalParsedSummary = sanitizeSummary(parsedSummary || normalizedParsedFields.summary || '');
      const finalParsedTitle = normalizedParsedFields.title || null;
      const finalParsedAuthor = normalizedParsedFields.author || null;
      const finalParsedPublishedAt = normalizedParsedFields.published_at || null;
      const finalParsedPlatform = normalizedParsedFields.source_platform || null;
      const tagsValue =
        Array.isArray(normalizedParsedFields.keywords) && normalizedParsedFields.keywords.length > 0
          ? JSON.stringify(normalizedParsedFields.keywords)
          : null;
      parsedFields = normalizedParsedFields;

      // AI 选择/创建合适的笔记本
      let suggestedNotebookId = null;
      try {
        const selection = await selectNotebookWithAI({ db, aiService, parsedFields });
        suggestedNotebookId = selection?.notebookId || null;
        suggestedNotebookName = selection?.notebookName || suggestedNotebookName || null;
      } catch (selectionError) {
        console.error('❌ 链接解析 AI 选择笔记本失败:', selectionError);
        return res.status(500).json({ success: false, error: 'AI 未能确定合适的笔记本' });
      }

      // 保存解析历史并自动分配
      const responseDataWithIds = {
        ...(responseData || {}),
        chat_id: chatId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString()
      };
      
      const now = new Date().toISOString();
      if (!parsedFields.note_created_at) {
        parsedFields.note_created_at = formatToPublishedStyle(now);
      }
      const contentToSave =
        (parsedFields.content && parsedFields.content.trim()) ||
        (parsedContentForExtraction && parsedContentForExtraction.trim()) ||
        '解析中或解析失败，请稍后查看结果';
      let historySaved = false;
      
      try {
        // 计算5分钟前的时间戳
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const existingHistory = await db.get(
          'SELECT id FROM article_parse_history WHERE source_url = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1',
          [articleUrl.trim(), fiveMinutesAgo]
        );
        
        if (existingHistory) {
          historyId = existingHistory.id;
          await db.run(
            `UPDATE article_parse_history SET 
             parsed_content = ?, parsed_title = ?, parsed_summary = ?, parsed_author = ?, parsed_published_at = ?, parsed_platform = ?, 
             parsed_fields = ?, tags = ?, suggested_notebook_id = ?, suggested_notebook_name = ?, 
             assigned_notebook_id = ?, assigned_notebook_name = ?,
             status = ?, coze_response_data = ?, updated_at = ?, parsed_at = ?
             WHERE id = ?`,
            [
              contentToSave,
              finalParsedTitle,
              finalParsedSummary,
              finalParsedAuthor,
              finalParsedPublishedAt,
              finalParsedPlatform,
              Object.keys(parsedFields).length ? JSON.stringify(parsedFields) : null,
              tagsValue,
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
          historySaved = true;
        } else {
          const insertValues = [
            historyId,
            cleanedArticleUrl,
            contentToSave,
            finalParsedTitle,
            finalParsedSummary,
            finalParsedAuthor,
            finalParsedPublishedAt,
            finalParsedPlatform,
            Object.keys(parsedFields).length ? JSON.stringify(parsedFields) : null,
            tagsValue,
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
          ];
          if (insertValues.length !== 20) {
            console.error('[parse-and-assign] values length mismatch, padding to 20', {
              length: insertValues.length,
              values: insertValues
            });
            while (insertValues.length < 20) {
              insertValues.push(null);
            }
            if (insertValues.length > 20) {
              insertValues.length = 20;
            }
          }
          console.info('[parse-and-assign] insert values count', insertValues.length);
          console.info('[parse-and-assign] tagsValue', tagsValue, 'suggestedNotebookId', suggestedNotebookId, 'suggestedNotebookName', suggestedNotebookName);
          await db.run(
            `INSERT INTO article_parse_history 
             (id, source_url, parsed_content, parsed_title, parsed_summary, parsed_author, parsed_published_at, parsed_platform, 
              parsed_fields, tags, suggested_notebook_id, suggested_notebook_name, 
              assigned_notebook_id, assigned_notebook_name,
              status, parse_query, coze_response_data, created_at, parsed_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            insertValues
          );
          historySaved = true;
        }
      } catch (historyError) {
        console.error('❌ 保存解析历史失败:', historyError);
        return res.status(500).json({ success: false, error: '保存解析历史失败', details: historyError?.message });
      }

      if (!historySaved) {
        return res.status(500).json({ success: false, error: '解析历史未保存成功' });
      }

      let assignmentResult = null;
      if (suggestedNotebookId) {
        try {
          assignmentResult = await createNoteFromParsedResult({
            db,
            aiService,
            notebookId: suggestedNotebookId,
            parsedFields,
            historyId,
            sourceUrl: cleanedArticleUrl,
            sourceType: 'link'
          });
          if (assignmentResult?.success) {
            const noteIdsPayload = JSON.stringify([assignmentResult.noteId]);
            await db.run(
              'UPDATE article_parse_history SET note_ids = ?, assigned_notebook_id = ?, assigned_notebook_name = ?, status = ?, updated_at = ? WHERE id = ?',
              [
                noteIdsPayload,
                assignmentResult.notebookId,
                assignmentResult.notebookName || suggestedNotebookName || null,
                'assigned',
                new Date().toISOString(),
                historyId
              ]
            );
          }
        } catch (assignError) {
          console.error('❌ 链接解析写入笔记失败:', assignError);
          assignmentResult = { success: false, error: assignError?.message || '写入笔记失败' };
        }
      }

      const assigned = Boolean(assignmentResult?.success);
      const resolvedNotebookName =
        assignmentResult?.notebookName || suggestedNotebookName || null;
      const responseMessage = assigned
        ? `解析成功并已自动分配到笔记本：${resolvedNotebookName || '未知'}`
        : suggestedNotebookId
          ? `解析成功，但写入笔记失败：${assignmentResult?.error || '未知错误'}`
          : '解析成功，但未找到推荐的笔记本';

      res.json({
        success: true,
        data: {
          historyId,
          assigned,
          noteId: assignmentResult?.noteId || null,
          suggestedNotebookId: assignmentResult?.notebookId || suggestedNotebookId,
          suggestedNotebookName: resolvedNotebookName,
          message: responseMessage,
          parsedSummary: finalParsedSummary,
          parsedFields,
          sourceUrl: normalizedSourceUrl
        }
      });
    } catch (error) {
      console.error('❌ 解析并分配失败:', error?.message || error, error?.code || '');
      if (isAbortError(error)) {
        return res.status(504).json({
          success: false,
          error: 'Coze 请求超时或被中断，请稍后重试'
        });
      }
      res.status(500).json({ 
        success: false, 
        error: error.response?.data?.error || error.message || '解析并分配失败' 
      });
    }
  });

  return router;
}
