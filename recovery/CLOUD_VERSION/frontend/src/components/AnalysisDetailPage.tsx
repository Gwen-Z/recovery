import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../apiClient';
import { AnalysisResult } from '../types/Analysis';
import DynamicAnalysisResult from './DynamicAnalysisResult';
import { getFullAnalysisUrl, getShortAnalysisId } from '../utils/analysisId';

const toLocalYmd = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toLocalYmdFromUnknown = (value: unknown) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return toLocalYmd(parsed);
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) return toLocalYmd(parsed);
    return '';
  }
  return '';
};

const getErrorMessage = (err: unknown, fallback: string) => {
  if (!err) return fallback;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err && 'message' in err) {
    const msg = (err as any).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
};

const copyTextToClipboard = async (text: string) => {
  const payload = String(text || '');
  if (!payload) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(payload);
      return true;
    }
  } catch {
    // ignore and fallback
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = payload;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

interface AnalysisDetailPageProps {
  analysisIdOverride?: string | null;
  notebookNameOverride?: string;
}

const AnalysisDetailPage: React.FC<AnalysisDetailPageProps> = ({ analysisIdOverride, notebookNameOverride }) => {
  const params = useParams<{ analysisId: string }>();
  const analysisId = analysisIdOverride ?? params.analysisId;
  const navigate = useNavigate();
  const location = useLocation();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [appliedRange, setAppliedRange] = useState<{ from?: string; to?: string }>({});
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 1600);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

  const notebookName = useMemo(() => {
    if (notebookNameOverride) return notebookNameOverride.trim();
    if (!analysis) return '';
    const metaName = (analysis.metadata?.dataSource as any)?.notebookName;
    const dataName = (analysis as any).analysisData?.notebookName;
    return (metaName || dataName || '').trim();
  }, [analysis, notebookNameOverride]);
  
  const notebookIdValue = useMemo(() => {
    if (!analysis) return '';
    return (
      analysis.metadata?.dataSource?.notebookId ||
      (analysis as any).notebookId ||
      (analysis as any).analysisData?.selectedNotes?.notebookId ||
      ''
    );
  }, [analysis]);

  const inferFallbackType = useCallback(
    (id: string) => {
      const nameHint = (notebookNameOverride || '').trim();
      if (id === 'mood' || nameHint.includes('心情')) return 'mood';
      if (id === 'finance' || nameHint.includes('财')) return 'finance';
      if (id === 'work' || nameHint.includes('工作')) return 'work';
      if (id === 'study' || nameHint.includes('学习')) return 'study';
      return '';
    },
    [notebookNameOverride]
  );

  // 获取分析详情
  const fetchAnalysisDetail = useCallback(async () => {
    if (!analysisId) {
      setError('分析ID不存在');
      setLoading(false);
      return;
    }

    const requestId = (requestIdRef.current += 1);
    try {
      setAnalysis(null);
      setLoading(true);
      setError(null);
      const response = await apiClient.get(`/api/analysis/${analysisId}`);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      
      if (response.data.success) {
        setAnalysis(response.data.data);
        setError(null);
      } else {
        const fallbackType = inferFallbackType(analysisId);
        if (fallbackType) {
          try {
            const fallbackResp = await apiClient.get(`/api/analysis/${fallbackType}`);
            if (!mountedRef.current || requestId !== requestIdRef.current) return;
            if (fallbackResp.data?.success) {
              setAnalysis(fallbackResp.data.data);
              setError(null);
              return;
            }
          } catch (fallbackErr) {
            console.error('获取分析详情失败（fallback）:', fallbackErr);
          }
        }
        setError(String(response.data.message || '获取分析详情失败'));
      }
    } catch (err: unknown) {
      console.error('获取分析详情失败:', err);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const fallbackType = inferFallbackType(analysisId);
      if (fallbackType) {
        try {
          const fallbackResp = await apiClient.get(`/api/analysis/${fallbackType}`);
          if (!mountedRef.current || requestId !== requestIdRef.current) return;
          if (fallbackResp.data?.success) {
            setAnalysis(fallbackResp.data.data);
            setError(null);
            return;
          }
        } catch (fallbackErr) {
          console.error('获取分析详情失败（fallback）:', fallbackErr);
        }
      }
      setError(getErrorMessage(err, '获取分析详情失败'));
    } finally {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setLoading(false);
    }
  }, [analysisId, inferFallbackType]);

  useEffect(() => {
    fetchAnalysisDetail();
  }, [fetchAnalysisDetail]);

  // 从图表数据中提取实际的日期范围
  const chartDateRange = useMemo(() => {
    if (!analysis) return { from: '', to: '' };
    const charts = (analysis.componentConfigs as any)?.chart?.chartConfigs || [];
    if (!Array.isArray(charts) || charts.length === 0) {
      // 如果没有图表数据，尝试从元数据获取
      const metaRange = analysis.metadata?.dataSource?.dateRange || (analysis as any).analysisData?.componentConfigs?.chart?.processedData?.metadata?.dateRange || {};
      return { from: metaRange?.from || '', to: metaRange?.to || '' };
    }

    const allDates: string[] = [];
    
    // 遍历所有图表，收集所有日期
    for (const ch of charts) {
      const cfg = ch?.config || {};
      const xKey = cfg?.xField || (Array.isArray(cfg?.xAxis) ? cfg.xAxis[0] : cfg?.xAxis) || 'x';
      const data = Array.isArray(ch?.data) ? ch.data : [];
      
      data.forEach((pt: any) => {
        const v = pt?.[xKey] ?? pt?.x ?? pt?.date;
        if (!v) return;

        const dateStr = toLocalYmdFromUnknown(v);
        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) allDates.push(dateStr);
      });
    }
    
    if (allDates.length === 0) {
      // 如果没有有效日期，回退到元数据
      const metaRange = analysis.metadata?.dataSource?.dateRange || (analysis as any).analysisData?.componentConfigs?.chart?.processedData?.metadata?.dateRange || {};
      return { from: metaRange?.from || '', to: metaRange?.to || '' };
    }
    
    // 找到最小和最大日期
    allDates.sort();
    const from = allDates[0];
    const to = allDates[allDates.length - 1];
    
    return { from, to };
  }, [analysis]);

  // 初始化日期范围（优先使用图表数据的实际日期范围）
  useEffect(() => {
    if (!analysis) return;
    
    // 优先使用图表数据的日期范围，如果没有则使用元数据
    const dFrom = chartDateRange.from || '';
    const dTo = chartDateRange.to || '';
    
    // 如果图表数据中有日期范围，设置到输入框和应用范围
    if (dFrom || dTo) {
      setFromDate(dFrom);
      setToDate(dTo);
      setAppliedRange({ from: dFrom, to: dTo });
    } else {
      // 如果没有图表日期范围，尝试使用元数据
      const metaRange = analysis.metadata?.dataSource?.dateRange || (analysis as any).analysisData?.componentConfigs?.chart?.processedData?.metadata?.dateRange || {};
      const metaFrom = metaRange?.from || '';
      const metaTo = metaRange?.to || '';
      if (metaFrom || metaTo) {
        setFromDate(metaFrom);
        setToDate(metaTo);
        setAppliedRange({ from: metaFrom, to: metaTo });
      }
    }
  }, [analysis, chartDateRange]);

  // 计算总数据点（所有图表 data 之和，应用过滤范围）
  const totalPoints = useMemo(() => {
    if (!analysis) return 0;
    const charts = (analysis.componentConfigs as any)?.chart?.chartConfigs || [];
    if (!Array.isArray(charts)) return 0;
    const fromStr = appliedRange.from || '0000-01-01';
    const toStr = appliedRange.to || '9999-12-31';
    let sum = 0;
    for (const ch of charts) {
      const cfg = ch?.config || {};
      const xKey = cfg?.xField || (Array.isArray(cfg?.xAxis) ? cfg.xAxis[0] : cfg?.xAxis) || 'x';
      const data = Array.isArray(ch?.data) ? ch.data : [];
      const filtered = data.filter((pt: any) => {
        const v = pt?.[xKey] ?? pt?.x ?? pt?.date;
        if (!v) return false;
        const ymd = toLocalYmdFromUnknown(v);
        if (!ymd) return false;
        return ymd >= fromStr && ymd <= toStr;
      });
      sum += filtered.length;
    }
    return sum;
  }, [analysis, appliedRange]);

  // 根据配置渲染对应的分析页面
  const renderAnalysisPage = () => {
    if (!analysis) return null;

    return (
      <DynamicAnalysisResult 
        analysisResult={analysis}
        filterDateRange={appliedRange}
        onAIClick={() => {}}
      />
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#06c3a8] mx-auto mb-4"></div>
          <p className="text-gray-600">加载分析详情中...</p>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || '分析结果不存在'}</p>
          <button 
            onClick={() => navigate('/analysis')}
            className="px-4 py-2 bg-[#06c3a8] text-white rounded-lg hover:bg-[#04b094] shadow-lg shadow-[#8de2d5]"
          >
            返回分析列表
          </button>
        </div>
      </div>
    );
  }

  const createdAt = analysis.metadata?.createdAt || (analysis as any).createdAt || '';
  const formattedCreatedAt = createdAt ? formatDate(createdAt) : '—';

  return (
    <div className="min-h-screen bg-transparent">
      {/* 分析详情头部 */}
      <div className="max-w-6xl mx-auto px-4 pt-0 pb-6 space-y-4">
        {notice && (
          <div className="rounded-xl border border-[#d4f3ed] bg-white/80 px-4 py-2 text-sm text-[#0a917a] shadow-sm">
            {notice}
          </div>
        )}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e)=>setFromDate(e.target.value)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-gray-400"
              />
              <span className="text-sm text-gray-500">至</span>
              <input
                type="date"
                value={toDate}
                onChange={(e)=>setToDate(e.target.value)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:border-gray-400"
              />
              <button
                onClick={()=>setAppliedRange({ from: fromDate || undefined, to: toDate || undefined })}
                className="px-4 py-2 bg-[#06c3a8] text-white rounded-lg text-sm whitespace-nowrap hover:bg-[#04b094] shadow-lg shadow-[#8de2d5] transition-colors"
              >
                查询
              </button>
              <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
                笔记数：<span className="font-medium text-[#0a6154]">{totalPoints}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // 导出功能
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                导出
              </button>
              
              <button
                onClick={async () => {
                  const url = getFullAnalysisUrl(analysis.id);
                  const ok = await copyTextToClipboard(url);
                  if (ok) showNotice('分析链接已复制');
                  else prompt('复制分析页面链接', url);
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                分享
              </button>
              
              <button
                onClick={() => {
                  // 重新分析功能：跳转到选择笔记本页面
                  const notebookId = analysis.metadata?.dataSource?.notebookId 
                    || (analysis as any).notebookId
                    || '';
                  if (notebookId) {
                    navigate(`/analysis/v2/${notebookId}`, { 
                      state: { 
                        sourceAnalysisId: analysis.id,
                        from: location.pathname
                      }
                    });
                  } else {
                    navigate('/analysis', { 
                      state: { 
                        sourceAnalysisId: analysis.id,
                        from: location.pathname
                      }
                    });
                  }
                }}
                className="px-4 py-2 text-sm bg-[#06c3a8] text-white rounded-lg hover:bg-[#04b094] shadow-lg shadow-[#8de2d5] transition-colors"
              >
                重新分析
              </button>
            </div>
          </div>
          
          <p className="text-xs text-gray-500">
            {formattedCreatedAt} | 笔记本：{notebookName || '未知'}（ID: {getShortAnalysisId(notebookIdValue) || '—'}）
          </p>
        </div>

        {/* 统一结构：先图表，再 AI */}
        {renderAnalysisPage()}
      </div>
    </div>
  );
};

export default AnalysisDetailPage;
