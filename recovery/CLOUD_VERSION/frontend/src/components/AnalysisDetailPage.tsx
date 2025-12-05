import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../apiClient';
import { AnalysisResult } from '../types/Analysis';
import DynamicAnalysisResult from './DynamicAnalysisResult';
import { getShortAnalysisId } from '../utils/analysisId';

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
  const [hasTriedFallback, setHasTriedFallback] = useState(false);
  
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

  const inferFallbackType = () => {
    if (analysisId === 'mood' || notebookName?.includes('心情')) return 'mood';
    if (analysisId === 'finance' || notebookName?.includes('财')) return 'finance';
    if (analysisId === 'work' || notebookName?.includes('工作')) return 'work';
    if (analysisId === 'study' || notebookName?.includes('学习')) return 'study';
    return '';
  };

  // 获取分析详情
  const fetchAnalysisDetail = async () => {
    if (!analysisId) {
      setError('分析ID不存在');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await apiClient.get(`/api/analysis/${analysisId}`);
      
      if (response.data.success) {
        setAnalysis(response.data.data);
        setError(null);
      } else {
        const fallbackType = inferFallbackType();
        if (fallbackType && !hasTriedFallback) {
          setHasTriedFallback(true);
          try {
            const fallbackResp = await apiClient.get(`/api/analysis/${fallbackType}`);
            if (fallbackResp.data?.success) {
              setAnalysis(fallbackResp.data.data);
              setError(null);
              return;
            }
          } catch (fallbackErr) {
            console.error('获取分析详情失败（fallback）:', fallbackErr);
          }
        }
        setError(response.data.message || '获取分析详情失败');
      }
    } catch (error: any) {
      console.error('获取分析详情失败:', error?.message || error);
      const fallbackType = inferFallbackType();
      if (fallbackType && !hasTriedFallback) {
        setHasTriedFallback(true);
        try {
          const fallbackResp = await apiClient.get(`/api/analysis/${fallbackType}`);
          if (fallbackResp.data?.success) {
            setAnalysis(fallbackResp.data.data);
            setError(null);
            return;
          }
        } catch (fallbackErr) {
          console.error('获取分析详情失败（fallback）:', fallbackErr);
        }
      }
      setError('获取分析详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHasTriedFallback(false);
    fetchAnalysisDetail();
  }, [analysisId]);

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
        
        // 转换为日期字符串 YYYY-MM-DD
        let dateStr = '';
        if (typeof v === 'string') {
          dateStr = v.length >= 10 ? v.slice(0, 10) : v;
        } else if (typeof v === 'number') {
          // 可能是时间戳
          const date = new Date(v);
          if (!isNaN(date.getTime())) {
            dateStr = date.toISOString().slice(0, 10);
          }
        }
        
        if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          allDates.push(dateStr);
        }
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
        const s = typeof v === 'string' ? (v.length >= 10 ? v.slice(0, 10) : v) : new Date(v).toISOString().slice(0, 10);
        return s >= fromStr && s <= toStr;
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
        onAIClick={() => {
          // 可以在这里添加AI分析相关的逻辑
          console.log('AI分析点击');
        }}
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
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
            className="px-4 py-2 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30"
          >
            返回分析列表
          </button>
        </div>
      </div>
    );
  }

  const analysisModeLabel = analysis.mode === 'ai' ? 'AI 分析' : '自定义分析';
  const formattedAnalysisName = (() => {
    const base = notebookName?.trim();
    if (base && base.length > 0) {
      const sanitized = base.replace(/(分析|分析结果|笔记本?|笔记)$/g, '') || base;
      return `${sanitized}分析`;
    }
    if (analysis.notebookType === 'mood') return '心情分析';
    if (analysis.notebookType === 'study') return '学习分析';
    if (analysis.notebookType === 'life') return '生活分析';
    if (analysis.notebookType === 'work') return '工作分析';
    return analysisModeLabel;
  })();
  
  const createdAt = analysis.metadata?.createdAt || (analysis as any).createdAt || '';
  const formattedCreatedAt = createdAt ? formatDate(createdAt) : '—';

  return (
    <div className="min-h-screen bg-transparent">
      {/* 分析详情头部 */}
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
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
                className="px-4 py-2 bg-[#1a1a1a] text-white rounded-lg text-sm whitespace-nowrap hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
              >
                查询
              </button>
              <div className="px-4 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
                笔记数：<span className="font-medium text-purple-700">{totalPoints}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // 导出功能
                  console.log('导出分析结果');
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                导出
              </button>
              
              <button
                onClick={() => {
                  // 分享功能
                  const url = `${window.location.origin}/analysis/${analysis.id}`;
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url)
                      .then(() => alert('分析链接已复制到剪贴板'))
                      .catch(() => alert('复制失败，请手动复制地址栏链接'));
                  } else {
                    prompt('复制分析页面链接', url);
                  }
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
                    navigate(`/AnalysisPage/Select/${notebookId}`, { 
                      state: { 
                        sourceAnalysisId: analysis.id,
                        from: location.pathname
                      }
                    });
                  } else {
                    navigate('/AnalysisPage/Select', { 
                      state: { 
                        sourceAnalysisId: analysis.id,
                        from: location.pathname
                      }
                    });
                  }
                }}
                className="px-4 py-2 text-sm bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
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

