import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import apiClient, { getNotebooks, Notebook as ApiNotebook } from '../apiClient';
import { AnalysisResult, NotebookType, SelectedNotes } from '../types/Analysis';
import { getAnalysisUrl } from '../utils/analysisId';

// 分析组件类型
type AnalysisComponent = 'chart' | 'insight' | 'summary' | 'trend';

interface AnalysisComponentOption {
  id: AnalysisComponent;
  label: string;
  description: string;
  icon: string;
}

const ANALYSIS_COMPONENTS: AnalysisComponentOption[] = [
  {
    id: 'chart',
    label: '数据图表',
    description: '可视化数据趋势和分布',
    icon: '📊'
  },
  {
    id: 'insight',
    label: '智能洞察',
    description: 'AI生成的深度分析洞察',
    icon: '💡'
  },
  {
    id: 'summary',
    label: '摘要总结',
    description: '自动生成内容摘要',
    icon: '📝'
  },
  {
    id: 'trend',
    label: '趋势分析',
    description: '识别时间序列中的模式和趋势',
    icon: '📈'
  }
];

// 第一步：选择笔记本
const Step1SelectNotebook: React.FC<{
  notebooks: ApiNotebook[];
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onNext: () => void;
}> = ({ notebooks, selectedNotebookId, onSelect, onNext }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredNotebooks = notebooks.filter(notebook =>
    notebook.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    notebook.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getNotebookTypeColor = (type?: NotebookType) => {
    const colorMap: Record<NotebookType, string> = {
      'mood': 'bg-pink-100 text-pink-800 border-pink-200',
      'life': 'bg-green-100 text-green-800 border-green-200',
      'study': 'bg-blue-100 text-blue-800 border-blue-200',
      'work': 'bg-orange-100 text-orange-800 border-orange-200',
      'custom': 'bg-gray-100 text-gray-800 border-gray-200'
    };
    return colorMap[type || 'custom'] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getNotebookTypeLabel = (type?: NotebookType) => {
    const labelMap: Record<NotebookType, string> = {
      'mood': '心情',
      'life': '生活',
      'study': '学习',
      'work': '工作',
      'custom': '自定义'
    };
    return labelMap[type || 'custom'] || '自定义';
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">选择笔记本</h2>
        <p className="text-gray-600">选择要分析的笔记本</p>
      </div>

      {/* 搜索框 */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="搜索笔记本..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 pl-10 border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* 笔记本列表 */}
      <div className="space-y-3 mb-6">
        {filteredNotebooks.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>没有找到匹配的笔记本</p>
          </div>
        ) : (
          filteredNotebooks.map((notebook) => {
            const isSelected = selectedNotebookId === notebook.notebook_id;
            return (
              <button
                key={notebook.notebook_id}
                onClick={() => onSelect(notebook.notebook_id)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-purple-500 bg-purple-50 shadow-md'
                    : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 truncate">
                        {notebook.name}
                      </h3>
                      {notebook.type && (
                        <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getNotebookTypeColor(notebook.type)}`}>
                          {getNotebookTypeLabel(notebook.type)}
                        </span>
                      )}
                    </div>
                    {notebook.description && (
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {notebook.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span>📝 {notebook.note_count || 0} 条笔记</span>
                      <span>
                        {new Date(notebook.created_at).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="ml-4 flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-purple-500 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* 下一步按钮 */}
      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!selectedNotebookId}
          className={`px-6 py-3 rounded-lg font-medium transition-colors ${
            selectedNotebookId
              ? 'bg-[#1a1a1a] text-white hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          下一步
        </button>
      </div>
    </div>
  );
};

// 第二步：选择笔记和日期范围
const Step2SelectNotes: React.FC<{
  notebookId: string | null;
  notebooks: ApiNotebook[];
  selectedNoteIds: string[];
  dateRange: { from: string; to: string };
  onNotebookSelect: (notebookId: string) => void;
  onNoteToggle: (noteId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDateRangeChange: (range: { from: string; to: string }) => void;
  onBack: () => void;
  onNext: () => void;
}> = ({
  notebookId,
  notebooks,
  selectedNoteIds,
  dateRange,
  onNotebookSelect,
  onNoteToggle,
  onSelectAll,
  onDeselectAll,
  onDateRangeChange,
  onBack,
  onNext
}) => {
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notebook, setNotebook] = useState<ApiNotebook | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [notebookDropdownOpen, setNotebookDropdownOpen] = useState(false);
  const [hoveredNotebookId, setHoveredNotebookId] = useState<string | null>(null);
  const notebookDropdownRef = useRef<HTMLDivElement | null>(null);
  const notebookTriggerRef = useRef<HTMLButtonElement | null>(null);
  const notebookMenuRef = useRef<HTMLDivElement | null>(null);
  const [notebookMenuPos, setNotebookMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const loadNotes = async () => {
      if (!notebookId) {
        setLoading(false);
        setNotes([]);
        setNotebook(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const response = await apiClient.getNotes(notebookId);
        setNotes(response.notes || []);
        setNotebook(response.notebook);
      } catch (err: any) {
        console.error('加载笔记失败:', err);
        // 提取错误信息
        let errorMessage = '加载笔记失败';
        if (err.response?.data) {
          const errorData = err.response.data;
          if (typeof errorData === 'string') {
            try {
              const parsed = JSON.parse(errorData);
              errorMessage = parsed.error || parsed.message || errorMessage;
            } catch {
              errorMessage = errorData;
            }
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } else if (err.message) {
          errorMessage = err.message;
        }
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadNotes();
  }, [notebookId]);

  // 根据日期范围过滤笔记
  const filteredNotes = notes.filter(note => {
    const noteDate = new Date(note.created_at);
    const fromDate = dateRange.from ? new Date(dateRange.from) : null;
    const toDate = dateRange.to ? new Date(dateRange.to) : null;

    if (fromDate && noteDate < fromDate) return false;
    if (toDate && noteDate > toDate) return false;
    return true;
  });

  // 自动选择所有过滤后的笔记（仅在首次加载时）
  useEffect(() => {
    if (!loading && filteredNotes.length > 0 && selectedNoteIds.length === 0 && !initialLoadDone) {
      // 默认选择所有过滤后的笔记
      const allFilteredIds = filteredNotes.map(note => note.note_id);
      allFilteredIds.forEach(noteId => {
        onNoteToggle(noteId);
      });
      setInitialLoadDone(true);
    }
  }, [loading, filteredNotes.length, selectedNoteIds.length, initialLoadDone]);

  // 检查是否全选
  const isAllSelected = filteredNotes.length > 0 && filteredNotes.every(note => selectedNoteIds.includes(note.note_id));

  // 处理全选切换
  const handleSelectAllToggle = () => {
    if (isAllSelected) {
      // 取消全选
      selectedNoteIds.forEach(noteId => {
        if (filteredNotes.some(note => note.note_id === noteId)) {
          onNoteToggle(noteId);
        }
      });
    } else {
      // 全选
      filteredNotes.forEach(note => {
        if (!selectedNoteIds.includes(note.note_id)) {
          onNoteToggle(note.note_id);
        }
      });
    }
  };

  // 重置筛选
  const handleReset = () => {
    onDateRangeChange({ from: '', to: '' });
  };

  // 下拉菜单定位逻辑
  const updateNotebookMenuPos = useCallback(() => {
    if (!notebookTriggerRef.current) return;
    const rect = notebookTriggerRef.current.getBoundingClientRect();
    setNotebookMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);

  // 点击外部关闭下拉框
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

  // 更新下拉菜单位置
  useEffect(() => {
    if (!notebookDropdownOpen) {
      setNotebookMenuPos(null);
      setHoveredNotebookId(null);
      return;
    }
    updateNotebookMenuPos();
    const handler = () => updateNotebookMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [notebookDropdownOpen, updateNotebookMenuPos]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-50 to-purple-50 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">加载笔记中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-50 to-purple-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 顶部错误提示 */}
        {error && (
          <div className="w-full bg-red-50 border-2 border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-red-700">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">HTTP 500: {error}</span>
            </div>
          </div>
        )}

        {/* 选择笔记本卡片 */}
        <div className="bg-white rounded-2xl p-6 shadow-lg shadow-purple-200/50 border border-purple-100" style={{ boxShadow: '0 0 0 1px rgba(139, 92, 246, 0.1), 0 20px 25px -5px rgba(139, 92, 246, 0.1)' }}>
          <h2 className="text-xl font-bold text-gray-900 mb-4" style={{ fontSize: '18px', lineHeight: '1.6', letterSpacing: '0.2px' }}>选择笔记本</h2>
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1" ref={notebookDropdownRef}>
              <button
                ref={notebookTriggerRef}
                type="button"
                onClick={() => setNotebookDropdownOpen(!notebookDropdownOpen)}
                className={`w-full px-4 py-2 text-left rounded-full flex items-center justify-between transition-all duration-200 ${
                  notebookDropdownOpen
                    ? 'border-2 border-purple-500 shadow-md shadow-purple-200 bg-gradient-to-r from-purple-50 to-purple-100'
                    : 'border border-purple-300 bg-gradient-to-r from-purple-50/50 to-white hover:border-purple-400 hover:shadow-sm'
                }`}
                style={{ fontSize: '14px', lineHeight: '1.6', letterSpacing: '0.2px' }}
              >
                <span className={`transition-colors ${notebookDropdownOpen ? 'text-purple-700 font-medium' : 'text-purple-600'}`}>
                  {notebook ? `${notebook.name} (${notes.length}条笔记)` : notebooks.length === 0 ? '暂无笔记本，请先创建。' : '请选择笔记本'}
                </span>
                <svg
                  className={`w-4 h-4 ml-2 transition-transform duration-200 flex-shrink-0 ${notebookDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  style={{ color: notebookDropdownOpen ? '#9333ea' : '#a855f7' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {notebookDropdownOpen && notebookMenuPos && createPortal(
                <div
                  ref={notebookMenuRef}
                  className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                  style={{
                    position: 'fixed',
                    top: notebookMenuPos.top,
                    left: notebookMenuPos.left,
                    width: notebookMenuPos.width,
                    maxHeight: '300px',
                    overflowY: 'auto',
                    boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                  }}
                >
                  <div className="p-2">
                    {notebooks.length === 0 ? (
                      <div className="px-4 py-3 text-gray-500 text-center" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                        暂无笔记本，请先创建。
                      </div>
                    ) : (
                      notebooks.map((nb) => {
                        const isSelected = notebook?.notebook_id === nb.notebook_id;
                        const isHovered = hoveredNotebookId === nb.notebook_id;
                        const shouldHighlight = isHovered || (!hoveredNotebookId && isSelected);
                        // 如果当前选中的笔记本，使用实际加载的笔记数量；否则使用 note_count
                        const noteCount = isSelected ? notes.length : (nb.note_count || 0);
                        return (
                          <button
                            key={nb.notebook_id}
                            type="button"
                            onClick={() => {
                              onNotebookSelect(nb.notebook_id);
                              setNotebookDropdownOpen(false);
                              setHoveredNotebookId(null);
                            }}
                            onMouseEnter={() => setHoveredNotebookId(nb.notebook_id)}
                            onMouseLeave={() => setHoveredNotebookId(null)}
                            className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                              shouldHighlight
                                ? 'bg-purple-50 text-purple-700 font-medium'
                                : 'text-gray-900 hover:bg-purple-50'
                            }`}
                            style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                          >
                            <div className="flex items-center justify-between">
                              <span>{nb.name}</span>
                              <span className="text-gray-500 ml-2" style={{ fontSize: '12px' }}>({noteCount}条笔记)</span>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>,
                document.body
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-gray-600 whitespace-nowrap" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>高级筛选</span>
              <button
                onClick={() => setAdvancedFilterOpen(!advancedFilterOpen)}
                className="px-4 py-2 font-medium text-purple-700 bg-white rounded-lg hover:bg-purple-50 transition-colors border border-purple-200 whitespace-nowrap"
                style={{ fontSize: '13px', lineHeight: '1.4', letterSpacing: '0.2px' }}
              >
                更多筛选
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap"
                style={{ fontSize: '13px', lineHeight: '1.4', letterSpacing: '0.2px' }}
              >
                重置
              </button>
              <button
                onClick={() => setAdvancedFilterOpen(!advancedFilterOpen)}
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
              >
                <svg className={`w-5 h-5 transition-transform ${advancedFilterOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* 高级筛选展开区域 */}
          {advancedFilterOpen && notebook && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>开始日期</label>
                  <input
                    type="date"
                    value={dateRange.from}
                    onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.1px' }}
                  />
                </div>
                <div>
                  <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>结束日期</label>
                  <input
                    type="date"
                    value={dateRange.to}
                    onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.1px' }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 笔记列表卡片 */}
        <div className="bg-white rounded-2xl p-6 shadow-lg shadow-purple-200/50 border border-purple-100" style={{ boxShadow: '0 0 0 1px rgba(139, 92, 246, 0.1), 0 20px 25px -5px rgba(139, 92, 246, 0.1)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900" style={{ fontSize: '18px', lineHeight: '1.6', letterSpacing: '0.2px' }}>笔记列表</h3>
            <div className="flex items-center gap-6" style={{ fontSize: '12px', lineHeight: '1.4', letterSpacing: '0.2px' }}>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">已选择:</span>
                <span className="font-bold text-purple-600">{selectedNoteIds.length}</span>
                <span className="text-gray-400">条</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">筛选后:</span>
                <span className="font-bold text-purple-600">{filteredNotes.length}</span>
                <span className="text-gray-400">条</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">总计:</span>
                <span className="font-bold text-purple-600">{notes.length}</span>
                <span className="text-gray-400">条</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleSelectAllToggle}
                    disabled={filteredNotes.length === 0}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 rounded-full transition-colors ${
                    filteredNotes.length === 0
                      ? 'bg-gray-300 cursor-not-allowed'
                      : isAllSelected
                        ? 'bg-purple-600'
                        : 'bg-gray-300'
                  }`}>
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform mt-0.5 ml-0.5 ${
                      isAllSelected
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}></div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* 笔记列表 */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredNotes.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="mb-4">暂无笔记，请先创建。</p>
                {!notebook && (
                  <button
                    onClick={onBack}
                    className="px-4 py-2 text-sm text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors border border-purple-200"
                  >
                    去创建笔记本
                  </button>
                )}
              </div>
            ) : (
              filteredNotes.map((note) => {
                const isSelected = selectedNoteIds.includes(note.note_id);
                return (
                  <button
                    key={note.note_id}
                    onClick={() => onNoteToggle(note.note_id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-purple-500 bg-purple-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-purple-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isSelected
                          ? 'border-purple-500 bg-purple-500'
                          : 'border-gray-300 bg-white'
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 mb-2 truncate" style={{ fontSize: '14px', lineHeight: '1.7', letterSpacing: '0.2px' }}>
                          {note.title || '无标题'}
                        </h4>
                        <div className="text-gray-500" style={{ fontSize: '12px', lineHeight: '1.6', letterSpacing: '0.1px' }}>
                          {formatDate(note.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="flex justify-end gap-4">
          <button
            onClick={onBack}
            className="px-6 py-3 rounded-full font-medium text-purple-700 bg-white border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors"
            style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
          >
            返回
          </button>
          <button
            onClick={onNext}
            disabled={selectedNoteIds.length === 0}
            className={`px-6 py-3 rounded-full font-medium transition-colors ${
              selectedNoteIds.length > 0
                ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-500/30'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
          >
            开始智能分析 ({selectedNoteIds.length} 条笔记)
          </button>
        </div>
      </div>
    </div>
  );
};

// 第三步：分析配置页面
const Step3SelectMode: React.FC<{
  selectedComponents: AnalysisComponent[];
  onComponentToggle: (component: AnalysisComponent) => void;
  mode: 'ai' | 'custom';
  onModeChange: (mode: 'ai' | 'custom') => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  notebookId: string | null;
  selectedNoteIds: string[];
  dateRange: { from: string; to: string };
}> = ({
  selectedComponents,
  onComponentToggle,
  mode,
  onModeChange,
  onBack,
  onSubmit,
  isSubmitting,
  notebookId,
  selectedNoteIds,
  dateRange
}) => {
  // 图表配置状态
  const [enabledChart, setEnabledChart] = useState(selectedComponents.includes('chart'));
  const [openChart, setOpenChart] = useState(false);
  const [currentChartType, setCurrentChartType] = useState<'line' | 'bar' | 'pie' | 'scatter' | 'area'>('line');
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentXAxis, setCurrentXAxis] = useState('');
  const [currentYAxis, setCurrentYAxis] = useState('');
  const [currentPointField, setCurrentPointField] = useState('');
  const [currentTooltipFields, setCurrentTooltipFields] = useState<string[]>([]);
  
  // AI配置状态
  const [enabledAI, setEnabledAI] = useState(selectedComponents.includes('insight'));
  const [openAI, setOpenAI] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(`你是一名个人笔记分析助手。请基于用户选定的笔记内容和其中记录的字段，输出以下三部分：

1. 一句话总结：以"所选笔记主要描述……"开头，概括笔记的核心主题或结论。
2. 笔记要点：列出 2‑3 条最重要的信息、结论或数据支撑。
3. 延伸方向：给出 1‑2 个可继续探索或实践的相关思路、问题或行动建议。`);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptTemplate, setPromptTemplate] = useState('');
  const [promptTitle, setPromptTitle] = useState('通用分析');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [promptTitleDropdownOpen, setPromptTitleDropdownOpen] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<Array<{ id: string; title: string; content: string }>>([
    { id: 'default', title: '通用分析', content: `你是一名个人笔记分析助手。请基于用户选定的笔记内容和其中记录的字段，输出以下三部分：

1. 一句话总结：以"所选笔记主要描述……"开头，概括笔记的核心主题或结论。
2. 笔记要点：列出 2‑3 条最重要的信息、结论或数据支撑。
3. 延伸方向：给出 1‑2 个可继续探索或实践的相关思路、问题或行动建议。` }
  ]);
  const [currentTemplateId, setCurrentTemplateId] = useState('default');
  
  // 字段相关状态
  const [existingFields, setExistingFields] = useState<Array<{ name: string; type: string; selectable: boolean }>>([]);
  const [customFields, setCustomFields] = useState<Array<{ name: string; type: string; origin: string }>>([]);
  const [customFieldName, setCustomFieldName] = useState('');
  const [customFieldType, setCustomFieldType] = useState<'string' | 'number' | 'date' | 'boolean'>('string');
  const [isGeneratingField, setIsGeneratingField] = useState(false);
  
  // X轴下拉菜单状态
  const [xAxisDropdownOpen, setXAxisDropdownOpen] = useState(false);
  const [hoveredXAxisOption, setHoveredXAxisOption] = useState<string | null>(null);
  const xAxisDropdownRef = useRef<HTMLDivElement | null>(null);
  const xAxisTriggerRef = useRef<HTMLButtonElement | null>(null);
  const xAxisMenuRef = useRef<HTMLDivElement | null>(null);
  const [xAxisMenuPos, setXAxisMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Y轴下拉菜单状态
  const [yAxisDropdownOpen, setYAxisDropdownOpen] = useState(false);
  const [hoveredYAxisOption, setHoveredYAxisOption] = useState<string | null>(null);
  const yAxisDropdownRef = useRef<HTMLDivElement | null>(null);
  const yAxisTriggerRef = useRef<HTMLButtonElement | null>(null);
  const yAxisMenuRef = useRef<HTMLDivElement | null>(null);
  const [yAxisMenuPos, setYAxisMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 数据点下拉菜单状态
  const [pointDropdownOpen, setPointDropdownOpen] = useState(false);
  const [hoveredPointOption, setHoveredPointOption] = useState<string | null>(null);
  const pointDropdownRef = useRef<HTMLDivElement | null>(null);
  const pointTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pointMenuRef = useRef<HTMLDivElement | null>(null);
  const [pointMenuPos, setPointMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 悬浮提示下拉菜单状态
  const [tooltipDropdownOpen, setTooltipDropdownOpen] = useState(false);
  const [hoveredTooltipOption, setHoveredTooltipOption] = useState<string | null>(null);
  const tooltipDropdownRef = useRef<HTMLDivElement | null>(null);
  const tooltipTriggerRef = useRef<HTMLButtonElement | null>(null);
  const tooltipMenuRef = useRef<HTMLDivElement | null>(null);
  const [tooltipMenuPos, setTooltipMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // 自定义字段类型下拉菜单状态
  const [customFieldTypeDropdownOpen, setCustomFieldTypeDropdownOpen] = useState(false);
  const customFieldTypeButtonRef = useRef<HTMLButtonElement>(null);
  const [customFieldTypeMenuPos, setCustomFieldTypeMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  
  const chartTypeLabelMap: Record<string, string> = {
    line: '折线图',
    bar: '柱状图',
    pie: '饼图',
    scatter: '散点图',
    area: '面积图'
  };
  
  const customFieldTypeOptions = [
    { value: 'string', label: '文本' },
    { value: 'number', label: '数字' },
    { value: 'date', label: '日期' },
    { value: 'boolean', label: '布尔值' }
  ];
  
  // 获取字段显示名称
  const getFieldDisplayName = (value: string): string => {
    if (!value) return '';
    const field = existingFields.find(f => f.name === value);
    if (field) return field.name;
    const custom = customFields.find(f => f.name === value);
    if (custom) return custom.name;
    return value;
  };
  
  // 获取坐标轴选项
  const getAxisOptions = useCallback(() => {
    const options: Array<{ value: string; label: string }> = [];
    existingFields.filter(f => f.selectable).forEach(f => {
      options.push({ value: f.name, label: f.name });
    });
    customFields.forEach(f => {
      options.push({ value: f.name, label: f.name });
    });
    return options;
  }, [existingFields, customFields]);
  
  // X轴下拉菜单定位逻辑
  const updateXAxisMenuPos = useCallback(() => {
    if (!xAxisTriggerRef.current) return;
    const rect = xAxisTriggerRef.current.getBoundingClientRect();
    setXAxisMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);

  // Y轴下拉菜单定位逻辑
  const updateYAxisMenuPos = useCallback(() => {
    if (!yAxisTriggerRef.current) return;
    const rect = yAxisTriggerRef.current.getBoundingClientRect();
    setYAxisMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);

  // 数据点下拉菜单定位逻辑
  const updatePointMenuPos = useCallback(() => {
    if (!pointTriggerRef.current) return;
    const rect = pointTriggerRef.current.getBoundingClientRect();
    setPointMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);

  // 悬浮提示下拉菜单定位逻辑
  const updateTooltipMenuPos = useCallback(() => {
    if (!tooltipTriggerRef.current) return;
    const rect = tooltipTriggerRef.current.getBoundingClientRect();
    setTooltipMenuPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width
    });
  }, []);
  
  // X轴下拉菜单：点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        xAxisDropdownRef.current &&
        !xAxisDropdownRef.current.contains(event.target as Node) &&
        (!xAxisMenuRef.current || !xAxisMenuRef.current.contains(event.target as Node))
      ) {
        setXAxisDropdownOpen(false);
      }
    };
    if (xAxisDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [xAxisDropdownOpen]);

  // X轴下拉菜单：更新位置
  useEffect(() => {
    if (!xAxisDropdownOpen) {
      setXAxisMenuPos(null);
      setHoveredXAxisOption(null);
      return;
    }
    updateXAxisMenuPos();
    const handler = () => updateXAxisMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [xAxisDropdownOpen, updateXAxisMenuPos]);

  // Y轴下拉菜单：点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        yAxisDropdownRef.current &&
        !yAxisDropdownRef.current.contains(event.target as Node) &&
        (!yAxisMenuRef.current || !yAxisMenuRef.current.contains(event.target as Node))
      ) {
        setYAxisDropdownOpen(false);
      }
    };
    if (yAxisDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [yAxisDropdownOpen]);

  // Y轴下拉菜单：更新位置
  useEffect(() => {
    if (!yAxisDropdownOpen) {
      setYAxisMenuPos(null);
      setHoveredYAxisOption(null);
      return;
    }
    updateYAxisMenuPos();
    const handler = () => updateYAxisMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [yAxisDropdownOpen, updateYAxisMenuPos]);

  // 数据点下拉菜单：点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pointDropdownRef.current &&
        !pointDropdownRef.current.contains(event.target as Node) &&
        (!pointMenuRef.current || !pointMenuRef.current.contains(event.target as Node))
      ) {
        setPointDropdownOpen(false);
      }
    };
    if (pointDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [pointDropdownOpen]);

  // 数据点下拉菜单：更新位置
  useEffect(() => {
    if (!pointDropdownOpen) {
      setPointMenuPos(null);
      setHoveredPointOption(null);
      return;
    }
    updatePointMenuPos();
    const handler = () => updatePointMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [pointDropdownOpen, updatePointMenuPos]);

  // 悬浮提示下拉菜单：点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipDropdownRef.current &&
        !tooltipDropdownRef.current.contains(event.target as Node) &&
        (!tooltipMenuRef.current || !tooltipMenuRef.current.contains(event.target as Node))
      ) {
        setTooltipDropdownOpen(false);
      }
    };
    if (tooltipDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [tooltipDropdownOpen]);

  // 悬浮提示下拉菜单：更新位置
  useEffect(() => {
    if (!tooltipDropdownOpen) {
      setTooltipMenuPos(null);
      setHoveredTooltipOption(null);
      return;
    }
    updateTooltipMenuPos();
    const handler = () => updateTooltipMenuPos();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [tooltipDropdownOpen, updateTooltipMenuPos]);

  // 点击外部关闭标题下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (promptTitleDropdownOpen) {
        const dropdown = document.querySelector('[data-prompt-title-dropdown]');
        if (dropdown && !dropdown.contains(target)) {
          setPromptTitleDropdownOpen(false);
        }
      }
    };
    if (promptTitleDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [promptTitleDropdownOpen]);

  // 加载笔记本字段
  useEffect(() => {
    const loadFields = async () => {
      if (!notebookId) return;
      try {
        const response = await apiClient.get(`/api/notebooks/${notebookId}`);
        if (response.data?.success && response.data?.notebook?.component_config) {
          const config = response.data.notebook.component_config;
          const instances = config.componentInstances || [];
          const fields = instances.map((inst: any) => ({
            name: inst.title || inst.type,
            type: inst.type || 'string',
            selectable: ['number', 'date', 'text-short', 'text-long'].includes(inst.type)
          }));
          setExistingFields(fields);
        }
      } catch (error) {
        console.error('加载字段失败:', error);
      }
    };
    loadFields();
  }, [notebookId]);
  
  // 监听组件选择变化
  useEffect(() => {
    setEnabledChart(selectedComponents.includes('chart'));
    setEnabledAI(selectedComponents.includes('insight'));
  }, [selectedComponents]);
  
  // 图表类型变化处理
  const handleChartTypeChange = (type: 'line' | 'bar' | 'pie' | 'scatter' | 'area') => {
    setCurrentChartType(type);
  };
  
  // AI生成字段
  const handleGenerateField = async () => {
    if (!customFieldName.trim() && customFields.length === 0) {
      alert('请输入字段名称或描述');
      return;
    }
    setIsGeneratingField(true);
    try {
      // 模拟AI生成字段
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newField = {
        name: customFieldName.trim() || `AI字段${customFields.length + 1}`,
        type: customFieldType,
        origin: 'ai-generated'
      };
      setCustomFields(prev => [...prev, newField]);
      setCustomFieldName('');
    } catch (error) {
      console.error('生成字段失败:', error);
      alert('生成字段失败，请重试');
    } finally {
      setIsGeneratingField(false);
    }
  };
  
  // 删除自定义字段
  const handleRemoveCustomField = (name: string) => {
    setCustomFields(prev => prev.filter(f => f.name !== name));
    if (currentXAxis === name) setCurrentXAxis('');
    if (currentYAxis === name) setCurrentYAxis('');
    if (currentPointField === name) setCurrentPointField('');
    setCurrentTooltipFields(prev => prev.filter(f => f !== name));
  };
  
  // 保存图表配置
  const handleSaveChartConfig = async () => {
    if (!notebookId) {
      alert('请先选择笔记本');
      return;
    }
    try {
      const config = {
        notebook_id: notebookId,
        chart_config: {
          chartType: currentChartType,
          title: currentTitle,
          xAxisField: currentXAxis,
          yAxisField: currentYAxis,
          dataPointField: currentPointField || undefined,
          hoverCardFields: currentTooltipFields
        },
        custom_fields: customFields,
        analysis_components: enabledChart ? ['chart'] : []
      };
      await apiClient.post('/api/ai-analysis-config', config);
      alert('图表配置已保存！');
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败，请重试');
    }
  };
  
  // 保存AI配置
  const handleSaveAIConfig = async () => {
    if (!notebookId) {
      alert('请先选择笔记本');
      return;
    }
    try {
      const config = {
        notebook_id: notebookId,
        custom_prompt: customPrompt,
        analysis_components: enabledAI ? ['ai-custom'] : []
      };
      await apiClient.post('/api/ai-analysis-config', config);
      alert('AI配置已保存！');
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败，请重试');
    }
  };
  
  const axisOptions = getAxisOptions();
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-50 to-purple-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* 配置选择区域 */}
        <div className="space-y-4">
          {/* 图表分析配置 */}
          <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 transition-colors ${enabledChart ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-100' : 'bg-white border-gray-200'}`}>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 accent-purple-600"
                checked={enabledChart}
                onChange={(e) => {
                  setEnabledChart(e.target.checked);
                  if (e.target.checked && !selectedComponents.includes('chart')) {
                    onComponentToggle('chart');
                  } else if (!e.target.checked && selectedComponents.includes('chart')) {
                    onComponentToggle('chart');
                  }
                }}
              />
              <span className={`text-sm font-medium ${enabledChart ? 'text-purple-700' : 'text-gray-700'}`} style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                📈 图表分析配置
              </span>
            </label>
            <button
              type="button"
              onClick={() => setOpenChart(v => !v)}
              className="p-2 text-gray-500 hover:text-gray-700"
            >
              <svg className={`w-5 h-5 transition-transform ${openChart ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          
          {openChart && (
            <div className="bg-white rounded-2xl p-6 shadow-lg shadow-purple-200/50 border border-purple-100 space-y-6" style={{ boxShadow: '0 0 0 1px rgba(139, 92, 246, 0.1), 0 20px 25px -5px rgba(139, 92, 246, 0.1)' }}>
              {/* 步骤一：选择图表类型 */}
              <div>
                <div className="mb-4">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-[#1a1a1a] px-3 py-1 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
                    <span>📊</span>
                    <span>步骤一：选择分析图表</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {(['line', 'bar', 'pie', 'scatter', 'area'] as const).map((t) => {
                    const isSelected = currentChartType === t;
                    return (
                      <button
                        key={t}
                        onClick={() => handleChartTypeChange(t)}
                        className={`px-3 py-2 rounded-lg border text-xs transition-all ${
                          isSelected
                            ? 'border-purple-400 bg-white text-gray-800 shadow-sm shadow-purple-200/60'
                            : 'border-purple-200 bg-white text-gray-700 hover:border-purple-400'
                        }`}
                        style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.1px' }}
                      >
                        {chartTypeLabelMap[t] || t}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              {/* 步骤二：选择字段 */}
              <div>
                <div className="mb-4">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-[#1a1a1a] px-3 py-1 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
                    <span>📋</span>
                    <span>步骤二：选择图表字段</span>
                  </div>
                </div>
                
                {/* 现有字段 */}
                <div className="mb-4">
                  <div className="text-xs text-purple-800 inline-flex items-center px-2 py-1 rounded-full border border-purple-400 bg-[#F3E8FF] w-fit mb-2">
                    现有字段（来自笔记本配置）
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {existingFields.length === 0 ? (
                      <span className="text-xs text-gray-400" style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.1px' }}>
                        暂无可用字段，请在笔记本配置中添加记录组件
                      </span>
                    ) : (
                      existingFields.map((f) => (
                        <span
                          key={f.name}
                          className={`px-2 py-1 text-[10px] rounded-full border ${
                            f.selectable ? 'bg-white text-gray-700 border-purple-400' : 'bg-gray-50 text-gray-400 border-gray-200 line-through'
                          }`}
                        >
                          {f.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                
                {/* AI自定义字段 */}
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-purple-800 inline-flex items-center px-2 py-1 rounded-full border border-purple-400 bg-[#F3E8FF]">
                      AI 自定义字段
                    </span>
                  </div>
                  <div className="flex flex-col md:flex-row gap-3 items-start">
                    <input
                      type="text"
                      value={customFieldName}
                      onChange={(e) => setCustomFieldName(e.target.value)}
                      placeholder="告诉 AI 想要生成的字段，或直接输入字段名称"
                      className="flex-1 px-3 py-2 text-xs bg-white border border-purple-300 rounded-lg focus:outline-none focus:border-purple-400"
                      style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.1px' }}
                    />
                    <div className="relative w-28 flex-shrink-0">
                      <button
                        ref={customFieldTypeButtonRef}
                        type="button"
                        onClick={() => {
                          setCustomFieldTypeDropdownOpen(v => {
                            const next = !v;
                            if (next) {
                              requestAnimationFrame(() => {
                                if (customFieldTypeButtonRef.current) {
                                  const rect = customFieldTypeButtonRef.current.getBoundingClientRect();
                                  setCustomFieldTypeMenuPos({
                                    top: rect.bottom + 8,
                                    left: rect.left,
                                    width: rect.width
                                  });
                                }
                              });
                            }
                            return next;
                          });
                        }}
                        className="w-full px-3 py-2 text-xs border border-purple-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:border-purple-400 flex items-center justify-between gap-2 transition-colors bg-purple-50 text-purple-800"
                      >
                        <span className="truncate">
                          {customFieldType === 'string' ? '文本' : customFieldType === 'number' ? '数字' : customFieldType === 'date' ? '日期' : '布尔值'}
                        </span>
                        <svg
                          className={`w-4 h-4 transition-transform flex-shrink-0 text-purple-700 ${customFieldTypeDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {customFieldTypeDropdownOpen && customFieldTypeMenuPos && createPortal(
                        <div
                          className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                          style={{
                            position: 'fixed',
                            top: customFieldTypeMenuPos.top,
                            left: customFieldTypeMenuPos.left,
                            width: customFieldTypeMenuPos.width,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                          }}
                        >
                          <div className="p-2">
                            {customFieldTypeOptions.map((option) => {
                              const isSelected = customFieldType === option.value;
                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => {
                                    setCustomFieldType(option.value as any);
                                    setCustomFieldTypeDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                    isSelected
                                      ? 'bg-purple-50 text-purple-700 font-medium'
                                      : 'text-gray-900 hover:bg-purple-50'
                                  }`}
                                  style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateField}
                      disabled={isGeneratingField}
                      className={`px-4 py-2 text-xs font-medium rounded-xl text-white transition-all ${
                        isGeneratingField
                          ? 'bg-purple-600 opacity-75 cursor-not-allowed'
                          : 'bg-purple-600 hover:bg-purple-700'
                      }`}
                      style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                    >
                      {isGeneratingField ? 'AI 生成中…' : 'AI 生成'}
                    </button>
                  </div>
                  {customFields.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {customFields.map((field) => (
                        <span
                          key={field.name}
                          className="px-2 py-1 text-[10px] rounded-full border bg-white text-gray-700 border-purple-400 leading-normal"
                        >
                          {field.name}
                          <span
                            onClick={() => handleRemoveCustomField(field.name)}
                            className="text-purple-500 hover:text-purple-700 cursor-pointer ml-1"
                            title="删除此字段"
                          >
                            ×
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* 步骤三：坐标轴配置 */}
              <div>
                <div className="mb-4">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-[#1a1a1a] px-3 py-1 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
                    <span>⚙️</span>
                    <span>步骤三：坐标轴与显示</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* X 轴下拉框 */}
                  <div>
                    <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                      X 轴
                    </label>
                    <div className="relative flex-1" ref={xAxisDropdownRef}>
                      <button
                        ref={xAxisTriggerRef}
                        type="button"
                        onClick={() => setXAxisDropdownOpen(!xAxisDropdownOpen)}
                        className={`w-full px-4 py-2 text-left rounded-full flex items-center justify-between transition-all duration-200 ${
                          xAxisDropdownOpen
                            ? 'border-2 border-purple-500 shadow-md shadow-purple-200 bg-gradient-to-r from-purple-50 to-purple-100'
                            : 'border border-purple-300 bg-gradient-to-r from-purple-50/50 to-white hover:border-purple-400 hover:shadow-sm'
                        }`}
                        style={{ fontSize: '14px', lineHeight: '1.6', letterSpacing: '0.2px' }}
                      >
                        <span className={`transition-colors ${xAxisDropdownOpen ? 'text-purple-700 font-medium' : 'text-purple-600'}`}>
                          {currentXAxis ? getFieldDisplayName(currentXAxis) : '选择字段...'}
                        </span>
                        <svg
                          className={`w-4 h-4 ml-2 transition-transform duration-200 flex-shrink-0 ${xAxisDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                          style={{ color: xAxisDropdownOpen ? '#9333ea' : '#a855f7' }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {xAxisDropdownOpen && xAxisMenuPos && createPortal(
                        <div
                          ref={xAxisMenuRef}
                          className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                          style={{
                            position: 'fixed',
                            top: xAxisMenuPos.top,
                            left: xAxisMenuPos.left,
                            width: xAxisMenuPos.width,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                          }}
                        >
                          <div className="p-2">
                            {axisOptions.length === 0 ? (
                              <div className="px-4 py-3 text-gray-500 text-center" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                                暂无可用字段
                              </div>
                            ) : (
                              axisOptions.map((option) => {
                                const isSelected = currentXAxis === option.value;
                                const isHovered = hoveredXAxisOption === option.value;
                                const shouldHighlight = isHovered || (!hoveredXAxisOption && isSelected);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      setCurrentXAxis(option.value);
                                      setXAxisDropdownOpen(false);
                                      setHoveredXAxisOption(null);
                                    }}
                                    onMouseEnter={() => setHoveredXAxisOption(option.value)}
                                    onMouseLeave={() => setHoveredXAxisOption(null)}
                                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                      shouldHighlight
                                        ? 'bg-purple-50 text-purple-700 font-medium'
                                        : 'text-gray-900 hover:bg-purple-50'
                                    }`}
                                    style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  {/* Y 轴下拉框 */}
                  <div>
                    <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                      Y 轴
                    </label>
                    <div className="relative flex-1" ref={yAxisDropdownRef}>
                      <button
                        ref={yAxisTriggerRef}
                        type="button"
                        onClick={() => setYAxisDropdownOpen(!yAxisDropdownOpen)}
                        className={`w-full px-4 py-2 text-left rounded-full flex items-center justify-between transition-all duration-200 ${
                          yAxisDropdownOpen
                            ? 'border-2 border-purple-500 shadow-md shadow-purple-200 bg-gradient-to-r from-purple-50 to-purple-100'
                            : 'border border-purple-300 bg-gradient-to-r from-purple-50/50 to-white hover:border-purple-400 hover:shadow-sm'
                        }`}
                        style={{ fontSize: '14px', lineHeight: '1.6', letterSpacing: '0.2px' }}
                      >
                        <span className={`transition-colors ${yAxisDropdownOpen ? 'text-purple-700 font-medium' : 'text-purple-600'}`}>
                          {currentYAxis ? getFieldDisplayName(currentYAxis) : '选择字段...'}
                        </span>
                        <svg
                          className={`w-4 h-4 ml-2 transition-transform duration-200 flex-shrink-0 ${yAxisDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                          style={{ color: yAxisDropdownOpen ? '#9333ea' : '#a855f7' }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {yAxisDropdownOpen && yAxisMenuPos && createPortal(
                        <div
                          ref={yAxisMenuRef}
                          className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                          style={{
                            position: 'fixed',
                            top: yAxisMenuPos.top,
                            left: yAxisMenuPos.left,
                            width: yAxisMenuPos.width,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                          }}
                        >
                          <div className="p-2">
                            {axisOptions.length === 0 ? (
                              <div className="px-4 py-3 text-gray-500 text-center" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                                暂无可用字段
                              </div>
                            ) : (
                              axisOptions.map((option) => {
                                const isSelected = currentYAxis === option.value;
                                const isHovered = hoveredYAxisOption === option.value;
                                const shouldHighlight = isHovered || (!hoveredYAxisOption && isSelected);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      setCurrentYAxis(option.value);
                                      setYAxisDropdownOpen(false);
                                      setHoveredYAxisOption(null);
                                    }}
                                    onMouseEnter={() => setHoveredYAxisOption(option.value)}
                                    onMouseLeave={() => setHoveredYAxisOption(null)}
                                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                      shouldHighlight
                                        ? 'bg-purple-50 text-purple-700 font-medium'
                                        : 'text-gray-900 hover:bg-purple-50'
                                    }`}
                                    style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  {/* 数据点下拉框 */}
                  <div>
                    <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                      数据点
                    </label>
                    <div className="relative flex-1" ref={pointDropdownRef}>
                      <button
                        ref={pointTriggerRef}
                        type="button"
                        onClick={() => setPointDropdownOpen(!pointDropdownOpen)}
                        className={`w-full px-4 py-2 text-left rounded-full flex items-center justify-between transition-all duration-200 ${
                          pointDropdownOpen
                            ? 'border-2 border-purple-500 shadow-md shadow-purple-200 bg-gradient-to-r from-purple-50 to-purple-100'
                            : 'border border-purple-300 bg-gradient-to-r from-purple-50/50 to-white hover:border-purple-400 hover:shadow-sm'
                        }`}
                        style={{ fontSize: '14px', lineHeight: '1.6', letterSpacing: '0.2px' }}
                      >
                        <span className={`transition-colors ${pointDropdownOpen ? 'text-purple-700 font-medium' : 'text-purple-600'}`}>
                          {currentPointField ? getFieldDisplayName(currentPointField) : '选择字段...'}
                        </span>
                        <svg
                          className={`w-4 h-4 ml-2 transition-transform duration-200 flex-shrink-0 ${pointDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                          style={{ color: pointDropdownOpen ? '#9333ea' : '#a855f7' }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {pointDropdownOpen && pointMenuPos && createPortal(
                        <div
                          ref={pointMenuRef}
                          className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                          style={{
                            position: 'fixed',
                            top: pointMenuPos.top,
                            left: pointMenuPos.left,
                            width: pointMenuPos.width,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                          }}
                        >
                          <div className="p-2">
                            {axisOptions.length === 0 ? (
                              <div className="px-4 py-3 text-gray-500 text-center" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                                暂无可用字段
                              </div>
                            ) : (
                              axisOptions.map((option) => {
                                const isSelected = currentPointField === option.value;
                                const isHovered = hoveredPointOption === option.value;
                                const shouldHighlight = isHovered || (!hoveredPointOption && isSelected);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                      setCurrentPointField(option.value);
                                      setPointDropdownOpen(false);
                                      setHoveredPointOption(null);
                                    }}
                                    onMouseEnter={() => setHoveredPointOption(option.value)}
                                    onMouseLeave={() => setHoveredPointOption(null)}
                                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                      shouldHighlight
                                        ? 'bg-purple-50 text-purple-700 font-medium'
                                        : 'text-gray-900 hover:bg-purple-50'
                                    }`}
                                    style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>

                  {/* 悬浮提示下拉框（支持多选） */}
                  <div>
                    <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                      悬浮提示（支持多选）
                    </label>
                    <div className="relative flex-1" ref={tooltipDropdownRef}>
                      <button
                        ref={tooltipTriggerRef}
                        type="button"
                        onClick={() => setTooltipDropdownOpen(!tooltipDropdownOpen)}
                        className={`w-full min-h-[44px] px-4 py-2 text-left rounded-full flex flex-wrap items-center gap-2 relative transition-all duration-200 ${
                          tooltipDropdownOpen
                            ? 'border-2 border-purple-500 shadow-md shadow-purple-200 bg-gradient-to-r from-purple-50 to-purple-100'
                            : 'border border-purple-300 bg-gradient-to-r from-purple-50/50 to-white hover:border-purple-400 hover:shadow-sm'
                        }`}
                        style={{ fontSize: '14px', lineHeight: '1.6', letterSpacing: '0.2px' }}
                      >
                        {currentTooltipFields.length === 0 && (
                          <span className={`transition-colors ${tooltipDropdownOpen ? 'text-purple-700 font-medium' : 'text-purple-600'}`}>
                            选择字段...
                          </span>
                        )}
                        {currentTooltipFields.map((name) => (
                          <span
                            key={`tag-${name}`}
                            className="inline-flex items-center gap-0 h-6 text-[12px] font-medium rounded-full pl-2 pr-[1px] border border-purple-300 bg-purple-50 text-purple-800"
                          >
                            <span className="leading-normal whitespace-nowrap">{getFieldDisplayName(name)}</span>
                            <button
                              type="button"
                              className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-purple-500 hover:text-purple-700 hover:bg-white/80 flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentTooltipFields(prev => prev.filter(n => n !== name));
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <svg
                          className={`w-4 h-4 ml-auto transition-transform duration-200 flex-shrink-0 ${tooltipDropdownOpen ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          viewBox="0 0 24 24"
                          style={{ color: tooltipDropdownOpen ? '#9333ea' : '#a855f7' }}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {tooltipDropdownOpen && tooltipMenuPos && createPortal(
                        <div
                          ref={tooltipMenuRef}
                          className="z-[180] bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50"
                          style={{
                            position: 'fixed',
                            top: tooltipMenuPos.top,
                            left: tooltipMenuPos.left,
                            width: tooltipMenuPos.width,
                            maxHeight: '300px',
                            overflowY: 'auto',
                            boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)'
                          }}
                        >
                          <div className="p-2">
                            {axisOptions.length === 0 ? (
                              <div className="px-4 py-3 text-gray-500 text-center" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                                暂无可用字段
                              </div>
                            ) : (
                              axisOptions.map((option) => {
                                const isSelected = currentTooltipFields.includes(option.value);
                                const isHovered = hoveredTooltipOption === option.value;
                                const shouldHighlight = isHovered || (!hoveredTooltipOption && isSelected);
                                return (
                                  <button
                                    key={`tooltip-${option.value}`}
                                    type="button"
                                    onClick={() => {
                                      setCurrentTooltipFields(prev => {
                                        if (isSelected) {
                                          return prev.filter(v => v !== option.value);
                                        }
                                        return [...prev, option.value];
                                      });
                                    }}
                                    onMouseEnter={() => setHoveredTooltipOption(option.value)}
                                    onMouseLeave={() => setHoveredTooltipOption(null)}
                                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                      shouldHighlight
                                        ? 'bg-purple-50 text-purple-700 font-medium'
                                        : 'text-gray-900 hover:bg-purple-50'
                                    }`}
                                    style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`inline-block w-4 h-4 rounded border ${isSelected ? 'bg-purple-500/80 border-purple-500' : 'border-gray-300'}`}></span>
                                      <span>{option.label}</span>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>,
                        document.body
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* 保存按钮 */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveChartConfig}
                  disabled={!enabledChart}
                  className="px-3 py-2 text-xs bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-md shadow-gray-500/40 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                >
                  💾 保存图表配置
                </button>
              </div>
            </div>
          )}
          
          {/* AI自定义分析配置 */}
          <div className={`flex items-center justify-between rounded-2xl border px-4 py-3 transition-colors ${enabledAI ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-100' : 'bg-white border-gray-200'}`}>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500 accent-purple-600"
                checked={enabledAI}
                onChange={(e) => {
                  setEnabledAI(e.target.checked);
                  if (e.target.checked && !selectedComponents.includes('insight')) {
                    onComponentToggle('insight');
                  } else if (!e.target.checked && selectedComponents.includes('insight')) {
                    onComponentToggle('insight');
                  }
                }}
              />
              <span className={`text-sm font-medium ${enabledAI ? 'text-purple-700' : 'text-gray-700'}`} style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                🤖 AI自定义分析
              </span>
            </label>
            <button
              type="button"
              onClick={() => setOpenAI(v => !v)}
              className="p-2 text-gray-500 hover:text-gray-700"
            >
              <svg className={`w-5 h-5 transition-transform ${openAI ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          
          {openAI && (
            <div className="bg-white rounded-2xl p-6 shadow-lg shadow-purple-200/50 border border-purple-100 space-y-4" style={{ boxShadow: '0 0 0 1px rgba(139, 92, 246, 0.1), 0 20px 25px -5px rgba(139, 92, 246, 0.1)' }}>
              {/* 标题区域 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 relative">
                  {isEditingTitle ? (
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => {
                        if (editingTitle.trim()) {
                          const newTitle = editingTitle.trim();
                          setPromptTitle(newTitle);
                          // 如果当前模板存在，更新模板标题
                          if (currentTemplateId && currentTemplateId.startsWith('template_')) {
                            setPromptTemplates(prev => 
                              prev.map(t => t.id === currentTemplateId ? { ...t, title: newTitle } : t)
                            );
                          }
                        }
                        setIsEditingTitle(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (editingTitle.trim()) {
                            const newTitle = editingTitle.trim();
                            setPromptTitle(newTitle);
                            // 如果当前模板存在，更新模板标题
                            if (currentTemplateId && currentTemplateId.startsWith('template_')) {
                              setPromptTemplates(prev => 
                                prev.map(t => t.id === currentTemplateId ? { ...t, title: newTitle } : t)
                              );
                            }
                          }
                          setIsEditingTitle(false);
                        } else if (e.key === 'Escape') {
                          setEditingTitle(promptTitle);
                          setIsEditingTitle(false);
                        }
                      }}
                      className="text-lg font-semibold text-gray-900 border border-purple-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      style={{ fontSize: '18px', lineHeight: '1.5', letterSpacing: '0.2px', minWidth: '120px' }}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span 
                        className="text-lg font-semibold text-gray-900 cursor-pointer hover:text-purple-700 transition-colors"
                        onClick={() => {
                          if (isEditingPrompt) {
                            setEditingTitle(promptTitle);
                            setIsEditingTitle(true);
                          }
                        }}
                      >
                        {promptTitle}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPromptTitleDropdownOpen(!promptTitleDropdownOpen)}
                        className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        <svg 
                          className={`w-4 h-4 transition-transform ${promptTitleDropdownOpen ? 'rotate-180' : ''}`} 
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {promptTitleDropdownOpen && (
                        <div 
                          data-prompt-title-dropdown
                          className="absolute top-full left-0 mt-2 bg-white border-2 border-purple-200 rounded-2xl shadow-xl shadow-purple-200/50 z-50 min-w-[200px]" 
                          style={{ boxShadow: '0 10px 25px -5px rgba(139, 92, 246, 0.2), 0 0 0 1px rgba(139, 92, 246, 0.1)' }}
                        >
                          <div className="p-2 max-h-[300px] overflow-y-auto">
                            {promptTemplates.map((template) => (
                              <button
                                key={template.id}
                                type="button"
                                onClick={() => {
                                  setCurrentTemplateId(template.id);
                                  setPromptTitle(template.title);
                                  setCustomPrompt(template.content);
                                  setPromptTitleDropdownOpen(false);
                                  setIsEditingPrompt(false);
                                }}
                                className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                                  currentTemplateId === template.id
                                    ? 'bg-purple-50 text-purple-700 font-medium'
                                    : 'text-gray-900 hover:bg-purple-50'
                                }`}
                                style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                              >
                                {template.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newId = `template_${Date.now()}`;
                    setPromptTitle('新建模版');
                    setEditingTitle('新建模版');
                    setPromptTemplate(customPrompt);
                    setCustomPrompt('');
                    setCurrentTemplateId(newId);
                    setIsEditingPrompt(true);
                    setIsEditingTitle(true);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
                  style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                >
                  新建 Prompt
                </button>
              </div>

              {/* 提示词内容区域 */}
              <div>
                <label className="block font-medium text-gray-700 mb-2" style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}>
                  提示词内容 (手动选择)
                </label>
                {isEditingPrompt ? (
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="你是一名面向个人知识管理与习惯跟踪的中文数据分析助手。请基于用户在 至 期间的笔记数据,完成一份简洁、可执行的分析报告。"
                    rows={12}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                    style={{ fontSize: '13px', lineHeight: '1.8', letterSpacing: '0.1px' }}
                  />
                ) : (
                  <div className="w-full min-h-[200px] px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 whitespace-pre-wrap" style={{ fontSize: '13px', lineHeight: '1.8', letterSpacing: '0.1px' }}>
                    {customPrompt || '暂无提示词内容，请点击编辑按钮添加。'}
                  </div>
                )}
              </div>

              {/* 操作按钮区域 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isEditingPrompt ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          // 如果是新建模板，保存到模板列表
                          if (currentTemplateId.startsWith('template_')) {
                            const newTemplate = {
                              id: currentTemplateId,
                              title: promptTitle,
                              content: customPrompt
                            };
                            setPromptTemplates(prev => {
                              const exists = prev.find(t => t.id === currentTemplateId);
                              if (exists) {
                                return prev.map(t => t.id === currentTemplateId ? newTemplate : t);
                              }
                              return [...prev, newTemplate];
                            });
                          }
                          handleSaveAIConfig();
                          setIsEditingPrompt(false);
                          setIsEditingTitle(false);
                        }}
                        disabled={!enabledAI || !promptTitle.trim() || !customPrompt.trim()}
                        className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // 恢复之前的内容和标题
                          const currentTemplate = promptTemplates.find(t => t.id === currentTemplateId);
                          if (currentTemplate) {
                            setPromptTitle(currentTemplate.title);
                            setCustomPrompt(currentTemplate.content);
                          } else {
                            setCustomPrompt(promptTemplate);
                          }
                          setIsEditingPrompt(false);
                          setIsEditingTitle(false);
                        }}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                        style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPromptTemplate(customPrompt);
                        setIsEditingPrompt(true);
                      }}
                      className="px-4 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
                      style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                    >
                      编辑
                    </button>
                  )}
                </div>
                <button
                  onClick={handleSaveAIConfig}
                  disabled={!enabledAI}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#1a1a1a] rounded-lg hover:bg-[#2b2b2b] shadow-md shadow-gray-500/40 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  style={{ fontSize: '13px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                >
                  保存 AI 配置
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* 操作按钮 */}
        <div className="flex justify-end gap-4">
          <button
            onClick={onBack}
            disabled={isSubmitting}
            className="px-6 py-3 rounded-full font-medium text-purple-700 bg-white border-2 border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors"
            style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
          >
            返回
          </button>
          <button
            onClick={onSubmit}
            disabled={(!enabledChart && !enabledAI) || selectedNoteIds.length === 0 || isSubmitting}
            className={`px-6 py-3 rounded-full font-medium transition-colors ${
              (enabledChart || enabledAI) && selectedNoteIds.length > 0 && !isSubmitting
                ? 'bg-purple-600 text-white hover:bg-purple-700 shadow-lg shadow-purple-500/30'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.2px' }}
          >
            {isSubmitting ? '分析中...' : `🚀 开始分析（${selectedNoteIds.length} 条笔记，${(enabledChart ? 1 : 0) + (enabledAI ? 1 : 0)} 个配置）`}
          </button>
        </div>
        {(!enabledChart && !enabledAI) && (
          <div className="text-xs text-amber-600 text-center" style={{ fontSize: '12px', lineHeight: '1.5', letterSpacing: '0.1px' }}>
            请先勾选至少一个分析配置（图表/AI）
          </div>
        )}
      </div>
    </div>
  );
};

// 主组件
const AnalysisPage: React.FC = () => {
  const navigate = useNavigate();
  const { notebookId: urlNotebookId } = useParams<{ notebookId?: string }>();
  
  const [step, setStep] = useState<1 | 2 | 3>(2); // 默认显示第二步（选择笔记页面）
  const [notebooks, setNotebooks] = useState<ApiNotebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(urlNotebookId || null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [mode, setMode] = useState<'ai' | 'custom'>('ai');
  const [selectedComponents, setSelectedComponents] = useState<AnalysisComponent[]>(['chart', 'insight']);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 加载笔记本列表
  useEffect(() => {
    const loadNotebooks = async () => {
      try {
        const notebookList = await getNotebooks();
        setNotebooks(notebookList);
        
        // 如果URL中有notebookId，设置为选中
        if (urlNotebookId && notebookList.some(nb => nb.notebook_id === urlNotebookId)) {
          setSelectedNotebookId(urlNotebookId);
        } else if (notebookList.length > 0 && !selectedNotebookId) {
          // 如果没有指定notebookId但有笔记本，默认选择第一个
          setSelectedNotebookId(notebookList[0].notebook_id);
        }
      } catch (error) {
        console.error('加载笔记本失败:', error);
      }
    };
    loadNotebooks();
  }, [urlNotebookId, selectedNotebookId]);

  const handleNoteToggle = (noteId: string) => {
    setSelectedNoteIds(prev =>
      prev.includes(noteId)
        ? prev.filter(id => id !== noteId)
        : [...prev, noteId]
    );
  };


  const handleDeselectAll = () => {
    setSelectedNoteIds([]);
  };

  const handleComponentToggle = (component: AnalysisComponent) => {
    setSelectedComponents(prev =>
      prev.includes(component)
        ? prev.filter(c => c !== component)
        : [...prev, component]
    );
  };

  const handleSubmit = async () => {
    if (!selectedNotebookId || selectedNoteIds.length === 0 || selectedComponents.length === 0) {
      alert('请完成所有必填项');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiClient.analyzeNotes({
        mode,
        selectedNotes: {
          notebookId: selectedNotebookId,
          noteIds: selectedNoteIds,
          dateRange: {
            from: dateRange.from || new Date(0).toISOString(),
            to: dateRange.to || new Date().toISOString()
          }
        },
        config: {
          selectedAnalysisComponents: selectedComponents
        }
      });

      if (response.data && response.data.success) {
        const analysisId = response.data.data?.id || response.data.data?.analysisId;
        if (analysisId) {
          navigate(getAnalysisUrl(analysisId));
        } else {
          navigate('/analysis');
        }
      } else {
        throw new Error(response.data?.message || '分析失败');
      }
    } catch (error: any) {
      console.error('分析失败:', error);
      alert(error.message || '分析失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-purple-50 to-purple-50">
      {/* 步骤内容 */}
      {step === 1 && (
        <Step1SelectNotebook
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          onSelect={setSelectedNotebookId}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <Step2SelectNotes
          notebookId={selectedNotebookId}
          notebooks={notebooks}
          selectedNoteIds={selectedNoteIds}
          dateRange={dateRange}
          onNotebookSelect={setSelectedNotebookId}
          onNoteToggle={handleNoteToggle}
          onSelectAll={() => {}}
          onDeselectAll={() => {}}
          onDateRangeChange={setDateRange}
          onBack={() => {
            setStep(1);
            setSelectedNotebookId(null);
          }}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <Step3SelectMode
          selectedComponents={selectedComponents}
          onComponentToggle={handleComponentToggle}
          mode={mode}
          onModeChange={setMode}
          onBack={() => setStep(2)}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          notebookId={selectedNotebookId}
          selectedNoteIds={selectedNoteIds}
          dateRange={dateRange}
        />
      )}
    </div>
  );
};

export default AnalysisPage;
