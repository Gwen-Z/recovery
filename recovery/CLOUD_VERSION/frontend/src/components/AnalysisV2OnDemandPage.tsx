import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import apiClient, { type Notebook, type Note } from '../apiClient';
import type { AnalysisV3ChartItem, AnalysisV3Insight, AnalysisV3Preset, AnalysisV3Response } from '../types/Analysis';

const PRESET_OPTIONS: Array<{ value: AnalysisV3Preset; label: string }> = [
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
  { value: '90d', label: '近90天' },
  { value: 'custom', label: '自定义' }
];

const CHART_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif';
const CHART_TICK_COLOR = '#3D3A3A';
const CHART_AXIS_LINE = '#CCCCCC';
const CHART_GRID_COLOR = '#EAE9E9';
const CHART_BASE_COLOR = '#06c3a8';
const CHART_LINE_PALETTE = [CHART_BASE_COLOR];
const CHART_BAR_PALETTE = [CHART_BASE_COLOR];
const CHART_HEATMAP_COLOR = '#06c3a8';

const chartAxisTick = { fill: CHART_TICK_COLOR, fontSize: 12, fontFamily: CHART_FONT_FAMILY };
const chartTooltipStyle = {
  backgroundColor: '#fff',
  border: `1px solid ${CHART_GRID_COLOR}`,
  borderRadius: '6px',
  padding: '8px 10px',
  boxShadow: '0 6px 14px rgba(0,0,0,0.08)',
  fontFamily: CHART_FONT_FAMILY
};

const getPieSliceColor = (index: number, total: number) => {
  const safeTotal = Math.max(total, 1);
  const ratio = safeTotal === 1 ? 0 : index / (safeTotal - 1);
  const alpha = 0.9 - ratio * 0.6;
  return `rgba(6, 195, 168, ${Math.max(0.25, alpha).toFixed(2)})`;
};


const ANALYSIS_HISTORY_STORAGE_KEY = 'analysisV2.history.v1';
const ANALYSIS_HISTORY_MAX_SESSIONS = 30;
const ANALYSIS_HISTORY_FALLBACK_SESSIONS = 10;
const ANALYSIS_HISTORY_FALLBACK_MAX_ROWS = 200;

const toDateInputValue = (date: Date) => {
  // 用本地时区格式化，避免 toISOString()（UTC）导致日期偏移一天
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getRequestNoteIds = (request?: { noteIds?: string[] }) =>
  Array.isArray(request?.noteIds) ? request.noteIds : [];

const getErrorMessage = (error: unknown, fallback: string) => {
  if (!error) return fallback;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = (error as any).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};

const resolvePresetRange = (preset: AnalysisV3Preset) => {
  const now = new Date();
  if (preset === 'custom') {
    return { from: null, to: null };
  }
  const days = preset === '90d' ? 90 : preset === '30d' ? 30 : 7;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to: now };
};

const resolvePresetDays = (preset: AnalysisV3Preset) => {
  if (preset === '90d') return 90;
  if (preset === '30d') return 30;
  if (preset === '7d') return 7;
  return null;
};

const getPresetLabel = (preset: AnalysisV3Preset) => {
  if (preset === 'custom') return '选定时间段';
  if (preset === '30d') return '过去30天';
  if (preset === '90d') return '过去90天';
  return '过去7天';
};

type AnalysisHistoryRecord = {
  id: string;
  notebookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  request: {
    preset: AnalysisV3Preset;
    from?: string;
    to?: string;
    noteIds?: string[];
  };
  selectedChartKey?: string | null;
  result: AnalysisV3Response;
};

const generateHistoryId = () => {
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : null;
  if (cryptoObj && typeof (cryptoObj as any).randomUUID === 'function') {
    return (cryptoObj as any).randomUUID();
  }
  return `ana_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const clampText = (value: string, max: number) => {
  const text = String(value || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
};

const safeParseArray = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const parseDateValue = (value: unknown) => {
  const toDateFromNumber = (num: number) => {
    if (!Number.isFinite(num)) return null;
    const ms = num < 1e12 ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    return toDateFromNumber(value);
  }
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && text.length >= 10) {
    const date = toDateFromNumber(numeric);
    if (date) return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeDateRange = (from: Date | null, to: Date | null) => {
  if (!from || !to) return null;
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() > end.getTime()) {
    return { from: toDateInputValue(end), to: toDateInputValue(start) };
  }
  return { from: toDateInputValue(start), to: toDateInputValue(end) };
};

const formatDateBucket = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekStart = (date: Date) => {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const getMonthStart = (date: Date) => {
  const copy = new Date(date);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const resolveHeatmapPolicy = (totalCount: number) => {
  if (totalCount <= 1) {
    return { granularity: 'day', topN: null as number | null, tickStride: 1, sampleHint: '样本较少，趋势参考性有限。' };
  }
  if (totalCount <= 10) {
    return { granularity: 'day', topN: null as number | null, tickStride: 1, sampleHint: null as string | null };
  }
  if (totalCount <= 50) {
    return { granularity: 'day', topN: 8, tickStride: 1, sampleHint: null as string | null };
  }
  if (totalCount <= 200) {
    return { granularity: 'week', topN: 6, tickStride: 2, sampleHint: null as string | null };
  }
  return { granularity: 'month', topN: 5, tickStride: 3, sampleHint: null as string | null };
};

const compactAnalysisResultForStorage = (result: AnalysisV3Response, maxRowsPerChart?: number): AnalysisV3Response => {
  const chartItems = Array.isArray(result?.charts?.items) ? result.charts.items : [];
  const compactedItems = chartItems.map((item) => {
    const rows = Array.isArray(item?.data?.rows) ? item.data.rows : [];
    const compactRows =
      typeof maxRowsPerChart === 'number' && maxRowsPerChart > 0 ? rows.slice(-maxRowsPerChart) : rows;
    return {
      ...item,
      data: {
        ...item.data,
        rows: compactRows
      }
    };
  });

  return {
    analysisId: String(result?.analysisId || ''),
    meta: result?.meta || { recordCount: 0, startAt: null, endAt: null },
    notebookType: result?.notebookType,
    noteType: result?.noteType,
    insights: Array.isArray(result?.insights) ? result.insights : [],
    insightsByChartKey: result?.insightsByChartKey,
    charts: {
      defaultKey: String(result?.charts?.defaultKey || ''),
      items: compactedItems
    },
    cache: result?.cache
  };
};

const normalizeAnalysisHistoryRecord = (raw: any): AnalysisHistoryRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as any;
  const notebookId = String(record.notebookId || '');
  const id = String(record.id || '');
  const title = clampText(String(record.title || ''), 80) || '未命名分析';
  const createdAt = Number(record.createdAt || Date.now());
  const updatedAt = Number(record.updatedAt || createdAt || Date.now());
  const request = record.request && typeof record.request === 'object' ? record.request : {};
  const preset: AnalysisV3Preset =
    request.preset === '30d' || request.preset === '90d' || request.preset === 'custom' ? request.preset : '7d';
  const from = typeof request.from === 'string' ? request.from : undefined;
  const to = typeof request.to === 'string' ? request.to : undefined;
  const noteIds = Array.isArray(request.noteIds) ? request.noteIds.map((id: any) => String(id)) : undefined;
  const selectedChartKey =
    record.selectedChartKey === null || typeof record.selectedChartKey === 'string'
      ? record.selectedChartKey
      : null;
  const result = record.result && typeof record.result === 'object' ? (record.result as AnalysisV3Response) : null;
  if (!id || !notebookId || !result?.analysisId) return null;
  return {
    id,
    notebookId,
    title,
    createdAt,
    updatedAt,
    request: { preset, from, to, noteIds },
    selectedChartKey,
    result
  };
};

const resolveHistoryRange = (record: AnalysisHistoryRecord) => {
  const preset = record.request?.preset || '7d';
  if (record.request?.from && record.request?.to) {
    const fromDate = parseDateValue(record.request.from);
    const toDate = parseDateValue(record.request.to);
    const normalized = normalizeDateRange(fromDate, toDate);
    if (normalized) return normalized;
  }

  const metaStart = parseDateValue(record.result?.meta?.startAt);
  const metaEnd = parseDateValue(record.result?.meta?.endAt);
  const normalizedMeta = normalizeDateRange(metaStart, metaEnd);
  if (normalizedMeta) return normalizedMeta;

  const days = resolvePresetDays(preset);
  if (!days) return null;
  const anchor = parseDateValue(record.result?.meta?.endAt || record.updatedAt || record.createdAt);
  if (!anchor) return null;
  const end = new Date(anchor);
  const start = new Date(anchor);
  start.setDate(start.getDate() - Math.max(days - 1, 0));
  return normalizeDateRange(start, end);
};

const normalizeNoteIds = (ids: string[]) =>
  Array.from(new Set(ids.map((id) => String(id)))).sort().join('|');

const loadAnalysisHistory = (): AnalysisHistoryRecord[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(ANALYSIS_HISTORY_STORAGE_KEY);
  const parsed = safeParseArray(raw);
  if (!parsed) return [];
  return parsed
    .map((item) => normalizeAnalysisHistoryRecord(item))
    .filter((item): item is AnalysisHistoryRecord => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, ANALYSIS_HISTORY_MAX_SESSIONS);
};

const saveAnalysisHistory = (history: AnalysisHistoryRecord[]) => {
  if (typeof window === 'undefined') return;
  const normalized = (history || [])
    .filter((item) => item && typeof item === 'object')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, ANALYSIS_HISTORY_MAX_SESSIONS);
  try {
    window.localStorage.setItem(ANALYSIS_HISTORY_STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    try {
      const compact = normalized.slice(0, ANALYSIS_HISTORY_FALLBACK_SESSIONS).map((item) => ({
        ...item,
        result: compactAnalysisResultForStorage(item.result, ANALYSIS_HISTORY_FALLBACK_MAX_ROWS)
      }));
      window.localStorage.setItem(ANALYSIS_HISTORY_STORAGE_KEY, JSON.stringify(compact));
    } catch {
      console.warn('[analysis-v2] 保存分析历史失败:', error);
    }
  }
};

type ChartMeta = {
  label: (preset: AnalysisV3Preset) => string;
  question: (preset: AnalysisV3Preset) => string;
  axis: (preset: AnalysisV3Preset) => { x: string; y: string };
  isCount: boolean;
};

const CHART_META: Record<string, ChartMeta> = {
  trend: {
    label: (preset) => `${getPresetLabel(preset)}趋势`,
    question: (preset) => `${getPresetLabel(preset)}如何变化？`,
    axis: () => ({ x: '日期', y: '笔记数' }),
    isCount: true
  },
  weekday: {
    label: () => '星期分布',
    question: () => '一周内哪些天记录最多？',
    axis: () => ({ x: '星期', y: '笔记数' }),
    isCount: true
  },
  length: {
    label: () => '长度分布',
    question: () => '笔记长度分布如何？',
    axis: () => ({ x: '长度', y: '笔记数' }),
    isCount: true
  },
  mood_event: {
    label: () => '事件类型占比',
    question: () => '情绪事件类型占比如何？',
    axis: () => ({ x: '事件类型', y: '笔记数' }),
    isCount: true
  },
  topic_heatmap: {
    label: () => '主题热度热力图',
    question: (preset) => (preset === '7d' ? '过去7天各主题热度如何？' : '近期各主题热度如何变化？'),
    axis: (preset) => ({ x: preset === '7d' ? '日期' : '周', y: '主题' }),
    isCount: true
  },
  topic_distribution: {
    label: () => '主题占比',
    question: () => '我最近主要关注哪些主题？',
    axis: () => ({ x: '主题', y: '笔记数' }),
    isCount: true
  },
  entity_topn: {
    label: () => '关注Top',
    question: () => '我最近最常关注哪些标的/主体？',
    axis: () => ({ x: '标的/主体', y: '笔记数' }),
    isCount: true
  }
};

const getChartQuestion = (chart: AnalysisV3ChartItem, preset: AnalysisV3Preset) => {
  const meta = CHART_META[chart.key];
  if (meta) return meta.question(preset);
  return chart.question || '该图回答的问题';
};

const getChartLabel = (chart: AnalysisV3ChartItem, preset: AnalysisV3Preset) => {
  const meta = CHART_META[chart.key];
  if (meta) return meta.label(preset);
  return chart.question || chart.key;
};

const deriveChartKeys = (chart: AnalysisV3ChartItem) => {
  const rows = chart.data?.rows || [];
  const fallbackKeys = rows.length > 0 ? Object.keys(rows[0]) : [];
  const xKey = chart.data?.xKey || chart.data?.categoryKey || fallbackKeys[0] || 'x';
  const yKey = chart.data?.yKey || chart.data?.valueKey || fallbackKeys[1] || 'y';
  const categoryKey = chart.data?.categoryKey || xKey;
  const valueKey = chart.data?.valueKey || yKey;
  return { rows, xKey, yKey, categoryKey, valueKey };
};

const isCountChart = (chart: AnalysisV3ChartItem, yKey: string, valueKey: string) => {
  if (yKey === 'count' || valueKey === 'count') return true;
  return Boolean(CHART_META[chart.key]?.isCount);
};

const mapFieldToZh = (field: string, chart?: AnalysisV3ChartItem) => {
  const key = String(field || '').trim();
  if (!key) return '—';

  if (key === 'count' || key.toLowerCase() === 'count') return '笔记数';
  if (key === 'date') return '日期';
  if (key === 'weekday') return '星期';
  if (key === 'bucket') return '长度';
  if (key === 'eventType') return '事件类型';
  if (key === 'topic') return '主题';
  if (key === 'entity') return '标的/主体';
  if (key === 'timeBucket') return '时间';

  if (chart?.key === 'trend') {
    if (key === 'x' || key === (chart.data?.xKey || '')) return '日期';
    if (key === 'y' || key === (chart.data?.yKey || '')) return '笔记数';
  }

  return key;
};

const getAxisLabels = (chart: AnalysisV3ChartItem, preset: AnalysisV3Preset) => {
  const meta = CHART_META[chart.key];
  if (meta) return meta.axis(preset);
  const { xKey, yKey } = deriveChartKeys(chart);
  return { x: mapFieldToZh(xKey, chart), y: mapFieldToZh(yKey, chart) };
};

const getChartMappingSegments = (chart: AnalysisV3ChartItem, preset: AnalysisV3Preset) => {
  const { xKey, yKey, categoryKey, valueKey } = deriveChartKeys(chart);
  if (chart.type === 'pie') {
    return [
      `颜色：${mapFieldToZh(categoryKey, chart)}`,
      `数值：${mapFieldToZh(valueKey, chart)}`
    ];
  }
  if (chart.type === 'heatmap') {
    return [
      `X轴：${mapFieldToZh(xKey, chart)}`,
      `Y轴：${mapFieldToZh(yKey, chart)}`,
      `强度：${mapFieldToZh(valueKey, chart)}`
    ];
  }
  if (chart.type === 'bar') {
    return [
      `X轴：${mapFieldToZh(categoryKey, chart)}`,
      `Y轴：${mapFieldToZh(valueKey, chart)}`
    ];
  }
  return [
    `X轴：${mapFieldToZh(xKey, chart)}`,
    `Y轴：${mapFieldToZh(yKey, chart)}`
  ];
};

const highlightSegments = (text: string) => {
  const raw = String(text || '');
  if (!raw) return [];
  const patterns = [
    { open: '「', close: '」' },
    { open: '“', close: '”' },
    { open: '【', close: '】' }
  ];

  let nodes: Array<{ text: string; highlight: boolean }> = [{ text: raw, highlight: false }];

  const applyPattern = (open: string, close: string) => {
    const next: Array<{ text: string; highlight: boolean }> = [];
    nodes.forEach((node) => {
      if (node.highlight) return next.push(node);
      let remaining = node.text;
      while (remaining) {
        const start = remaining.indexOf(open);
        const end = start >= 0 ? remaining.indexOf(close, start + open.length) : -1;
        if (start < 0 || end < 0) {
          next.push({ text: remaining, highlight: false });
          break;
        }
        const before = remaining.slice(0, start);
        const inside = remaining.slice(start + open.length, end);
        if (before) next.push({ text: before, highlight: false });
        if (inside) next.push({ text: inside, highlight: true });
        remaining = remaining.slice(end + close.length);
      }
    });
    nodes = next;
  };

  patterns.forEach((p) => applyPattern(p.open, p.close));
  return nodes;
};

const renderHighlightedText = (text: string, keyPrefix: string) => {
  const segments = highlightSegments(text);
  return segments.map((seg, index) => {
    if (!seg.highlight) return <span key={`${keyPrefix}-t-${index}`}>{seg.text}</span>;
    return (
      <span
        key={`${keyPrefix}-h-${index}`}
        className="font-semibold text-[#087b67]"
      >
        {seg.text}
      </span>
    );
  });
};

const renderPhraseEmphasis = (text: string, phrases: string[], keyPrefix: string) => {
  const raw = String(text || '');
  if (!raw) return <span />;
  const hit = (phrases || []).find((p) => p && raw.includes(p));
  if (!hit) return <>{raw}</>;
  const idx = raw.indexOf(hit);
  const before = raw.slice(0, idx);
  const after = raw.slice(idx + hit.length);
  return (
    <>
      <span key={`${keyPrefix}-b`}>{before}</span>
      <span key={`${keyPrefix}-p`} className="font-semibold text-[#087b67]">
        {hit}
      </span>
      <span key={`${keyPrefix}-a`}>{after}</span>
    </>
  );
};

const renderEmphasizedHeadline = (text: string, keyPrefix: string, insightKey: string) => {
  const raw = String(text || '').trim();
  if (!raw) return <span />;
  if (/[「」“”【】]/.test(raw)) {
    return <>{renderHighlightedText(raw, keyPrefix)}</>;
  }

  const renderByRanges = (input: string, ranges: Array<{ start: number; end: number }>) => {
    const safeRanges = (ranges || [])
      .map((r) => ({ start: Math.max(0, r.start), end: Math.min(input.length, r.end) }))
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);

    if (!safeRanges.length) return <>{input}</>;

    const merged: Array<{ start: number; end: number }> = [];
    safeRanges.forEach((r) => {
      const last = merged[merged.length - 1];
      if (!last || r.start > last.end) {
        merged.push({ ...r });
        return;
      }
      last.end = Math.max(last.end, r.end);
    });

    const parts: JSX.Element[] = [];
    let cursor = 0;
    merged.forEach((r, idx) => {
      if (cursor < r.start) {
        parts.push(<span key={`${keyPrefix}-n-${idx}`}>{input.slice(cursor, r.start)}</span>);
      }
      parts.push(
        <span key={`${keyPrefix}-e-${idx}`} className="font-semibold text-[#087b67]">
          {input.slice(r.start, r.end)}
        </span>
      );
      cursor = r.end;
    });
    if (cursor < input.length) {
      parts.push(<span key={`${keyPrefix}-tail`}>{input.slice(cursor)}</span>);
    }
    return <>{parts}</>;
  };

  const buildChangeEmphasisRanges = (input: string) => {
    const ranges: Array<{ start: number; end: number }> = [];

    const token = '显著增强';
    let idx = input.indexOf(token);
    while (idx >= 0) {
      ranges.push({ start: idx, end: idx + token.length });
      idx = input.indexOf(token, idx + token.length);
    }

    const reShift = /从[^，。；\n]{1,80}?转向[^，。；\n]{1,120}/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = reShift.exec(input))) {
      const full = m[0] || '';
      const start = typeof m.index === 'number' ? m.index : -1;
      if (start < 0) continue;
      const offset = full.startsWith('从') ? 1 : 0;
      ranges.push({ start: start + offset, end: start + full.length });
    }

    return ranges;
  };

  const pickByDelimiters = (input: string, startIndex: number) => {
    const tail = input.slice(startIndex);
    const endCandidates = ['，', '。', '；', '\n'].map((ch) => {
      const idx = tail.indexOf(ch);
      return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
    });
    const end = Math.min(...endCandidates);
    return end === Number.POSITIVE_INFINITY ? tail : tail.slice(0, end);
  };

  const stripLeadingVerbs = (s: string) =>
    s.replace(/^(关注|聚焦|集中在|围绕|偏向|主要集中在|主要关注)\s*/g, '');

  let emphasisStart = -1;
  let emphasisText = '';

  if (insightKey === 'state') {
    const starters = ['当前最明显的特征是', '核心特征是', '当前最值得注意的是'];
    const hit = starters.find((k) => raw.includes(k));
    if (hit) {
      const start = raw.indexOf(hit) + hit.length;
      const after = raw.slice(start).replace(/^[：:\s]+/, '');
      const candidate = stripLeadingVerbs(pickByDelimiters(after, 0)).trim();
      if (candidate) {
        emphasisStart = raw.indexOf(after);
        emphasisText = candidate;
      }
    } else {
      const candidate = stripLeadingVerbs(pickByDelimiters(raw, 0)).trim();
      if (candidate && candidate.length < raw.length) {
        emphasisStart = raw.indexOf(candidate);
        emphasisText = candidate;
      }
    }
  } else if (insightKey === 'change') {
    const ranges = buildChangeEmphasisRanges(raw);
    if (ranges.length) return renderByRanges(raw, ranges);

    const fromIdx = raw.indexOf('从');
    if (fromIdx >= 0) {
      const afterFrom = raw.slice(fromIdx + 1);
      const endTokens = ['聚焦', '集中', '转向', '倾向', '。', '；', '\n'];
      const endCandidates = endTokens.map((t) => {
        const idx = afterFrom.indexOf(t);
        return idx >= 0 ? idx : Number.POSITIVE_INFINITY;
      });
      const end = Math.min(...endCandidates);
      const candidate = (end === Number.POSITIVE_INFINITY ? afterFrom : afterFrom.slice(0, end)).trim();
      if (candidate) {
        emphasisStart = fromIdx + 1;
        emphasisText = candidate;
      }
    } else {
      const commaIdx = raw.indexOf('，');
      if (commaIdx >= 0) {
        const after = raw.slice(commaIdx + 1).trim();
        const candidate = pickByDelimiters(after, 0).trim();
        if (candidate) {
          emphasisStart = commaIdx + 1;
          emphasisText = candidate;
        }
      }
    }
  } else if (insightKey === 'pattern') {
    const candidate = pickByDelimiters(raw, 0).trim();
    if (candidate && candidate.length < raw.length) {
      emphasisStart = raw.indexOf(candidate);
      emphasisText = candidate;
    }
  }

  if (emphasisStart < 0 || !emphasisText || emphasisText.length >= raw.length) {
    return <>{raw}</>;
  }

  return renderByRanges(raw, [{ start: emphasisStart, end: emphasisStart + emphasisText.length }]);
};

const normalizeTrendToLines = (text: string) => {
  const s = String(text || '').trim();
  if (!s) return [];
  const normalized = s
    .replace(/[；;]\s*(相比)/g, '\n$1')
    .replace(/。\s*(相比)/g, '。\n$1');
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const normalizeSuggestionToLines = (text: string) => {
  const s = String(text || '').trim();
  if (!s) return [];
  const normalized = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.includes('\n')) {
    return normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const withSentenceBreaks = normalized
    .replace(/。\s*(或许)/g, '。\n$1')
    .replace(/。\s*(这能|这会|这样)/g, '。\n$1')
    .replace(/。\s*(因此|所以)/g, '。\n$1');
  if (withSentenceBreaks.includes('\n')) {
    return withSentenceBreaks
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const sentences = normalized
    .split('。')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx, arr) => (idx === arr.length - 1 && !normalized.endsWith('。') ? part : `${part}。`));
  if (sentences.length >= 2) return sentences;

  // 最后兜底：用“因为/或许/这能”拆分
  const fallback = normalized.replace(/(因为|或许|这能|这会|这样)/g, '\n$1');
  return fallback
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const extractKeyPhraseForSuggestion = (headline: string) => {
  const s = String(headline || '').trim();
  if (!s) return '';

  // 例：这种快速切换的情绪状态，可能……
  if (s.startsWith('这种')) {
    const comma = s.indexOf('，');
    if (comma > 2 && comma <= 20) {
      return s.slice(2, comma).trim();
    }
  }

  // 例：你当前的学习重心是理解前沿动态背后的深层逻辑与长期影响。
  const isIdx = s.indexOf('是');
  if (isIdx >= 0 && isIdx <= 16) {
    const after = s.slice(isIdx + 1).replace(/^[：:\s]+/, '');
    const end = after.search(/[，。；\n]/);
    const candidate = (end >= 0 ? after.slice(0, end) : after).trim();
    if (candidate && candidate.length <= 32) return candidate;
  }

  // 默认：取第一个逗号前的核心短语（避免过长）
  const commaIdx = s.indexOf('，');
  const base = commaIdx > 0 ? s.slice(0, commaIdx) : s;
  const clipped = base.replace(/[。；]$/g, '').trim();
  if (clipped.length <= 18) return clipped;
  return clipped.slice(0, 18);
};

const buildCountYAxisProps = () => ({
  allowDecimals: false as const,
  padding: { top: 14, bottom: 14 } as const,
  domain: [0, (dataMax: number) => Math.max(1, Math.ceil(Number(dataMax || 0) * 1.15))] as const,
  tickFormatter: (value: unknown) => {
    const n = Number(value);
    if (Number.isFinite(n)) return String(Math.round(n));
    return String(value ?? '');
  }
});

const renderChart = (chart: AnalysisV3ChartItem, preset: AnalysisV3Preset) => {
  const { rows, xKey, yKey, categoryKey, valueKey } = deriveChartKeys(chart);
  let displayRows = rows;
  const countChart = isCountChart(chart, yKey, valueKey);
  const yAxisProps = countChart ? buildCountYAxisProps() : {};
  const axisLabels = getAxisLabels(chart, preset);
  const xAxisLabel = axisLabels.x;
  const yAxisLabel = axisLabels.y;
  const tooltipFormatter = (value: unknown, name: unknown) => [value, mapFieldToZh(String(name), chart)];

  if (chart.key === 'weekday') {
    const weekdayMap: Record<string, string> = {
      Mon: '周一',
      Tue: '周二',
      Wed: '周三',
      Thu: '周四',
      Fri: '周五',
      Sat: '周六',
      Sun: '周日'
    };
    displayRows = rows.map((row) => ({
      ...row,
      [categoryKey]: weekdayMap[String(row[categoryKey])] || row[categoryKey]
    }));
  }

  if (chart.key === 'length') {
    const lengthMap: Record<string, string> = {
      short: '短',
      medium: '中',
      long: '长'
    };
    displayRows = displayRows.map((row) => ({
      ...row,
      [categoryKey]: lengthMap[String(row[categoryKey])] || row[categoryKey]
    }));
  }

  if (!displayRows.length) {
    return <div className="text-sm text-gray-500">暂无图表数据</div>;
  }

  if (chart.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={displayRows} margin={{ left: 8, right: 18, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="0" stroke={CHART_GRID_COLOR} />
          <XAxis
            dataKey={xKey}
            padding={{ left: 24, right: 24 }}
            tick={chartAxisTick}
            axisLine={{ stroke: CHART_AXIS_LINE }}
            tickLine={false}
          />
          <YAxis
            {...(yAxisProps as any)}
            tick={chartAxisTick}
            axisLine={{ stroke: CHART_AXIS_LINE }}
            tickLine={false}
          />
          <Tooltip
            formatter={tooltipFormatter as any}
            labelFormatter={(label) => `${xAxisLabel}：${label}`}
            contentStyle={chartTooltipStyle}
            labelStyle={{ color: CHART_TICK_COLOR }}
          />
          <Line type="monotone" dataKey={yKey} stroke={CHART_LINE_PALETTE[0]} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'bar') {
    const barValues = displayRows
      .map((row) => Number(row[valueKey] || 0))
      .filter((value) => Number.isFinite(value));
    const barMax = barValues.length ? Math.max(...barValues) : 0;
    const barYMax = Math.max(1, Math.ceil(barMax * 1.15));
    const barTicks = Array.from({ length: barYMax + 1 }, (_, idx) => idx);
    const barGridTicks = barTicks;
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={displayRows}>
          <CartesianGrid
            strokeDasharray="0"
            stroke={CHART_GRID_COLOR}
            vertical={false}
            horizontalValues={barGridTicks}
          />
          <XAxis
            dataKey={categoryKey}
            padding={{ left: 16, right: 16 }}
            tick={chartAxisTick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            {...(yAxisProps as any)}
            tick={chartAxisTick}
            axisLine={false}
            tickLine={false}
            ticks={barTicks}
          />
          <Tooltip
            formatter={tooltipFormatter as any}
            labelFormatter={(label) => `${xAxisLabel}：${label}`}
            contentStyle={chartTooltipStyle}
            labelStyle={{ color: CHART_TICK_COLOR }}
          />
          <Bar dataKey={valueKey} fill={CHART_BAR_PALETTE[0]} radius={[0, 0, 0, 0]} barSize={32} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'pie') {
    const pieData = displayRows.map((item) => ({
      name: String(item[categoryKey]),
      value: Number(item[valueKey] || 0)
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius={58}
            outerRadius={92}
            paddingAngle={2}
            labelLine={false}
            label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, name, payload }: any) => {
              const normalized = typeof percent === 'number' ? percent : 0;
              const radius = innerRadius + (outerRadius - innerRadius) * 1.25;
              const angle = (-midAngle * Math.PI) / 180;
              const x = cx + radius * Math.cos(angle);
              const y = cy + radius * Math.sin(angle);
              const labelName = String(name || payload?.name || '').trim();
              const labelText = labelName ? `${labelName} ${(normalized * 100).toFixed(0)}%` : `${(normalized * 100).toFixed(0)}%`;
              return (
                <text
                  x={x}
                  y={y}
                  fill={CHART_TICK_COLOR}
                  fontSize={12}
                  fontFamily={CHART_FONT_FAMILY}
                  textAnchor={x > cx ? 'start' : 'end'}
                  dominantBaseline="central"
                >
                  {labelText}
                </text>
              );
            }}
          >
            {pieData.map((entry, index) => (
              <Cell key={entry.name} fill={getPieSliceColor(index, pieData.length)} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [value, yAxisLabel]}
            labelFormatter={(label) => `${xAxisLabel}：${label}`}
            contentStyle={chartTooltipStyle}
            labelStyle={{ color: CHART_TICK_COLOR }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'heatmap') {
    const totalCount = displayRows.reduce((sum, row) => {
      const v = Number(row[valueKey] || 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0) || displayRows.length;
    const policy = resolveHeatmapPolicy(totalCount);

    const topicTotals = new Map<string, number>();
    displayRows.forEach((row) => {
      const topic = String(row[yKey]);
      const v = Number(row[valueKey] || 0);
      if (!Number.isFinite(v) || v <= 0) return;
      topicTotals.set(topic, (topicTotals.get(topic) || 0) + v);
    });
    const sortedTopics = Array.from(topicTotals.entries()).sort((a, b) => b[1] - a[1]);
    const topSet =
      typeof policy.topN === 'number' && sortedTopics.length > policy.topN
        ? new Set(sortedTopics.slice(0, policy.topN).map(([topic]) => topic))
        : null;

    const bucketOrder = new Map<string, { label: string; sortKey: number | null; index: number }>();
    let bucketIndex = 0;
    const aggregated = new Map<string, { xLabel: string; xSort: number | null; topicLabel: string; value: number }>();

    displayRows.forEach((row) => {
      const rawX = row[xKey];
      const topicRaw = String(row[yKey]);
      const topicLabel = topSet && !topSet.has(topicRaw) ? '其他' : topicRaw;
      const value = Number(row[valueKey] || 0);
      if (!Number.isFinite(value) || value <= 0) return;

      const parsedDate = parseDateValue(rawX);
      let xLabel = String(rawX);
      let sortKey: number | null = null;
      if (parsedDate) {
        let bucketDate = new Date(parsedDate);
        if (policy.granularity === 'week') bucketDate = getWeekStart(parsedDate);
        if (policy.granularity === 'month') bucketDate = getMonthStart(parsedDate);
        if (policy.granularity === 'day') bucketDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        xLabel = policy.granularity === 'month'
          ? `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, '0')}`
          : formatDateBucket(bucketDate);
        sortKey = bucketDate.getTime();
      }

      if (!bucketOrder.has(xLabel)) {
        bucketOrder.set(xLabel, { label: xLabel, sortKey, index: bucketIndex++ });
      }

      const key = `${xLabel}__${topicLabel}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.value += value;
      } else {
        aggregated.set(key, { xLabel, xSort: sortKey, topicLabel, value });
      }
    });

    const yTotals = new Map<string, number>();
    aggregated.forEach((item) => {
      yTotals.set(item.topicLabel, (yTotals.get(item.topicLabel) || 0) + item.value);
    });
    const yValues = Array.from(yTotals.keys()).sort((a, b) => {
      const diff = (yTotals.get(b) || 0) - (yTotals.get(a) || 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    const yIndexMap = new Map(yValues.map((label, idx) => [label, idx]));

    const xEntries = Array.from(bucketOrder.values());
    const hasSortKey = xEntries.some((entry) => typeof entry.sortKey === 'number');
    const xValues = (hasSortKey ? [...xEntries].sort((a, b) => {
      const aSort = a.sortKey ?? a.index;
      const bSort = b.sortKey ?? b.index;
      return aSort - bSort;
    }) : [...xEntries].sort((a, b) => a.index - b.index)).map((entry) => entry.label);

    const points: Array<{
      x: string;
      y: number;
      value: number;
      xLabel: string;
      topicLabel: string;
      fill: string;
    }> = [];
    aggregated.forEach((item) => {
      const yIndex = yIndexMap.get(item.topicLabel);
      if (yIndex === undefined) return;
      points.push({
        x: item.xLabel,
        y: yIndex,
        value: item.value,
        xLabel: item.xLabel,
        topicLabel: item.topicLabel,
        fill: CHART_HEATMAP_COLOR
      });
    });

    const matrix = new Map<string, number>();
    points.forEach((item) => {
      const key = `${item.xLabel}__${item.topicLabel}`;
      matrix.set(key, (matrix.get(key) || 0) + item.value);
    });

    if (!matrix.size) {
      return <div className="text-sm text-gray-500">暂无图表数据</div>;
    }

    const values = Array.from(matrix.values());
    const max = values.length ? Math.max(...values) : 1;
    const min = values.length ? Math.min(...values) : 0;
    const renderValue = xValues.length <= 10 && yValues.length <= 8;
    const formatCellValue = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return '';
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(1);
    };
    const getHeatColor = (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return 'transparent';
      const ratio = max === min ? 0.35 : (value - min) / (max - min);
      const alpha = 0.15 + ratio * 0.7;
      return `rgba(6, 195, 168, ${alpha})`;
    };
    const valueAxisLabel = mapFieldToZh(valueKey, chart);
    const xTickAngle = xValues.length > 8 ? -30 : 0;
    const formatXLabel = (value: string) => {
      const text = String(value || '');
      if (text.length <= 10) return text;
      return `${text.slice(0, 10)}…`;
    };
    return (
      <div className="space-y-2">
        <div className="overflow-auto">
          <div
            className="grid w-full"
            style={{ gridTemplateColumns: `160px repeat(${xValues.length}, minmax(0, 1fr))` }}
          >
            <div className="p-2 text-xs font-medium" style={{ color: CHART_TICK_COLOR, fontFamily: CHART_FONT_FAMILY }}>
              {' '}
            </div>
            {xValues.map((value) => (
              <div
                key={`x-${value}`}
                className="p-2 text-xs font-medium"
                style={{
                  color: CHART_TICK_COLOR,
                  fontFamily: CHART_FONT_FAMILY,
                  transform: xTickAngle ? `rotate(${xTickAngle}deg)` : 'none',
                  transformOrigin: xTickAngle ? 'left center' : 'center'
                }}
              >
                {formatXLabel(value)}
              </div>
            ))}
            {yValues.map((yValue) => (
              <Fragment key={`y-${yValue}`}>
                <div
                  className="p-2 text-xs font-medium"
                  style={{ color: CHART_TICK_COLOR, fontFamily: CHART_FONT_FAMILY }}
                >
                  {yValue}
                </div>
                {xValues.map((xValue) => {
                  const cellValue = matrix.get(`${xValue}__${yValue}`) ?? 0;
                  const backgroundColor = getHeatColor(cellValue);
                  const cellText = renderValue ? formatCellValue(cellValue) : '';
                  return (
                    <div
                      key={`${xValue}-${yValue}`}
                      className="p-2 text-xs text-center"
                      style={{
                        backgroundColor,
                        color: CHART_TICK_COLOR,
                        fontFamily: CHART_FONT_FAMILY
                      }}
                      title={`${yValue} · ${xValue} · ${valueAxisLabel}：${cellValue}`}
                    >
                      {cellText}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {policy.sampleHint ? (
          <div className="text-xs text-gray-500">{policy.sampleHint}</div>
        ) : null}
      </div>
    );
  }

  return <div className="text-sm text-gray-500">暂不支持该图表类型</div>;
};

interface AnalysisV2OnDemandPageProps {
  notebookIdOverride?: string | null;
}

const AnalysisV2OnDemandPage = ({ notebookIdOverride }: AnalysisV2OnDemandPageProps = {}) => {
  const { notebookId: notebookIdParam } = useParams<{ notebookId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const historyAnchorRef = useRef<HTMLElement | null>(null);
  const selectionSignatureRef = useRef<string | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState<string | null>(notebookIdOverride || notebookIdParam || null);
  const [notebookDropdownOpen, setNotebookDropdownOpen] = useState(false);
  const [hoveredNotebookId, setHoveredNotebookId] = useState<string | null>(null);
  const notebookDropdownRef = useRef<HTMLDivElement | null>(null);
  const notebookTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notebookMenuRef = useRef<HTMLDivElement | null>(null);
  const [notebookMenuPos, setNotebookMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const mountedRef = useRef(true);
  const selectionTouchedRef = useRef(false);
  const notebooksRequestIdRef = useRef(0);
  const notesRequestIdRef = useRef(0);
  const analysisRequestIdRef = useRef(0);
  const debugRequestIdRef = useRef(0);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [timePreset, setTimePreset] = useState<AnalysisV3Preset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyRange, setHistoryRange] = useState<{ from: string; to: string } | null>(null);
  const [autoSelectAllFromHistory, setAutoSelectAllFromHistory] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisV3Response | null>(null);
  const [selectedChartKey, setSelectedChartKey] = useState<string | null>(null);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<AnalysisV3Response['cache'] | null>(null);
  const [debugData, setDebugData] = useState<AnalysisV3Response['debug'] | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const debugFetchedRef = useRef<string | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryRecord[]>([]);
  const [analysisHistoryOpen, setAnalysisHistoryOpen] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [showingHistoryId, setShowingHistoryId] = useState<string | null>(null);
  const [analysisConfirmOpen, setAnalysisConfirmOpen] = useState(false);
  const [matchedHistory, setMatchedHistory] = useState<AnalysisHistoryRecord | null>(null);
  const historyLoadedRef = useRef(false);
  const [historyPanelPos, setHistoryPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const NONE_HOVER_ID = '__none__';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setNotebookId(notebookIdOverride || notebookIdParam || null);
  }, [notebookIdOverride, notebookIdParam]);

  const historyIdParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const raw = params.get('historyId');
    return raw ? raw.trim() : null;
  }, [location.search]);

  useEffect(() => {
    const history = loadAnalysisHistory();
    setAnalysisHistory(history);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleRefresh = () => {
      setAnalysisHistory(loadAnalysisHistory());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ANALYSIS_HISTORY_STORAGE_KEY) return;
      setAnalysisHistory(loadAnalysisHistory());
    };
    window.addEventListener('analysis:refresh', handleRefresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('analysis:refresh', handleRefresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!historyLoadedRef.current) {
      historyLoadedRef.current = true;
      return;
    }
    saveAnalysisHistory(analysisHistory);
  }, [analysisHistory]);

  const resolveNotebookName = useCallback(
    (id: string) => {
      const found = notebooks.find((item) => String(item.notebook_id) === String(id));
      return found?.name || '未命名笔记本';
    },
    [notebooks]
  );

  const makeHistoryTitle = useCallback(
    (args: { notebookId: string; preset: AnalysisV3Preset; noteCount?: number; recordCount?: number }) => {
      const notebookName = resolveNotebookName(args.notebookId);
      const noteCountText = typeof args.noteCount === 'number' ? `·选${args.noteCount}条` : '';
      const recordCountText = typeof args.recordCount === 'number' ? `·共${args.recordCount}条` : '';
      return `${notebookName}·${getPresetLabel(args.preset)}${noteCountText}${recordCountText}`;
    },
    [resolveNotebookName]
  );

  const updateHistoryPanelPos = useCallback(() => {
    if (typeof window === 'undefined') return;
    const anchor = historyAnchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const padding = 12;
    const width = rect.width;
    const left = Math.min(Math.max(rect.left, padding), Math.max(padding, window.innerWidth - width - padding));
    setHistoryPanelPos({
      top: 80,
      left,
      width
    });
  }, []);

  useEffect(() => {
    if (!analysisHistoryOpen) {
      setHistoryPanelPos(null);
      return;
    }
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateHistoryPanelPos();
      });
    };
    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [analysisHistoryOpen, updateHistoryPanelPos]);

  const updateNotebookMenuPos = useCallback(() => {
    if (!notebookTriggerRef.current) return;
    const rect = notebookTriggerRef.current.getBoundingClientRect();
    const width = rect.width;
    const padding = 12;
    const maxLeft = typeof window !== 'undefined' ? Math.max(padding, window.innerWidth - width - padding) : rect.left;
    setNotebookMenuPos({
      top: rect.bottom + 10,
      left: Math.min(Math.max(rect.left, padding), maxLeft),
      width
    });
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        notebookDropdownRef.current &&
        !notebookDropdownRef.current.contains(event.target as Node) &&
        (!notebookMenuRef.current || !notebookMenuRef.current.contains(event.target as Node))
      ) {
        setNotebookDropdownOpen(false);
      }
    };

    if (notebookDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [notebookDropdownOpen]);

  useEffect(() => {
    if (!notebookDropdownOpen) {
      setNotebookMenuPos(null);
      setHoveredNotebookId(null);
      return;
    }
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateNotebookMenuPos();
      });
    };
    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [notebookDropdownOpen, updateNotebookMenuPos]);

  const loadNotebooks = useCallback(async () => {
    const requestId = (notebooksRequestIdRef.current += 1);
    try {
      const list = await apiClient.getNotebooks();
      if (!mountedRef.current || requestId !== notebooksRequestIdRef.current) return;
      setNotebooks(list);
    } catch (loadError: unknown) {
      console.error('[analysis-v2] failed to load notebooks:', loadError);
    }
  }, []);

  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  const loadNotes = useCallback(async () => {
    const requestId = (notesRequestIdRef.current += 1);
    if (!notebookId) {
      setNotes([]);
      setSelectedNoteIds([]);
      return;
    }
    try {
      setLoadingNotes(true);
      const result = await apiClient.getNotes(notebookId);
      if (!mountedRef.current || requestId !== notesRequestIdRef.current) return;
      setNotes(Array.isArray(result?.notes) ? result.notes : []);
    } catch (loadError: unknown) {
      console.error('[analysis-v2] failed to load notes:', loadError);
      if (!mountedRef.current || requestId !== notesRequestIdRef.current) return;
      setNotes([]);
      setSelectedNoteIds([]);
    } finally {
      if (!mountedRef.current || requestId !== notesRequestIdRef.current) return;
      setLoadingNotes(false);
    }
  }, [notebookId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!notebookId) {
      setAnalysisResult(null);
      setCacheInfo(null);
      setLastAnalysisAt(null);
      setSelectedChartKey(null);
      setDebugData(null);
      setDebugLoading(false);
      setCurrentHistoryId(null);
      setHistoryRange(null);
      setAutoSelectAllFromHistory(false);
      return;
    }

    const historyForNotebook = analysisHistory.filter((item) => item.notebookId === notebookId);
    const latest = historyForNotebook.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const targeted =
      historyIdParam && historyForNotebook.length
        ? historyForNotebook.find((item) => item.id === historyIdParam)
        : null;
    const target = targeted || latest;

    if (!target) {
      setAnalysisResult(null);
      setCacheInfo(null);
      setLastAnalysisAt(null);
      setSelectedChartKey(null);
      setDebugData(null);
      setDebugLoading(false);
      setCurrentHistoryId(null);
      setHistoryRange(null);
      return;
    }

    setAnalysisResult(target.result);
    setCacheInfo(target.result.cache || null);
    setLastAnalysisAt(new Date(target.updatedAt).toISOString());
    setSelectedChartKey(
      target.selectedChartKey ||
        target.result.charts?.defaultKey ||
        target.result.charts?.items?.[0]?.key ||
        null
    );
    setDebugData(null);
    setDebugLoading(false);
    setCurrentHistoryId(target.id);
    selectionTouchedRef.current = false;
    setTimePreset(target.request.preset);
    if (target.request.preset === 'custom') {
      setCustomFrom(target.request.from || '');
      setCustomTo(target.request.to || '');
      setHistoryRange(null);
    } else {
      setHistoryRange(resolveHistoryRange(target));
    }
    const requestedNoteIds = getRequestNoteIds(target.request);
    const explicitNoteIds = requestedNoteIds.length > 0;
    setSelectedNoteIds(explicitNoteIds ? requestedNoteIds : []);
    setAutoSelectAllFromHistory(!explicitNoteIds);
  }, [notebookId, analysisHistory, historyIdParam]);

  const presetRange = useMemo(() => resolvePresetRange(timePreset), [timePreset]);

  const currentSelectionSignature = useMemo(() => {
    if (selectedNoteIds.length) {
      return `notes:${normalizeNoteIds(selectedNoteIds)}`;
    }
    const range =
      timePreset === 'custom'
        ? customFrom && customTo
          ? { from: customFrom, to: customTo }
          : null
        : historyRange?.from && historyRange?.to
          ? historyRange
          : presetRange.from && presetRange.to
            ? { from: toDateInputValue(presetRange.from), to: toDateInputValue(presetRange.to) }
            : null;
    if (!range) return null;
    return `range:${range.from}-${range.to}`;
  }, [selectedNoteIds, timePreset, customFrom, customTo, historyRange, presetRange]);

  useEffect(() => {
    if (timePreset !== 'custom') {
      setCustomFrom(presetRange.from ? toDateInputValue(presetRange.from) : '');
      setCustomTo(presetRange.to ? toDateInputValue(presetRange.to) : '');
    }
  }, [timePreset, presetRange]);

  useEffect(() => {
    if (selectionSignatureRef.current && selectionSignatureRef.current !== currentSelectionSignature) {
      setShowingHistoryId(null);
    }
    selectionSignatureRef.current = currentSelectionSignature;
  }, [currentSelectionSignature]);

  const filteredNotes = useMemo(() => {
    if (!notes.length) return [];
    let from: Date | null = null;
    let to: Date | null = null;
    if (timePreset === 'custom') {
      from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      to = customTo ? new Date(`${customTo}T23:59:59`) : null;
    } else if (historyRange?.from && historyRange?.to) {
      from = new Date(`${historyRange.from}T00:00:00`);
      to = new Date(`${historyRange.to}T23:59:59`);
    } else {
      from = presetRange.from;
      to = presetRange.to;
    }
    if (!from && !to) return notes;
    return notes.filter((note) => {
      const raw = note.created_at || note.updated_at;
      if (!raw) return false;
      const dt = new Date(raw);
      if (Number.isNaN(dt.getTime())) return false;
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      return true;
    });
  }, [notes, timePreset, customFrom, customTo, presetRange, historyRange]);

  useEffect(() => {
    const allowedIds = new Set(filteredNotes.map((note) => String(note.note_id)));
    setSelectedNoteIds((prev) => prev.filter((id) => allowedIds.has(id)));
  }, [filteredNotes]);

  const allSelectableIds = useMemo(() => filteredNotes.map((note) => String(note.note_id)), [filteredNotes]);
  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedNoteIds.includes(id));

  useEffect(() => {
    if (!autoSelectAllFromHistory) return;
    if (!allSelectableIds.length) return;
    setSelectedNoteIds(allSelectableIds);
    setAutoSelectAllFromHistory(false);
  }, [autoSelectAllFromHistory, allSelectableIds]);

  useEffect(() => {
    if (selectionTouchedRef.current) return;
    if (!historyIdParam) return;
    if (selectedNoteIds.length > 0) return;
    if (!allSelectableIds.length) return;
    if (timePreset === 'custom') return;
    if (!historyRange?.from || !historyRange?.to) return;
    setSelectedNoteIds(allSelectableIds);
  }, [historyIdParam, selectedNoteIds.length, allSelectableIds, timePreset, historyRange]);

  const toggleNoteSelection = (noteId: string) => {
    setAutoSelectAllFromHistory(false);
    selectionTouchedRef.current = true;
    setSelectedNoteIds((prev) => (prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]));
  };

  const toggleSelectAll = () => {
    setAutoSelectAllFromHistory(false);
    selectionTouchedRef.current = true;
    if (allSelected) {
      setSelectedNoteIds([]);
    } else {
      setSelectedNoteIds(allSelectableIds);
    }
  };

  const handleAnalyze = async (options?: { force?: boolean }) => {
    const requestId = (analysisRequestIdRef.current += 1);
    const forceAnalyze = Boolean(options?.force);
    if (!notebookId) {
      setError('请先选择笔记本。');
      return;
    }
    if (timePreset === 'custom' && (!customFrom || !customTo)) {
      setError('请先选择自定义时间范围。');
      return;
    }
    setError(null);
    setAnalysisStatus('loading');
    setDebugData(null);
    try {
      if (!forceAnalyze && currentSelectionSignature) {
        const historyForNotebook = analysisHistory.filter((item) => item.notebookId === notebookId);
        const matched = historyForNotebook.find((item) => {
          if (item.request?.noteIds && item.request.noteIds.length > 0) {
            return `notes:${normalizeNoteIds(item.request.noteIds)}` === currentSelectionSignature;
          }
          const range =
            item.request?.from && item.request?.to
              ? { from: item.request.from, to: item.request.to }
              : resolveHistoryRange(item);
          if (!range) return false;
          return `range:${range.from}-${range.to}` === currentSelectionSignature;
        });
        if (matched) {
          setMatchedHistory(matched);
          setAnalysisConfirmOpen(true);
          setAnalysisStatus('idle');
          return;
        }
      }

      const useHistoryRange =
        timePreset !== 'custom' && Boolean(historyRange?.from && historyRange?.to);
      const resolvedHistoryRange =
        timePreset === 'custom'
          ? customFrom && customTo
            ? { from: customFrom, to: customTo }
            : null
          : useHistoryRange
            ? (historyRange as { from: string; to: string })
            : presetRange.from && presetRange.to
              ? { from: toDateInputValue(presetRange.from), to: toDateInputValue(presetRange.to) }
              : null;
      const payloadPreset = useHistoryRange ? 'custom' : timePreset;
      const payloadFrom = useHistoryRange ? historyRange?.from : timePreset === 'custom' ? customFrom : undefined;
      const payloadTo = useHistoryRange ? historyRange?.to : timePreset === 'custom' ? customTo : undefined;

      const payload = {
        notebookId,
        timeRange: {
          preset: payloadPreset,
          from: payloadFrom,
          to: payloadTo
        },
        noteIds: selectedNoteIds.length > 0 ? selectedNoteIds : undefined,
        withDebug: false
      };
      const result = await apiClient.analyzeV3(payload);
      if (!mountedRef.current || requestId !== analysisRequestIdRef.current) return;
      setAnalysisResult(result);
      setCacheInfo(result.cache || null);
      setLastAnalysisAt(new Date().toISOString());
      const defaultKey = result.charts?.defaultKey || result.charts?.items?.[0]?.key || null;
      setSelectedChartKey(defaultKey);
      setAnalysisStatus('ready');
      setShowingHistoryId(null);

      const now = Date.now();
      const historyId = generateHistoryId();
      const title = makeHistoryTitle({
        notebookId,
        preset: timePreset,
        noteCount: selectedNoteIds.length > 0 ? selectedNoteIds.length : undefined,
        recordCount: Number(result?.meta?.recordCount || 0)
      });
      const historyRecord: AnalysisHistoryRecord = {
        id: historyId,
        notebookId,
        title,
        createdAt: now,
        updatedAt: now,
        request: {
          preset: timePreset,
          from: resolvedHistoryRange?.from,
          to: resolvedHistoryRange?.to,
          noteIds: selectedNoteIds.length > 0 ? selectedNoteIds : undefined
        },
        selectedChartKey: defaultKey,
        result: compactAnalysisResultForStorage(result)
      };
      setCurrentHistoryId(historyId);
      setHistoryRange(timePreset === 'custom' ? null : resolvedHistoryRange);
      setAnalysisHistory((prev) => {
        const next = [historyRecord, ...(prev || [])].slice(0, ANALYSIS_HISTORY_MAX_SESSIONS);
        saveAnalysisHistory(next);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('analysis:refresh'));
        }
        return next;
      });
      navigate(`/analysis/v2/${notebookId}?historyId=${encodeURIComponent(historyId)}`, { replace: true });
    } catch (runError: unknown) {
      console.error('[analysis-v2] analyze failed:', runError);
      if (!mountedRef.current || requestId !== analysisRequestIdRef.current) return;
      setError(getErrorMessage(runError, '分析失败，请稍后重试。'));
      setAnalysisStatus('error');
    }
  };

  const handleReanalyze = () => {
    setAnalysisConfirmOpen(false);
    setMatchedHistory(null);
    setShowingHistoryId(null);
    if (notebookId) {
      navigate(`/analysis/v2/${notebookId}`, { replace: true });
    }
    handleAnalyze({ force: true });
  };

  const activeChartKey = selectedChartKey || analysisResult?.charts?.defaultKey || null;
  const resolvedChart = useMemo(() => {
    if (!analysisResult?.charts?.items?.length) return null;
    return analysisResult.charts.items.find((item) => item.key === activeChartKey) || analysisResult.charts.items[0];
  }, [analysisResult, activeChartKey]);

  const activeInsights = useMemo(() => {
    if (!analysisResult) return [];
    if (activeChartKey && analysisResult.insightsByChartKey?.[activeChartKey]) {
      return analysisResult.insightsByChartKey[activeChartKey];
    }
    return analysisResult.insights || [];
  }, [analysisResult, activeChartKey]);

  const suggestionCardTitle = useMemo(() => {
    const t = String(analysisResult?.notebookType || '').trim();
    const noteTypeValue = String(analysisResult?.noteType?.value || '').trim();
    if (['finance', 'ai', 'study'].includes(t)) return '个性化建议';
    if (t === 'mood') return '自我觉察';
    if (noteTypeValue === 'monitoring') return '变化解读';
    return '个性化建议';
  }, [analysisResult]);

  const chartItems = analysisResult?.charts?.items || [];
  const selectedChartOrDefaultKey = activeChartKey || analysisResult?.charts?.defaultKey;

  const resolvedQuestion = resolvedChart ? getChartQuestion(resolvedChart, timePreset) : '';
  const resolvedMappingSegments = resolvedChart ? getChartMappingSegments(resolvedChart, timePreset) : null;
  const noChartMessage = analysisResult ? '数据不足，仅提供文字洞察' : '暂无图表候选';
  const analysisId = analysisResult?.analysisId || '';

  useEffect(() => {
    if (!configExpanded) {
      debugFetchedRef.current = null;
    }
  }, [configExpanded]);

  useEffect(() => {
    if (!configExpanded || !analysisId || debugData || debugLoading) return;
    if (debugFetchedRef.current === analysisId) return;
    debugFetchedRef.current = analysisId;
    const requestId = (debugRequestIdRef.current += 1);
    const fetchDebug = async () => {
      try {
        setDebugLoading(true);
        const result = await apiClient.getAnalysisV3Debug(analysisId);
        if (!mountedRef.current || requestId !== debugRequestIdRef.current) return;
        if (result?.debug) {
          setDebugData(result.debug);
        }
      } catch (debugError) {
        console.error('[analysis-v2] failed to load debug:', debugError);
      } finally {
        if (!mountedRef.current || requestId !== debugRequestIdRef.current) return;
        setDebugLoading(false);
      }
    };
    fetchDebug();
  }, [configExpanded, analysisId, debugData, debugLoading]);

  const handleNotebookChange = (nextId: string, historyId?: string | null) => {
    const trimmed = nextId || '';
    if (!trimmed) {
      setNotebookId(null);
      setHistoryRange(null);
      navigate('/analysis/v2');
      return;
    }
    setNotebookId(trimmed);
    const suffix = historyId ? `?historyId=${encodeURIComponent(historyId)}` : '';
    if (!historyId) {
      setHistoryRange(null);
    }
    navigate(`/analysis/v2/${trimmed}${suffix}`);
  };

  const selectedNotebookLabel = useMemo(() => {
    if (!notebookId) return '请选择笔记本';
    const nb = notebooks.find((item) => String(item.notebook_id) === String(notebookId));
    return nb?.name || '请选择笔记本';
  }, [notebooks, notebookId]);

  const renderHistoryModal = () => {
    if (!analysisHistoryOpen) return null;
    const sessions = notebookId ? analysisHistory.filter((item) => item.notebookId === notebookId) : analysisHistory;
    const panelStyle = historyPanelPos ?? { top: 80, left: 312, width: 960 };
    return createPortal(
      <div
        className="fixed inset-0 z-[1300]"
        onMouseDown={() => {
          setAnalysisHistoryOpen(false);
        }}
      >
        <div className="absolute inset-0 bg-black/10" />
        <div
          className="fixed px-4"
          style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-full overflow-hidden rounded-3xl border border-[#d4f3ed] bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#eef6fd] px-5 py-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  分析历史{notebookId ? ` · ${selectedNotebookLabel}` : ''}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {notebookId ? `共 ${sessions.length} 条` : `全部共 ${sessions.length} 条`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAnalysisHistory((prev) => {
                      if (!notebookId) return [];
                      return prev.filter((item) => item.notebookId !== notebookId);
                    });
                    setAnalysisHistoryOpen(false);
                    setCurrentHistoryId(null);
                    setAnalysisResult(null);
                    setCacheInfo(null);
                    setLastAnalysisAt(null);
                    setSelectedChartKey(null);
                    setDebugData(null);
                    setDebugLoading(false);
                  }}
                  className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                  title="清空历史"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setAnalysisHistoryOpen(false)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {sessions.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">暂无分析历史</div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => {
                    const active = session.id === currentHistoryId;
                    const updatedAtText = new Date(session.updatedAt).toLocaleString();
                    const selectedCount = session.request.noteIds?.length || 0;
                    const recordCount = Number(session.result?.meta?.recordCount || 0);
                    return (
                      <div
                        key={session.id}
                        className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                          active ? 'border-[#6bd8c0] bg-[#e8f7f3]' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (session.notebookId) {
                              handleNotebookChange(session.notebookId, session.id);
                            }
                            setAnalysisResult(session.result);
                            setCacheInfo(session.result.cache || null);
                            setLastAnalysisAt(new Date(session.updatedAt).toISOString());
                            setSelectedChartKey(
                              session.selectedChartKey ||
                                session.result.charts?.defaultKey ||
                                session.result.charts?.items?.[0]?.key ||
                                null
                            );
                            setAnalysisStatus('ready');
                            setError(null);
                            setDebugData(null);
                            setDebugLoading(false);
                            setCurrentHistoryId(session.id);
                            setTimePreset(session.request.preset);
                            if (session.request.preset === 'custom') {
                              setCustomFrom(session.request.from || '');
                              setCustomTo(session.request.to || '');
                              setHistoryRange(null);
                            } else {
                              setHistoryRange(resolveHistoryRange(session));
                            }
                            const requestedNoteIds = getRequestNoteIds(session.request);
                            const hasNoteIds = requestedNoteIds.length > 0;
                            setSelectedNoteIds(hasNoteIds ? requestedNoteIds : []);
                            setAutoSelectAllFromHistory(!hasNoteIds);
                            setAnalysisHistoryOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                          title="打开该分析"
                        >
                          <div className="truncate text-sm font-semibold text-slate-900">
                            {session.title || '未命名分析'}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>{updatedAtText}</span>
                            <span>·</span>
                            <span>{getPresetLabel(session.request.preset)}</span>
                            <span>·</span>
                            <span>选{selectedCount || '全部'}条</span>
                            <span>·</span>
                            <span>共{recordCount}条</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAnalysisHistory((prev) => prev.filter((item) => item.id !== session.id));
                            if (session.id === currentHistoryId) {
                              setCurrentHistoryId(null);
                              setAnalysisResult(null);
                              setCacheInfo(null);
                              setLastAnalysisAt(null);
                              setSelectedChartKey(null);
                              setDebugData(null);
                              setDebugLoading(false);
                            }
                          }}
                          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          title="删除该分析"
                        >
                          删除
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  const renderHistoryMatchModal = () => {
    if (!analysisConfirmOpen || !matchedHistory) return null;
    return createPortal(
      <div
        className="fixed inset-0 z-[1350] flex items-center justify-center"
        onMouseDown={() => {
          setAnalysisConfirmOpen(false);
          setMatchedHistory(null);
        }}
      >
        <div className="absolute inset-0 bg-black/20" />
        <div
          className="relative w-full max-w-md rounded-3xl border border-[#d4f3ed] bg-white p-6 shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="text-base font-semibold text-slate-900">检测到已有分析结果</div>
          <div className="mt-2 text-sm text-slate-600">
            已有一次针对相同笔记/时间范围的分析，是否直接展示上次结果？
          </div>
          <div className="mt-4 rounded-2xl border border-slate-100 bg-[#f7fbfa] px-4 py-3 text-xs text-slate-500">
            上次分析时间：{new Date(matchedHistory.updatedAt).toLocaleString()}
          </div>
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setAnalysisConfirmOpen(false);
                setMatchedHistory(null);
                handleAnalyze({ force: true });
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              重新分析
            </button>
            <button
              type="button"
              onClick={() => {
                setAnalysisConfirmOpen(false);
                setAnalysisResult(matchedHistory.result);
                setCacheInfo(matchedHistory.result.cache || null);
                setLastAnalysisAt(new Date(matchedHistory.updatedAt).toISOString());
                setSelectedChartKey(
                  matchedHistory.selectedChartKey ||
                    matchedHistory.result.charts?.defaultKey ||
                    matchedHistory.result.charts?.items?.[0]?.key ||
                    null
                );
                setAnalysisStatus('ready');
                setError(null);
                setDebugData(null);
                setDebugLoading(false);
                setCurrentHistoryId(matchedHistory.id);
                setShowingHistoryId(matchedHistory.id);
                selectionTouchedRef.current = false;
                setTimePreset(matchedHistory.request.preset);
                if (matchedHistory.request.preset === 'custom') {
                  setCustomFrom(matchedHistory.request.from || '');
                  setCustomTo(matchedHistory.request.to || '');
                  setHistoryRange(null);
                } else {
                  setHistoryRange(resolveHistoryRange(matchedHistory));
                }
                const requestedNoteIds = getRequestNoteIds(matchedHistory.request);
                const hasNoteIds = requestedNoteIds.length > 0;
                setSelectedNoteIds(hasNoteIds ? requestedNoteIds : []);
                setAutoSelectAllFromHistory(!hasNoteIds);
                navigate(
                  `/analysis/v2/${matchedHistory.notebookId}?historyId=${encodeURIComponent(matchedHistory.id)}`,
                  { replace: true }
                );
                setMatchedHistory(null);
              }}
              className="rounded-full bg-[#0a917a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#087b67]"
            >
              直接展示
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className="min-h-screen bg-[#eef6fd]">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <section
          ref={historyAnchorRef as any}
          className="rounded-3xl border border-[#d4f3ed] bg-white shadow-sm p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-900">当前笔记本</span>
              <div className="relative min-w-[220px]" ref={notebookDropdownRef}>
                <button
                  ref={notebookTriggerRef}
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={notebookDropdownOpen}
                  onClick={() => setNotebookDropdownOpen((prev) => !prev)}
                  className="w-full flex items-center justify-between rounded-full border border-[#90e2d0] bg-[#e7fbf5] px-5 py-2 text-sm font-semibold text-[#0a917a] hover:border-[#6bd8c0]"
                >
                  <span className="truncate">{selectedNotebookLabel}</span>
                  <svg
                    className={`ml-3 h-4 w-4 flex-shrink-0 transition-transform ${notebookDropdownOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {notebookDropdownOpen && notebookMenuPos &&
                  createPortal(
                    <div
                      ref={notebookMenuRef}
                      className="fixed z-[1200]"
                      style={{ top: notebookMenuPos.top, left: notebookMenuPos.left, width: notebookMenuPos.width }}
                      role="listbox"
                    >
                      <div className="rounded-2xl border border-[#d4f3ed] bg-white shadow-xl p-2">
                        <button
                          type="button"
                          role="option"
                          aria-selected={!notebookId}
                          onClick={() => {
                            handleNotebookChange('');
                            setNotebookDropdownOpen(false);
                            setHoveredNotebookId(null);
                          }}
                          onMouseEnter={() => setHoveredNotebookId(NONE_HOVER_ID)}
                          onMouseLeave={() => setHoveredNotebookId(null)}
                          className={`relative w-full rounded-xl px-4 py-3 text-center text-sm transition-colors ${
                            ((hoveredNotebookId === null || hoveredNotebookId === undefined) && !notebookId) || hoveredNotebookId === NONE_HOVER_ID
                              ? 'bg-[#e7fbf5] text-[#0a917a] font-semibold'
                              : 'text-gray-900 hover:bg-[#eef6fd]'
                          }`}
                        >
                          {!notebookId && (
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#0a917a]">✓</span>
                          )}
                          <span>请选择笔记本</span>
                        </button>
                        <div className="my-2 h-px bg-[#eef6fd]" />
                        <div className="max-h-[320px] overflow-auto">
                          {!notebooks.length ? (
                            <div className="px-4 py-6 text-center text-sm text-gray-500">暂无笔记本，请先创建。</div>
                          ) : (
                            notebooks.map((nb) => {
                              const id = String(nb.notebook_id);
                              const isSelected = notebookId === id;
                              const isHovered = hoveredNotebookId === id;
                              const shouldHighlight =
                                isHovered || ((hoveredNotebookId === null || hoveredNotebookId === undefined) && isSelected);
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  onClick={() => {
                                    handleNotebookChange(id);
                                    setNotebookDropdownOpen(false);
                                    setHoveredNotebookId(null);
                                  }}
                                  onMouseEnter={() => setHoveredNotebookId(id)}
                                  onMouseLeave={() => setHoveredNotebookId(null)}
                                  className={`relative w-full rounded-xl px-4 py-3 text-center text-sm transition-colors ${
                                    shouldHighlight
                                      ? 'bg-[#e7fbf5] text-[#0a917a] font-semibold'
                                      : 'text-gray-900 hover:bg-[#eef6fd]'
                                  }`}
                                >
                                  {isSelected && (
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#0a917a]">✓</span>
                                  )}
                                  <span>{nb.name}</span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-900">时间窗</span>
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setTimePreset(option.value);
                      setHistoryRange(null);
                      setAutoSelectAllFromHistory(false);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      timePreset === option.value
                        ? 'border-[#0a917a] bg-[#e7fbf5] text-[#0a917a]'
                        : 'border-gray-200 text-gray-600 hover:border-[#6bd8c0]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNotesExpanded((prev) => !prev)}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-[#6bd8c0]"
            >
              {notesExpanded ? '收起设置 ▴' : '展开设置 ▾'}
            </button>
          </div>

          {timePreset !== 'custom' && historyRange?.from && historyRange?.to && (
            <div className="text-xs text-gray-500">
              历史范围：{historyRange.from} ~ {historyRange.to}
            </div>
          )}

          {timePreset === 'custom' && (
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              <label className="flex items-center gap-2">
                <span>起始日期</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>结束日期</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs"
                />
              </label>
            </div>
          )}

          {notesExpanded && (
            <div className="rounded-2xl border border-[#c5f0e4] bg-[#f5fffb]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#dff7ef] bg-white/70">
                <div className="text-sm font-semibold text-gray-900">笔记列表</div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>已选择 {selectedNoteIds.length} 条</span>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-[#0a917a] focus:ring-[#43ccb0]"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={!allSelectableIds.length}
                    />
                    <span>全选</span>
                  </label>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-[#e0f4ed]">
                {loadingNotes ? (
                  <div className="px-4 py-8 text-center text-xs text-gray-500">正在加载笔记...</div>
                ) : filteredNotes.length ? (
                  filteredNotes.map((note) => {
                    const id = String(note.note_id);
                    const checked = selectedNoteIds.includes(id);
                    return (
                      <label key={id} className="flex items-start gap-3 px-4 py-3 text-xs text-gray-700 hover:bg-[#f0fffa] cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1 rounded border-gray-300 text-[#0a917a] focus:ring-[#43ccb0]"
                          checked={checked}
                          onChange={() => toggleNoteSelection(id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{note.title || note.content || '未命名笔记'}</span>
                            <span className="text-[11px] text-gray-400 flex-shrink-0">
                              {(note.created_at || '').slice(0, 10)}
                            </span>
                          </div>
                        </div>
                      </label>
                    );
                  })
                ) : (
                  <div className="px-4 py-8 text-center text-xs text-gray-400">当前时间窗暂无笔记</div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-gray-500">
              {lastAnalysisAt && <span>上次分析：{new Date(lastAnalysisAt).toLocaleString()}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  updateHistoryPanelPos();
                  setAnalysisHistoryOpen(true);
                }}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                历史
              </button>
              <button
                type="button"
                onClick={() => (showingHistoryId ? handleReanalyze() : handleAnalyze())}
                disabled={analysisStatus === 'loading'}
                className="rounded-full bg-[#0a917a] px-5 py-2 text-sm font-semibold text-white hover:bg-[#087b67]"
              >
                {analysisStatus === 'loading' ? 'AI 正在分析...' : showingHistoryId ? 'AI重新分析' : 'AI分析'}
              </button>
            </div>
          </div>
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">{error}</div>
          )}
        </section>

        <section className="space-y-3">
          <div className="inline-flex items-center rounded-full border border-[#d4f3ed] bg-white/80 px-4 py-1.5 text-sm font-semibold text-gray-700 shadow-sm">
            洞察卡
          </div>
          {(() => {
            const primaryInsights = activeInsights.filter((item) => item.key !== 'pattern');
            const suggestionInsight = activeInsights.find((item) => item.key === 'pattern') || null;
            const renderInsightCard = (insight: AnalysisV3Insight) => {
              const isSuggestion = insight.key === 'pattern';
              const title =
                insight.key === 'state'
                  ? '主要洞察'
                  : insight.key === 'change'
                    ? '变化趋势'
                    : suggestionCardTitle;
              const badge =
                insight.key === 'state'
                  ? '结论'
                  : insight.key === 'change'
                    ? '对比'
                    : '建议';
              const content = isSuggestion ? insight.canDo || insight.what : insight.what;

              const lines =
                insight.key === 'change'
                  ? normalizeTrendToLines(content || '')
                  : isSuggestion
                    ? normalizeSuggestionToLines(content || '')
                    : [String(content || '').trim()].filter(Boolean);
              const headline = lines[0] || (content || '暂无内容');
              const restLines = lines.length > 1 ? lines.slice(1) : [];
              const patternKeyPhrase = isSuggestion ? extractKeyPhraseForSuggestion(String(headline || '')) : '';

              return (
                <div
                  key={insight.key}
                  className={`rounded-3xl border border-[#d4f3ed] bg-white p-5 shadow-sm space-y-3 ${
                    isSuggestion ? 'h-full flex flex-col' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 px-4">
                    <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">{title}</div>
                    <span className="inline-flex items-center rounded-full border border-[#d4f3ed] bg-[#f8fffd] px-2 py-0.5 text-[11px] font-semibold text-[#0a917a] whitespace-nowrap">
                      {badge}
                    </span>
                  </div>
                  {isSuggestion ? (
                    <div className="w-full rounded-2xl bg-[#f8fffd] p-4 space-y-3 flex-1 min-h-0 overflow-y-auto pr-2">
                      <div className="text-[15px] font-semibold text-gray-900 leading-6">
                        {renderPhraseEmphasis(
                          String(headline || '暂无内容'),
                          patternKeyPhrase ? [patternKeyPhrase] : [],
                          `pattern-head-${insight.key}`
                        )}
                      </div>
                      {restLines.length > 0 && (
                        <div className="space-y-2">
                          {restLines.map((line, index) => {
                            const match = line.match(/^\s*(\d+)[\.\、]\s*(.+)$/);
                            if (!match) {
                              return (
                                <div key={`sug-${index}`} className="text-[15px] leading-6 font-semibold text-gray-700">
                                  {line}
                                </div>
                              );
                            }
                            return (
                              <div key={`sug-${index}`} className="flex items-start gap-2 text-[15px] leading-6 font-semibold text-gray-700">
                                <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#eef6fd] px-2 text-[11px] font-semibold text-gray-700">
                                  {match[1]}
                                </span>
                                <div className="flex-1">{match[2]}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full rounded-2xl bg-[#f8fffd] p-4 max-h-64 overflow-y-auto pr-2">
                      <div className="text-[15px] font-medium text-gray-900 leading-6">
                        {renderEmphasizedHeadline(String(headline || '暂无内容'), `headline-${insight.key}`, insight.key)}
                      </div>

                      {restLines.length > 0 && insight.key === 'change' && (
                        <div className="mt-3 space-y-2">
                          {restLines.map((line, index) => {
                            const isAnchor = line.startsWith('相比');
                            if (!isAnchor) {
                              return (
                                <div key={`trend-${index}`} className="text-[15px] leading-6 text-gray-700">
                                  {renderHighlightedText(line, `trend-${index}`)}
                                </div>
                              );
                            }
                            return (
                              <div
                                key={`trend-${index}`}
                                className="rounded-xl border border-[#d4f3ed] bg-white px-3 py-2 text-[15px] leading-6 text-gray-700"
                              >
                                <div className="flex items-start gap-2">
                                  <div className="mt-1 h-4 w-1 rounded-full bg-[#0a917a]" />
                                  <div>{renderHighlightedText(line, `trend-${index}`)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            };

            if (!activeInsights.length) {
              return (
                <div className="rounded-3xl border border-dashed border-[#b5ece0] bg-white/70 p-8 text-center text-sm text-gray-500">
                  暂无洞察，点击上方开始分析。
                </div>
              );
            }

            if (!suggestionInsight) {
              return (
                <div className="space-y-4">
                  {primaryInsights.map((insight) => renderInsightCard(insight))}
                </div>
              );
            }

            return (
              <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-4">
                  {primaryInsights.map((insight) => renderInsightCard(insight))}
                </div>
                <div className="h-full">{renderInsightCard(suggestionInsight)}</div>
              </div>
            );
          })()}
        </section>

        <section className="rounded-3xl border border-[#d4f3ed] bg-white shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="text-sm font-semibold text-gray-900">图表</div>
            <div className="flex items-center gap-2 flex-wrap">
              {chartItems.map((chart) => (
                <button
                  key={chart.key}
                  type="button"
                  onClick={() => setSelectedChartKey(chart.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    chart.key === selectedChartOrDefaultKey
                      ? 'border-[#0a917a] bg-[#e7fbf5] text-[#0a917a]'
                      : 'border-gray-200 text-gray-600 hover:border-[#6bd8c0]'
                  }`}
                >
                  {getChartLabel(chart, timePreset)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setConfigExpanded((prev) => !prev)}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-[#6bd8c0]"
            >
              {configExpanded ? '收起高级配置' : '高级配置'}
            </button>
          </div>

          {resolvedChart ? (
            <div className="rounded-2xl border border-[#c5f0e4] bg-[#f8fffd] p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="text-sm font-semibold text-gray-900">
                  {resolvedQuestion}
                </div>
                {resolvedMappingSegments?.length ? (
                  <div className="text-[11px] text-gray-500 whitespace-nowrap">
                    {resolvedMappingSegments.join(' · ')}
                  </div>
                ) : null}
              </div>
              {renderChart(resolvedChart, timePreset)}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#b5ece0] bg-[#eef6fd]/40 p-8 text-center text-sm text-gray-500">
              {noChartMessage}
            </div>
          )}

          {configExpanded && (
            <section className="relative rounded-3xl border border-[#d4f3ed] bg-white shadow-sm overflow-hidden">
              {debugLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm text-gray-600">
                  正在加载高级配置...
                </div>
              )}
              <div className="relative grid grid-cols-1 divide-y divide-gray-100 lg:grid-cols-3 lg:divide-y-0 lg:divide-x">
                <div className="p-6">
                  <div className="mb-6">
                    <h3 className="mt-0 text-sm font-semibold text-gray-900">AI 推荐图表</h3>
                    {chartItems.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {chartItems.map((candidate) => {
                          const isActive = candidate.key === selectedChartOrDefaultKey;
                          const isDefault = candidate.key === analysisResult?.charts?.defaultKey;
                          return (
                            <button
                              key={candidate.key}
                              type="button"
                              onClick={() => setSelectedChartKey(candidate.key)}
                              className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                isActive
                                  ? 'bg-[#f0fffa] text-[#0a917a] font-medium'
                                  : 'text-gray-900 hover:bg-[#f0fffa]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm">
                                  {getChartLabel(candidate, timePreset)}
                                  {isDefault ? '（默认）' : ''}
                                </span>
                                <span className="text-[11px] text-gray-400">
                                  {Math.round((candidate.confidence || 0) * 100)}%
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-500 mt-1">
                                {getChartQuestion(candidate, timePreset)}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-[#b5ece0] bg-[#eef6fd]/40 p-6 text-center text-xs text-gray-500">
                        暂无 AI 推荐图表
                      </div>
                    )}
                  </div>
                  <div className="mt-1">
                    {resolvedChart ? (
                      <div className="flex h-full flex-col rounded-2xl border border-[1.5px] border-[#d4f3ed] bg-white p-4">
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-gray-900">
                            {getChartLabel(resolvedChart, timePreset)}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">{getChartQuestion(resolvedChart, timePreset)}</p>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {getChartMappingSegments(resolvedChart, timePreset).join(' · ')}
                          </p>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">
                          覆盖率 {Math.round((resolvedChart.coverage || 0) * 100)}% · 置信度{' '}
                          {Math.round((resolvedChart.confidence || 0) * 100)}%
                        </p>
                        <div className="mt-auto">
                          <button
                            type="button"
                            onClick={() => setSelectedChartKey(resolvedChart.key)}
                            className="w-full rounded-2xl px-3 py-2 text-sm font-medium transition-colors bg-gray-900 text-white hover:bg-black"
                          >
                            选择该图表
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[#b5ece0] bg-[#eef6fd]/40 p-6 text-center text-xs text-gray-500">
                        暂无推荐图表详情
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="mt-0 text-sm font-semibold text-gray-900">字段表</h3>
                  </div>
                  <div className="mt-1 space-y-2">
                    {(debugData?.fields || []).length > 0 ? (
                      (debugData?.fields || []).map((field) => (
                        <div key={field.name} className="rounded-2xl border border-gray-200 p-3 text-xs text-gray-600">
                          <div className="font-semibold text-gray-900">{field.name}</div>
                          <div>角色：{field.role}</div>
                          <div>类型：{field.dataType}</div>
                          <div>缺失率：{Math.round((field.missingRate || 0) * 100)}%</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-[#b5ece0] bg-[#eef6fd]/40 p-6 text-center text-xs text-gray-500">
                        暂无字段信息
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  <h3 className="mt-0 text-sm font-semibold text-gray-900 mb-4">图表配置</h3>
                  <div className="space-y-4 text-xs text-gray-600">
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">
                        {resolvedChart?.type === 'pie'
                          ? '颜色/分类候选'
                          : resolvedChart?.type === 'bar'
                            ? '类别候选（X）'
                            : resolvedChart?.type === 'heatmap'
                              ? 'X 轴候选（时间）'
                              : 'X 轴候选'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(
                          resolvedChart?.type === 'pie' || resolvedChart?.type === 'bar'
                            ? (debugData?.axisSuggestions?.dim2Candidates || debugData?.axisSuggestions?.xCandidates || ['—'])
                            : (debugData?.axisSuggestions?.xCandidates || ['—'])
                        ).map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">
                        {resolvedChart?.type === 'pie'
                          ? '数值候选'
                          : resolvedChart?.type === 'heatmap'
                            ? 'Y 轴候选（分类）'
                            : resolvedChart?.type === 'bar'
                              ? '数值候选（Y）'
                              : 'Y 轴候选'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(
                          resolvedChart?.type === 'heatmap'
                            ? (debugData?.axisSuggestions?.dim2Candidates || ['—'])
                            : (debugData?.axisSuggestions?.yCandidates || ['—'])
                        ).map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    {resolvedChart?.type === 'heatmap' && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">强度候选</div>
                        <div className="flex flex-wrap gap-2">
                          {(debugData?.axisSuggestions?.yCandidates || ['—']).map((item) => (
                            <span
                              key={item}
                              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </section>
      </div>
      {renderHistoryModal()}
      {renderHistoryMatchModal()}
    </div>
  );
};

export default AnalysisV2OnDemandPage;
