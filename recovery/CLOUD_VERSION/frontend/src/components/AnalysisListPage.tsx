import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import apiClient, { getNotebooks, Notebook as ApiNotebook } from '../apiClient';
import { AnalysisResult, NotebookType } from '../types/Analysis';
import { getAnalysisUrl, getFullAnalysisUrl, getShortAnalysisId } from '../utils/analysisId';

// 分析结果项组件
const AnalysisItem = ({
  analysis,
  onAnalysisClick,
  onReanalyze,
  onShare,
  notebookName,
  notebookIdFallback
}: {
  analysis: AnalysisResult;
  onAnalysisClick: (analysisId: string) => void;
  onReanalyze?: (analysis: AnalysisResult) => void;
  onShare?: (analysis: AnalysisResult) => void;
  notebookName?: string;
  notebookIdFallback?: string;
}) => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const getNotebookTypeLabel = (type: NotebookType) => {
    const typeMap: Record<NotebookType, string> = {
      'mood': '心情分析',
      'life': '生活分析',
      'study': '学习分析',
      'work': '工作分析',
      'custom': '自定义分析'
    };
    return typeMap[type] || '未知类型';
  };

  const getNotebookTypeColor = (type: NotebookType) => {
    const colorMap = {
      'mood': 'bg-pink-100 text-pink-800',
      'life': 'bg-green-100 text-green-800',
      'study': 'bg-blue-100 text-blue-800', 
      'work': 'bg-orange-100 text-orange-800',
      'custom': 'bg-gray-100 text-gray-800'
    };
    return colorMap[type] || 'bg-gray-100 text-gray-800';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  // 安全获取字段辅助
  const rawNotebookId = notebookIdFallback
    || analysis.metadata?.dataSource?.notebookId
    || (analysis as any).notebookId
    || '';
  const getNoteCount = () => {
    const fromMeta = analysis.metadata?.dataSource?.noteIds?.length;
    if (typeof fromMeta === 'number') return fromMeta;
    const fromProcessedMeta = (analysis as any).analysisData?.componentConfigs?.chart?.processedData?.metadata?.noteCount;
    if (typeof fromProcessedMeta === 'number') return fromProcessedMeta;
    const notesArr = (analysis as any).analysisData?.processedData?.notes;
    if (Array.isArray(notesArr)) return notesArr.length;
    return undefined;
  };
  const getDateRange = () => {
    const range = analysis.metadata?.dataSource?.dateRange
      || (analysis as any).analysisData?.componentConfigs?.chart?.processedData?.metadata?.dateRange;
    if (!range) return null;
    const from = range.from || '—';
    const to = range.to || '—';
    return `${from} - ${to}`;
  };
  const getCreatedAt = () => analysis.metadata?.createdAt || (analysis as any).createdAt || '';
  const getComponentsCount = () =>
    analysis.selectedAnalysisComponents?.length 
      ?? (analysis as any).analysisData?.selectedAnalysisComponents?.length 
      ?? 0;

  const modeLabel = analysis.mode === 'ai' ? 'AI 分析' : '自定义分析';
  const modeColor = analysis.mode === 'ai'
    ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
    : 'bg-slate-100 text-slate-600 border border-slate-200';

  const displayTitle = notebookName || '分析结果';
  const idSuffix = analysis.id ? `#${getShortAnalysisId(analysis.id)}` : '';
  const componentCount = getComponentsCount();

  const metrics = [
    { label: '分析笔记', value: `${getNoteCount() ?? '—'} 条` },
    { label: '分析组件', value: `${componentCount || 0} 个` }
  ];

  const handleShare = async () => {
    if (onShare) {
      onShare(analysis);
      return;
    }
    const url = getFullAnalysisUrl(analysis.id);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        alert('分析链接已复制到剪贴板');
      } else {
        prompt('复制分析页面链接', url);
      }
    } catch (err) {
      console.error('复制链接失败:', err);
      alert('复制失败，请手动复制地址栏链接');
    }
  };

  const createdAt = getCreatedAt();
  const updatedAt =
    (analysis as any).metadata?.updatedAt ||
    (analysis as any).updatedAt ||
    createdAt;
  const formattedCreatedAt = createdAt ? formatDate(createdAt) : '—';
  const formattedUpdatedAt = updatedAt ? formatDate(updatedAt) : '—';
  const sourceLabel = notebookName
    || (analysis.metadata?.dataSource?.notebookId ? `笔记本 ${analysis.metadata.dataSource.notebookId}` : '未指定来源');
  const ownerLabel = (analysis as any).owner || (analysis as any).createdBy || '未指定负责人';
  const typeColor = analysis.notebookType ? getNotebookTypeColor(analysis.notebookType) : 'bg-slate-100 text-slate-700';

  return (
    <div className="relative rounded-lg border border-slate-200 bg-white px-4 py-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-16 h-12 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-gray-900">{displayTitle}</h3>
              {metrics.map(metric => (
                <span key={metric.label} className="inline-flex items-center gap-1 text-sm text-slate-700">
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{metric.label}</span>
                  <span className="font-medium text-purple-600">{metric.value}</span>
                </span>
              ))}
            </div>

          {analysis.selectedAnalysisComponents && analysis.selectedAnalysisComponents.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {analysis.selectedAnalysisComponents.map((component) => (
                <span
                  key={component}
                  className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-600 border border-purple-100"
                >
                  {component}
                </span>
              ))}
            </div>
          )}

          <div className="text-xs text-slate-400 flex flex-col sm:flex-row sm:items-center gap-2 mt-6">
            <div>创建时间：{formattedCreatedAt}</div>
            <div className="hidden sm:inline text-slate-300">|</div>
            <div>更新时间：{formattedUpdatedAt}</div>
          </div>
          </div>
        </div>
      </div>
      <div className="absolute top-0 right-3">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
              <div className="py-1">
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    if (onReanalyze) {
                      onReanalyze(analysis);
                    }
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  重新分析
                </button>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    await handleShare();
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  分享链接
                </button>
                <div className="border-t border-gray-100 my-1"></div>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenuOpen(false);
                    if (window.confirm('确定删除这个分析结果吗？')) {
                      try {
                        await apiClient.delete(`/api/analysis/${analysis.id}`);
                        window.dispatchEvent(new Event('analysis:refresh'));
                      } catch (error) {
                        console.error('删除失败:', error);
                        alert('删除失败，请重试');
                      }
                    }
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={() => onAnalysisClick(analysis.id)}
        className="absolute bottom-3 right-3 px-3 py-1.5 text-xs text-white bg-[#1a1a1a] rounded-lg hover:bg-[#2b2b2b] shadow-sm transition-colors"
      >
        查看详情
      </button>
    </div>
  );
};

// 分析列表页面主组件
const AnalysisListPage: React.FC = () => {
  const navigate = useNavigate();
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<NotebookType | 'all'>('all');
  const [notebookNames, setNotebookNames] = useState<Record<string, string>>({});
  
  // 下拉框状态管理
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement | null>(null);
  const typeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const typeMenuRef = useRef<HTMLDivElement | null>(null);
  const [typeMenuPos, setTypeMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 获取分析列表
  const fetchAnalyses = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.get('/api/analysis');
      console.log('📊 [AnalysisListPage] API 响应:', response.data);
      
      if (response.data && response.data.success) {
        const data = response.data.data || [];
        console.log('📊 [AnalysisListPage] 获取到分析列表:', data.length, '条');
        setAnalyses(data);
      } else {
        const errorMessage = response.data?.message || '获取分析列表失败';
        console.error('📊 [AnalysisListPage] API 返回失败:', errorMessage);
        setError(errorMessage);
      }
    } catch (error: any) {
      console.error('📊 [AnalysisListPage] 获取分析列表失败:', error);
      const errorMessage = error?.response?.data?.message 
        || error?.message 
        || '无法连接到服务器，请检查网络连接';
      console.error('📊 [AnalysisListPage] 错误详情:', {
        message: errorMessage,
        status: error?.response?.status,
        data: error?.response?.data
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadNotebookNames = async () => {
      try {
        const notebooks: ApiNotebook[] = await getNotebooks();
        const map: Record<string, string> = {};
        notebooks.forEach((notebook) => {
          if (!notebook?.notebook_id) return;
          const displayName = (notebook.name || '').trim() || (notebook.description || '').trim();
          map[notebook.notebook_id] = displayName || notebook.notebook_id;
        });
        setNotebookNames(map);
      } catch (err) {
        console.warn('加载笔记本名称失败:', err);
      }
    };
    loadNotebookNames();
  }, []);

  useEffect(() => {
    fetchAnalyses();
    
    // 监听刷新事件
    const handleRefresh = () => {
      fetchAnalyses();
    };
    
    window.addEventListener('analysis:refresh', handleRefresh);
    return () => {
      window.removeEventListener('analysis:refresh', handleRefresh);
    };
  }, []);

  // 下拉框定位逻辑
  const updateTypeMenuPos = useCallback(() => {
    if (!typeTriggerRef.current) return;
    const rect = typeTriggerRef.current.getBoundingClientRect();
    setTypeMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);

  // 点击外部关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(event.target as Node) &&
        (!typeMenuRef.current || !typeMenuRef.current.contains(event.target as Node))
      ) {
        setTypeDropdownOpen(false);
      }
    };

    if (typeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [typeDropdownOpen]);

  // 更新下拉菜单位置
  useEffect(() => {
    if (!typeDropdownOpen) {
      setTypeMenuPos(null);
      return;
    }
    updateTypeMenuPos();
    const handler = () => updateTypeMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [typeDropdownOpen, updateTypeMenuPos]);

  // 类型选项
  const typeOptions: { value: NotebookType | 'all'; label: string }[] = [
    { value: 'all', label: '所有类型' },
    { value: 'mood', label: '心情分析' },
    { value: 'life', label: '生活分析' },
    { value: 'study', label: '学习分析' },
    { value: 'work', label: '工作分析' },
  ];

  // 过滤分析结果
  const filteredAnalyses = analyses.filter(analysis => {
    const notebookType = analysis.notebookType || 'mood';
    const matchesSearch =
      analysis.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      notebookType.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || notebookType === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">加载分析列表中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={fetchAnalyses}
            className="px-4 py-2 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 页面标题和操作 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">管理分析结果</h1>
            <p className="text-gray-600 mt-1">查看和管理您的数据分析结果</p>
          </div>
          
          <button
            onClick={() => navigate('/AnalysisPage/Select')}
            className="px-6 py-3 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            新建分析
          </button>
        </div>

        {/* 搜索和过滤 */}
        <div className="rounded-xl p-[1px] mb-6 bg-gradient-to-r from-purple-100/70 via-white to-purple-100/70 shadow-[0_20px_50px_-30px_rgba(124,58,237,0.45)]">
          <div className="bg-white rounded-lg p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="搜索分析结果..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                    }
                  }}
                  className="w-full px-4 py-2 pr-10 border border-purple-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-500"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-700 transition-colors"
                  aria-label="搜索"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </button>
              </div>
              
              <div className="sm:w-48" ref={typeDropdownRef}>
                <button
                  ref={typeTriggerRef}
                  type="button"
                  onClick={() => setTypeDropdownOpen((v) => !v)}
                  className="w-full h-[48px] min-h-[48px] px-4 py-3 rounded-xl border border-purple-300 flex items-center justify-between gap-2 transition-colors bg-purple-50 text-purple-800 hover:bg-purple-100 text-[14px] leading-[20px]"
                >
                  <span className="truncate">
                    {typeOptions.find(opt => opt.value === filterType)?.label || '所有类型'}
                  </span>
                  <svg
                    className={`w-4 h-4 transition-transform flex-shrink-0 text-purple-700 ${typeDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {typeDropdownOpen && typeMenuPos && createPortal(
                  <div
                    ref={typeMenuRef}
                    className="z-[180] bg-white border border-gray-200 rounded-xl shadow-md"
                    style={{
                      position: 'fixed',
                      top: typeMenuPos.top,
                      left: typeMenuPos.left,
                      width: typeMenuPos.width,
                      background: '#ffffff',
                      backgroundImage: 'none',
                      boxShadow: '0 0 0 1px rgba(0,0,0,0.06), 0 12px 24px rgba(0,0,0,0.08)',
                      filter: 'none'
                    }}
                  >
                    <div className="p-2 max-h-[300px] overflow-y-auto bg-white">
                      {typeOptions.map((option) => {
                        const isActive = filterType === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              setFilterType(option.value);
                              setTypeDropdownOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 rounded-lg transition-colors mt-1 flex items-center gap-2 text-[14px] leading-[14px] ${
                              isActive
                                ? 'bg-purple-50 text-purple-700'
                                : 'text-gray-900 hover:bg-purple-50'
                            }`}
                          >
                            <span className={`w-4 text-sm ${isActive ? 'text-purple-600' : 'text-transparent'}`}>✓</span>
                            <span className="font-medium whitespace-nowrap">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="ml-auto text-xs text-gray-400">
                共 {filteredAnalyses.length} 个分析 · 总计 {analyses.length} 个
              </div>
            </div>
          </div>
        </div>

        {/* 分析结果列表 */}
        <div className="space-y-4">
          {filteredAnalyses.map(analysis => {
            const rawNotebookId = analysis.metadata?.dataSource?.notebookId
              || (analysis as any).notebookId
              || '';
            const resolvedName = rawNotebookId ? notebookNames[rawNotebookId] : undefined;

            return (
              <AnalysisItem 
                key={analysis.id} 
                analysis={analysis}
                notebookName={resolvedName}
                notebookIdFallback={rawNotebookId}
                onAnalysisClick={(analysisId) => {
                  navigate(getAnalysisUrl(analysisId));
                }}
                onReanalyze={(currentAnalysis) => {
                  const notebookId = currentAnalysis.metadata?.dataSource?.notebookId 
                    || (currentAnalysis as any).notebookId
                    || '';
                  if (notebookId) {
                    navigate(`/CreateNote`, { 
                      state: { 
                        sourceAnalysisId: currentAnalysis.id,
                        from: location.pathname 
                      } 
                    });
                  } else {
                    navigate('/CreateNote', { 
                      state: { 
                        sourceAnalysisId: currentAnalysis.id,
                        from: location.pathname 
                      } 
                    });
                  }
                }}
                onShare={(currentAnalysis) => {
                  const url = getFullAnalysisUrl(currentAnalysis.id);
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url)
                      .then(() => alert('分析链接已复制到剪贴板'))
                      .catch(() => alert('复制失败，请手动复制地址栏链接'));
                  } else {
                    prompt('复制分析页面链接', url);
                  }
                }}
              />
            );
          })}
          
          {filteredAnalyses.length === 0 && analyses.length > 0 && (
            <div className="text-center py-16 text-gray-500">
              <p>没有找到匹配的分析结果。</p>
            </div>
          )}

          {filteredAnalyses.length === 0 && analyses.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <p>还没有分析结果，开始创建第一个分析吧！</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalysisListPage;

