import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { Notebook } from '../apiClient';
import NewNoteModal from './NewNoteModal';
import MoveNoteModal from './MoveNoteModal';
import AIModal from './AIModal';
import { onConfigUpdate } from '../utils/componentSync';
import { getDisplayTitle } from '../utils/displayTitle';

// Define types for our data
interface Note {
  id?: string;
  note_id?: string;
  title: string;
  content: string;
  content_text?: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  source_url?: string;
  status?: string;
  component_instances?: ParsedComponentInstance[];
  component_data?: ParsedComponentData;
}

interface ParsedComponentInstance {
  id: string;
  type: string;
  title?: string;
  content?: string;
}

type ParsedComponentData = Record<
  string,
  {
    value?: string;
    type?: string;
    title?: string;
    [key: string]: any;
  }
>;

const MAX_CARD_TITLE_LENGTH = 20;

const normalizeComponentValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  const lower = str.toLowerCase();
  if (lower === 'null' || lower === 'undefined' || lower === 'nan') return '';
  return str;
};

const safeParseJSON = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return null;
  }
};

const normalizeComponentInstances = (raw: unknown): ParsedComponentInstance[] => {
  const parsed = safeParseJSON(raw);
  const arraySource = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? Array.isArray((parsed as any).componentInstances)
        ? (parsed as any).componentInstances
        : Array.isArray((parsed as any).instances)
          ? (parsed as any).instances
          : []
      : [];

  return arraySource
    .filter((item: any) => item && typeof item === 'object')
    .map((item: any, index: number) => {
      const candidate = item as Record<string, any>;
      const id =
        (candidate.id && String(candidate.id)) ||
        (candidate.originalId && String(candidate.originalId)) ||
        `component-${index}`;
      return {
        id,
        type: String(candidate.type || ''),
        title: typeof candidate.title === 'string' ? candidate.title : undefined,
        content:
          typeof candidate.content === 'string'
            ? candidate.content
            : candidate.content !== undefined
              ? String(candidate.content ?? '')
              : undefined
      };
    });
};

const normalizeComponentData = (raw: unknown): ParsedComponentData => {
  const parsed = safeParseJSON(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  const result: ParsedComponentData = {};
  Object.entries(parsed as Record<string, any>).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      result[key] = {
        value: value !== undefined && value !== null ? String(value) : undefined
      };
      return;
    }

    result[key] = {
      value:
        typeof value.value === 'string'
          ? value.value
          : value.value !== undefined && value.value !== null
            ? String(value.value)
            : undefined,
      type: typeof value.type === 'string' ? value.type : undefined,
      title: typeof value.title === 'string' ? value.title : undefined,
      ...value
    };
  });
  return result;
};

const stripEmbeddedJson = (text: string): string => {
  if (!text) return '';
  let cleaned = text.replace(/```json[\s\S]*?```/gi, '');
  cleaned = cleaned.replace(/\{[\s\S]*?\}/g, '').replace(/\[[\s\S]*?\]/g, '');
  return cleaned.trim();
};

const sanitizeDisplayText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
};

const coerceToText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDisplayText(item))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return sanitizeDisplayText(value);
  }
  return '';
};

const buildGeneratedTitle = (note: Note, index: number): string => {
  const createdAt = note.created_at || '';
  let datePart = '';

  if (createdAt) {
    const parsedDate = new Date(createdAt);
    if (!Number.isNaN(parsedDate.getTime())) {
      const year = parsedDate.getFullYear();
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const day = String(parsedDate.getDate()).padStart(2, '0');
      datePart = `${year}${month}${day}`;
    } else {
      const digits = createdAt.replace(/\D/g, '');
      if (digits.length >= 8) {
        datePart = digits.slice(0, 8);
      }
    }
  }

  if (!datePart) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    datePart = `${year}${month}${day}`;
  }

  const sequenceSource =
    Number.isFinite(index) && index > 0
      ? index
      : Number(note.note_id) || Number(note.id) || 1;
  const sequencePart = String(sequenceSource).padStart(2, '0');

  return `${datePart}-${sequencePart}`;
};

const buildNoteCardTitle = (note: Note, index: number, notebooks: Notebook[], currentNotebookId: string): string => {
  // 0. 最优先使用笔记的title字段（API返回的真实标题）
  if (note.title && note.title.trim() && note.title !== '未命名笔记') {
    const trimmedTitle = note.title.trim();
    return trimmedTitle.length > MAX_CARD_TITLE_LENGTH
      ? `${trimmedTitle.slice(0, MAX_CARD_TITLE_LENGTH)}…`
      : trimmedTitle;
  }

  const getComponentValueByType = (type: string): string => {
    const instances = note.component_instances || [];
    for (const instance of instances) {
      if (instance.type === type) {
        const dataEntry = note.component_data?.[instance.id];
        const raw =
          normalizeComponentValue(dataEntry?.value) ||
          normalizeComponentValue(instance.content);
        if (raw) return raw;
      }
    }

    if (note.component_data) {
      for (const entry of Object.values(note.component_data)) {
        if (entry?.type === type) {
          const raw = normalizeComponentValue(entry.value);
          if (raw) return raw;
        }
      }
    }

    return '';
  };

  // 1. 从短文本组件获取内容
  const shortText = getComponentValueByType('text-short');
  if (shortText && shortText.trim()) {
    const trimmedText = shortText.trim();
    return trimmedText.length > MAX_CARD_TITLE_LENGTH
      ? `${trimmedText.slice(0, MAX_CARD_TITLE_LENGTH)}…`
      : trimmedText;
  }

  // 2. 获取长文本组件的内容
  const longText = getComponentValueByType('text-long');
  if (longText && longText.trim()) {
    const trimmedText = longText.trim();
    return trimmedText.length > MAX_CARD_TITLE_LENGTH
      ? `${trimmedText.slice(0, MAX_CARD_TITLE_LENGTH)}…`
      : trimmedText;
  }

  // 3. 如果没有文本组件，按笔记本名称+序号来展示
  const currentNotebook = notebooks.find(nb => nb.notebook_id === currentNotebookId);
  if (currentNotebook) {
    const notebookName = currentNotebook.name || '未命名笔记本';
    const sequenceNumber = String(index).padStart(2, '0');
    const title = `${notebookName}-${sequenceNumber}`;
    
    return title.length > MAX_CARD_TITLE_LENGTH
      ? `${title.slice(0, MAX_CARD_TITLE_LENGTH)}…`
      : title;
  }

  // 4. 最后的后备方案
  return buildGeneratedTitle(note, index);
};

// NoteItem component for displaying a single note
const NoteItem = ({ 
  note,
  displayTitle,
  onNoteClick, 
  notebooks, 
  currentNotebookId, 
  batchMode, 
  isSelected, 
  onSelect 
}: { 
  note: Note; 
  displayTitle: string;
  onNoteClick: () => void;
  notebooks: Notebook[];
  currentNotebookId: string;
  batchMode: boolean;
  isSelected: boolean;
  onSelect: (noteId: string) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(note.title);
  const [moveOpen, setMoveOpen] = useState(false);

  // 处理移动笔记
  const handleMoveNote = async (targetNotebookId: string) => {
    try {
      await apiClient.post('/api/note-move', { 
        note_id: note.id || note.note_id, 
        target_notebook_id: targetNotebookId 
      });
      window.dispatchEvent(new Event('notes:refresh'));
      setMoveOpen(false);
    } catch (error) {
      console.error('移动失败:', error);
      alert('移动失败，请重试');
    }
  };

  // 点击外部区域关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuOpen) {
        const target = event.target as Element;
        if (!target.closest('.dropdown-menu') && !target.closest('.menu-button')) {
          setMenuOpen(false);
        }
      }
    };

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen]);

  const handleCardClick = (e: React.MouseEvent) => {
    console.log('🖱️ 笔记卡片被点击，但不会跳转');
  };

  return (
    <div 
      className={`bg-white p-3 rounded-xl border border-gray-200 flex items-center justify-between hover:shadow-sm transition-shadow duration-200 cursor-default ${
        isSelected ? 'ring-2 ring-purple-500 bg-purple-50' : ''
      }`}
      onClick={handleCardClick}
    >
      <div className="flex items-center gap-3">
        {batchMode && (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(note.id || note.note_id || '')}
              className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
            />
          </div>
        )}
        <div className="w-16 h-12 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="flex flex-col justify-center flex-1 h-12">
          {renaming ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input 
                className="border border-purple-300 rounded-lg px-2 py-1 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none" 
                value={newTitle} 
                onChange={(e)=>setNewTitle(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <button 
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await apiClient.post('/api/note-rename', { id: note.id || note.note_id, title: newTitle });
                    setRenaming(false);
                    window.dispatchEvent(new Event('notes:refresh'));
                  } catch (error) {
                    console.error('重命名失败:', error);
                    alert('重命名失败，请重试');
                  }
                }} 
                className="text-xs px-2 py-1 rounded-lg bg-[#1a1a1a] text-white hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
              >
                保存
              </button>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRenaming(false); 
                  setNewTitle(note.title);
                }} 
                className="text-xs px-2 py-1 rounded-lg border border-purple-300 text-purple-600 hover:bg-purple-50 transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <>
              <h2 className="font-semibold text-gray-900 leading-tight text-sm mb-2">{displayTitle}</h2>
              <p className="text-[10px] text-gray-500 leading-tight">
                创建时间：{new Date(note.created_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '/')} &nbsp;·&nbsp; 更新：{new Date(note.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-6 relative">
        <span className={`px-1.5 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full`}>
          已保存
        </span>
        <button 
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(!menuOpen);
          }} 
          className="menu-button p-2 rounded-full hover:bg-purple-100"
          style={{ zIndex: 1000 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
        </button>
        {menuOpen && (
          <div 
            className="dropdown-menu absolute top-8 right-0 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-50"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: 9999 }}
          >
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (note.source_url) {
                  window.open(note.source_url, '_blank');
                } else {
                  alert('无来源链接');
                }
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              访问源网址
            </button>
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRenaming(true);
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors"
            >
              重命名
            </button>
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMoveOpen(true);
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              移到
            </button>
            <button 
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.confirm('确定删除这条笔记吗？')) {
                  try {
                    await apiClient.post('/api/note-delete', { id: note.id || note.note_id });
                    window.dispatchEvent(new Event('notes:refresh'));
                  } catch (error) {
                    console.error('删除失败:', error);
                    alert('删除失败，请重试');
                  }
                }
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              删除
            </button>
          </div>
        )}
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onNoteClick();
          }} 
          className="px-1.5 py-0.5 text-xs rounded-xl border border-gray-300 text-gray-700 hover:bg-purple-50 hover:border-purple-200 hover:text-purple-700 transition-colors"
        >
          查看详情
        </button>
        <MoveNoteModal
          isOpen={moveOpen}
          onClose={() => setMoveOpen(false)}
          onMove={handleMoveNote}
          notebooks={notebooks}
          currentNotebookId={currentNotebookId}
        />
      </div>
    </div>
  );
};

const NotesPage = ({ notebookId }: { notebookId: string }) => {
  const navigate = useNavigate();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [currentNotebookId, setCurrentNotebookId] = useState<string>(notebookId);
  const notesCacheRef = useRef<Map<string, { notes: Note[]; notebook: Notebook | null; fetchedAt: number }>>(new Map());
  const lastFetchRef = useRef<Map<string, number>>(new Map());
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  
  // 批量操作状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [batchMoveModalOpen, setBatchMoveModalOpen] = useState(false);
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  
  // 搜索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState('all'); // 'all', 'title', 'content'
  const [filteredNotes, setFilteredNotes] = useState<Note[]>([]);
  
  // 日期筛选状态
  const [dateFilter, setDateFilter] = useState<{
    startDate: string;
    endDate: string;
  }>({
    startDate: '',
    endDate: ''
  });
  
  // AI总结状态
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 搜索和筛选功能
  useEffect(() => {
    let filtered = [...notes];
    
    // 文本搜索筛选
    if (searchQuery.trim()) {
      filtered = filtered.filter(note => {
        const title = note.title || '';
        const content = note.content || '';
        const query = searchQuery.toLowerCase();
        
        switch (searchScope) {
          case 'title':
            return title.toLowerCase().includes(query);
          case 'content':
            return content.toLowerCase().includes(query);
          case 'all':
          default:
            return title.toLowerCase().includes(query) || content.toLowerCase().includes(query);
        }
      });
    }
    
    // 日期筛选
    if (dateFilter.startDate || dateFilter.endDate) {
      filtered = filtered.filter(note => {
        const noteDate = new Date(note.created_at);
        const startDate = dateFilter.startDate ? new Date(dateFilter.startDate) : null;
        const endDate = dateFilter.endDate ? new Date(dateFilter.endDate) : null;
        
        if (startDate && endDate) {
          return noteDate >= startDate && noteDate <= endDate;
        } else if (startDate) {
          return noteDate >= startDate;
        } else if (endDate) {
          return noteDate <= endDate;
        }
        return true;
      });
    }
    
    setFilteredNotes(filtered);
  }, [searchQuery, searchScope, notes, dateFilter]);

  const normalizeNotes = useCallback((raw: any[]): Note[] => {
    return raw.map((item) => {
      const componentData = normalizeComponentData(item.component_data ?? item.componentData);
      const rawArticleField = componentData?.article_parse_history?.value;
      const articleField: Record<string, any> = rawArticleField && typeof rawArticleField === 'object' && !Array.isArray(rawArticleField)
        ? (rawArticleField as Record<string, any>)
        : {};
      const sanitizedContent = stripEmbeddedJson(String(item.content_text ?? item.content ?? ''));
      const articleContent = coerceToText(
        articleField['content'] ??
          articleField['article_content'] ??
          articleField['full_text']
      );
      const mainContent = articleContent || sanitizedContent;
      const normalizedTitle =
        coerceToText(
          articleField['title'] ??
            articleField['article_title'] ??
            articleField['headline']
        ) ||
        sanitizeDisplayText(item.title) ||
        '未命名笔记';
      const summaryText =
        coerceToText(
          articleField['summary'] ??
            articleField['article_summary'] ??
            articleField['description']
        ) || mainContent.slice(0, 200);
      const resolvedSource =
        coerceToText(
          articleField['sourceUrl'] ??
            articleField['source_url'] ??
            articleField['source']
        ) || item.source_url || '';

      return {
        id: String(item.id ?? item.note_id ?? ''),
        note_id: String(item.note_id ?? item.id ?? ''),
        title: normalizedTitle,
        content: mainContent,
        content_text: mainContent,
        summary: summaryText,
        created_at: item.created_at ?? item.upload_time ?? new Date().toISOString(),
        updated_at: item.updated_at ?? item.created_at ?? item.upload_time ?? new Date().toISOString(),
        source_url: resolvedSource,
        status: item.status ?? 'success',
        component_instances: normalizeComponentInstances(item.component_instances ?? item.componentInstances),
        component_data: componentData
      };
    });
  }, []);

  const loadNotebooks = useCallback(async () => {
    try {
      const notebooksList = await apiClient.getNotebooks();
      if (isMountedRef.current) {
        setNotebooks(notebooksList);
      }
    } catch (err) {
      console.error('Failed to load notebooks:', err);
    }
  }, []);

  const fetchNotes = useCallback(
    async ({ forceNetwork = false }: { forceNetwork?: boolean } = {}) => {
      if (!notebookId) {
        if (isMountedRef.current) {
          setLoading(false);
          setNotebook(null);
          setNotes([]);
        }
        return;
      }

      const cached = notesCacheRef.current.get(notebookId);
      const now = Date.now();

      if (cached && isMountedRef.current) {
        setNotebook(prev => prev ?? cached.notebook);
        setNotes(cached.notes);
        setLoading(false);

        const lastFetchedAt = lastFetchRef.current.get(notebookId) ?? cached.fetchedAt;
        if (!forceNetwork && now - lastFetchedAt < 5000) {
          return;
        }
      }

      if (isMountedRef.current) {
        setLoading(true);
        setError(null);
      }

      try {
        const response = await apiClient.get('/api/notes', {
          params: { notebook_id: notebookId }
        });
        
        const data = response.data;

        if (data?.success === false) {
          const message = data?.message || `加载笔记失败 (HTTP ${response.status})`;
          if (isMountedRef.current) {
            setError(message);
            setNotebook(null);
            setNotes([]);
            setLoading(false);
          }
          return;
        }

        let rawNotes = [];
        if (Array.isArray(data?.notes)) {
          rawNotes = data.notes;
        } else if (Array.isArray(data?.data?.notes)) {
          rawNotes = data.data.notes;
        }
        
        const notesPayload = normalizeNotes(rawNotes);
        const notebookPayload = data?.notebook || data?.data?.notebook || null;

        if (isMountedRef.current) {
          setNotebook(notebookPayload);
          setNotes(notesPayload);
          setLoading(false);
          notesCacheRef.current.set(notebookId, {
            notes: notesPayload,
            notebook: notebookPayload,
            fetchedAt: Date.now()
          });
          lastFetchRef.current.set(notebookId, Date.now());
        }
      } catch (err: any) {
        console.error('❌ Error fetching notes:', err);
        if (isMountedRef.current) {
          const message = err?.message ? `加载笔记失败：${err.message}` : '加载笔记失败，请稍后再试';
          setError(message);
          if (!cached) {
            setNotebook(null);
            setNotes([]);
          }
          setLoading(false);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [notebookId, normalizeNotes]
  );

  useEffect(() => {
    if (!notebookId) {
      if (isMountedRef.current) {
        setLoading(false);
        setNotebook(null);
        setNotes([]);
      }
      return;
    }

    setCurrentNotebookId(notebookId);

    fetchNotes();
    loadNotebooks();

    const refresh = (event?: Event) => {
      const custom = event as CustomEvent<{ forceNetwork?: boolean }> | undefined;
      fetchNotes({ forceNetwork: Boolean(custom?.detail?.forceNetwork) });
    };
    window.addEventListener('notes:refresh', refresh as EventListener);
    return () => window.removeEventListener('notes:refresh', refresh as EventListener);
  }, [notebookId, fetchNotes, loadNotebooks]);

  // 监听笔记本配置更新事件
  useEffect(() => {
    const cleanup = onConfigUpdate((updatedNotebookId, config) => {
      if (updatedNotebookId === notebookId) {
        setNotebook(prev => prev ? { ...prev, component_config: config } : null);
      }
    });
    
    return cleanup;
  }, [notebookId]);

  // 监听笔记创建事件
  useEffect(() => {
    const handleNoteCreated = (event: CustomEvent) => {
      if (event.detail.notebookId === notebookId) {
        refreshNotes();
      }
    };

    window.addEventListener('note:created', handleNoteCreated as EventListener);
    return () => {
      window.removeEventListener('note:created', handleNoteCreated as EventListener);
    };
  }, [notebookId]);

  const refreshNotes = async () => {
    if (!notebookId) return;
    await fetchNotes({ forceNetwork: true });
  };

  // 批量操作处理函数
  const handleBatchModeToggle = () => {
    setBatchMode(!batchMode);
    setSelectedNotes([]);
  };

  const handleNoteSelect = (noteId: string) => {
    setSelectedNotes(prev => 
      prev.includes(noteId) 
        ? prev.filter(id => id !== noteId)
        : [...prev, noteId]
    );
  };

  const handleSelectAll = () => {
    if (selectedNotes.length === notes.length) {
      setSelectedNotes([]);
    } else {
      setSelectedNotes(notes.map(note => note.id || note.note_id || ''));
    }
  };

  const handleBatchDelete = async () => {
    try {
      await apiClient.post('/api/notes-batch-delete', {
        note_ids: selectedNotes
      });
      setBatchDeleteConfirmOpen(false);
      setSelectedNotes([]);
      setBatchMode(false);
      refreshNotes();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败，请重试');
    }
  };

  const handleBatchMove = async (targetNotebookId: string) => {
    try {
      await apiClient.post('/api/notes-batch-move', {
        note_ids: selectedNotes,
        target_notebook_id: targetNotebookId
      });
      setBatchMoveModalOpen(false);
      setSelectedNotes([]);
      setBatchMode(false);
      refreshNotes();
    } catch (error) {
      console.error('批量移动失败:', error);
      alert('批量移动失败，请重试');
    }
  };

  // AI总结功能
  const handleAISummary = () => {
    if (filteredNotes.length === 0) {
      alert('没有可总结的笔记');
      return;
    }
    
    setAiModalOpen(true);
  };

  // 准备AI助手的上下文数据
  const getAIContext = () => {
    const notesData = filteredNotes.map(note => ({
      title: note.title,
      content: note.content,
      created_at: note.created_at
    }));

    return {
      notebook_name: notebook?.name || '当前笔记本',
      notes_count: filteredNotes.length,
      notes: notesData,
      date_range: dateFilter.startDate && dateFilter.endDate ? {
        start: dateFilter.startDate,
        end: dateFilter.endDate
      } : null
    };
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading notes...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">{error}</div>;
  }

  if (!notebook) {
    return <div className="flex items-center justify-center h-full text-gray-500">Select a notebook to view notes.</div>;
  }

  return (
    <div className="pl-2 pr-6 pt-2 pb-12 h-full overflow-y-auto no-scrollbar">
      {/* Header Section */}
      <div className="mb-6">
        {/* 第一行：笔记本信息和功能按钮 */}
        <div className="flex items-start justify-between -mb-10">
          <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-sm w-[260px] min-w-[260px] flex-shrink-0">
            <div>
              <div className="text-xs text-gray-500 space-y-1">
                <div className="whitespace-nowrap">
                  当前位置：<span className="text-purple-600 font-medium">{notebook.name}</span>
                </div>
                <div className="whitespace-nowrap">
                  创建于：{new Date(notebook.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="whitespace-nowrap">
                  笔记数：{notebook.note_count} 篇
                </div>
              </div>
            </div>
          </div>
          
          {/* 日期筛选和AI总结按钮 */}
          <div className="flex items-start gap-3">
            {/* 日期筛选器 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap">时间区间</span>
              <input
                type="date"
                value={dateFilter.startDate}
                onChange={(e) => setDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                className="px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <span className="text-xs text-gray-500">至</span>
              <input
                type="date"
                value={dateFilter.endDate}
                onChange={(e) => setDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                className="px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={() => {
                  console.log('🔍 执行日期筛选查询:', dateFilter);
                }}
                className="px-3 py-2 text-xs font-medium text-white bg-[#1a1a1a] rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30"
              >
                查询
              </button>
            </div>
            
            {/* AI总结按钮 */}
            <button
              onClick={handleAISummary}
              disabled={filteredNotes.length === 0}
              className="px-3 py-2 text-xs font-medium text-white bg-[#1a1a1a] rounded-2xl hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI总结和建议
            </button>
          </div>
        </div>
        
        {/* 第二行：搜索、筛选、批量操作等按钮 */}
        <div className="flex items-center justify-end gap-2 flex-wrap mt-4">
            {/* 搜索框 */}
            <div className="relative w-48">
                <input 
                  type="text" 
                  placeholder="搜索笔记..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-24 px-3 py-2 text-xs font-medium border border-gray-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500" 
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <div className="relative">
                    <select
                      value={searchScope}
                      onChange={(e) => setSearchScope(e.target.value)}
                      className="appearance-none bg-transparent text-xs font-medium text-gray-700 rounded-xl py-1 pl-3 pr-6 focus:outline-none cursor-pointer"
                    >
                      <option value="all">全部</option>
                      <option value="title">标题</option>
                      <option value="content">内容</option>
                    </select>
                    <svg className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
            </div>
            
            <button 
              onClick={handleBatchModeToggle}
              className={`px-3 py-2 text-xs font-medium rounded-2xl flex items-center gap-2 whitespace-nowrap ${
                batchMode 
                  ? 'text-white bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30' 
                  : 'text-gray-700 bg-white border border-gray-300 hover:bg-purple-50 hover:border-purple-200'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {batchMode ? '退出批量' : '批量操作'}
            </button>
            {batchMode && selectedNotes.length > 0 && (
              <>
                <button 
                  onClick={handleSelectAll}
                  className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-2xl hover:bg-gray-100 flex items-center gap-2 whitespace-nowrap"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  {selectedNotes.length === notes.length ? '取消全选' : '全选'}
                </button>
                <button 
                  onClick={() => setBatchMoveModalOpen(true)}
                  className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-2xl hover:bg-blue-100 flex items-center gap-2 whitespace-nowrap"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  移动({selectedNotes.length})
                </button>
                <button 
                  onClick={() => setBatchDeleteConfirmOpen(true)}
                  className="px-3 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-2xl hover:bg-red-100 flex items-center gap-2 whitespace-nowrap"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  删除({selectedNotes.length})
                </button>
              </>
            )}
            {!batchMode && (
              <>
                <button onClick={() => navigate('/CreateNote')} className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-2xl hover:bg-purple-50 hover:border-purple-200 flex items-center gap-2 whitespace-nowrap">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    新建笔记本
                </button>
                <button onClick={() => {
                  const isFitnessNotebook = notebook?.name?.toLowerCase().includes('健身') || 
                                          notebook?.name?.toLowerCase().includes('fitness');
                  
                  if (isFitnessNotebook) {
                    setModalMode('edit');
                  } else {
                    setModalMode('create');
                  }
                  
                  setModalOpen(true);
                }} className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-2xl hover:bg-purple-50 hover:border-purple-200 flex items-center gap-2 whitespace-nowrap">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                  新建笔记
                </button>
              </>
            )}
        </div>
      </div>

      {/* Notes List */}
      <div className="space-y-4">
        {filteredNotes.map((note, index) => (
          <NoteItem 
            key={note.id || note.note_id} 
            note={note} 
            displayTitle={buildNoteCardTitle(note, index + 1, notebooks, currentNotebookId)}
            notebooks={notebooks}
            currentNotebookId={currentNotebookId}
            batchMode={batchMode}
            isSelected={selectedNotes.includes(note.id || note.note_id || '')}
            onSelect={handleNoteSelect}
            onNoteClick={() => {
              const noteId = note.id || note.note_id;
              if (!noteId) return;
              navigate(`/note/${noteId}`, { state: { note, notebook } });
            }}
          />
        ))}
        {filteredNotes.length === 0 && notes.length > 0 && (
            <div className="text-center py-16 text-gray-500">
                <p>没有找到匹配的笔记。</p>
            </div>
        )}
        {notes.length === 0 && (
            <div className="text-center py-16 text-gray-500">
                <p>这个笔记本里还没有笔记。</p>
            </div>
        )}
      </div>
      <NewNoteModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        notebookId={notebookId} 
        onCreated={refreshNotes}
        mode={modalMode}
      />
      
      {/* 批量删除确认对话框 */}
      {batchDeleteConfirmOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            <h2 className="text-xl font-bold mb-4 text-red-600">确认删除</h2>
            <p className="text-gray-700 mb-6">
              确定要删除选中的 {selectedNotes.length} 篇笔记吗？此操作无法撤销。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setBatchDeleteConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量移动对话框 */}
      {batchMoveModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            <h2 className="text-xl font-bold mb-4 text-purple-600">移动笔记</h2>
            <p className="text-gray-700 mb-4">
              将选中的 {selectedNotes.length} 篇笔记移动到：
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              const targetNotebookId = formData.get('notebookId') as string;
              if (targetNotebookId && targetNotebookId !== currentNotebookId) {
                handleBatchMove(targetNotebookId);
              }
            }}>
              <select
                name="notebookId"
                className="w-full p-3 border border-gray-300 rounded-lg mb-4"
                required
              >
                <option value="">选择目标笔记本</option>
                {notebooks
                  .filter(nb => nb.notebook_id !== currentNotebookId)
                  .map(notebook => (
                    <option key={notebook.notebook_id} value={notebook.notebook_id}>
                      {notebook.name}
                    </option>
                  ))}
              </select>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setBatchMoveModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-[#1a1a1a] rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30"
                >
                  确认移动
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI助手模态框 */}
      <AIModal 
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        context={JSON.stringify(getAIContext())}
        notes={filteredNotes}
      />
    </div>
  );
}

export default NotesPage;
