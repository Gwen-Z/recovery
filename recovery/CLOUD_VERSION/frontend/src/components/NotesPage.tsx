import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient, { Notebook } from '../apiClient';
import MoveNoteModal from './MoveNoteModal';
import CustomNotebookModal from './CustomNotebookModal';
import { onConfigUpdate } from '../utils/componentSync';

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
  // 仅移除 fenced JSON code blocks，避免误删正文里的 { } / [ ]
  const cleaned = text.replace(/```json[\s\S]*?```/gi, '');
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
  highlightNoteId,
  batchMode, 
  isSelected, 
  onSelect,
  onNotify
}: { 
  note: Note; 
  displayTitle: string;
  onNoteClick: () => void;
  notebooks: Notebook[];
  currentNotebookId: string;
  highlightNoteId: string | null;
  batchMode: boolean;
  isSelected: boolean;
  onSelect: (noteId: string) => void;
  onNotify?: (message: string) => void;
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
      if (onNotify) onNotify('移动失败，请重试');
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

  const currentNoteId = String(note.id || note.note_id || '');
  const isHighlighted = !!highlightNoteId && currentNoteId && highlightNoteId === currentNoteId;

  return (
    <div 
      data-note-id={currentNoteId || undefined}
      className={`bg-white p-3 rounded-xl border border-gray-200 flex items-center justify-between hover:shadow-sm transition-shadow duration-200 cursor-default ${
        isSelected ? 'ring-2 ring-[#43ccb0] bg-[#eef6fd]' : ''
      } ${isHighlighted ? 'ring-2 ring-[#b5ece0] border-[#90e2d0] bg-white/90' : ''}`}
    >
      <div className="flex items-center gap-3">
        {batchMode && (
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onSelect(note.id || note.note_id || '')}
              className="h-4 w-4 text-[#0a917a] focus:ring-[#43ccb0] border-gray-300 rounded"
            />
          </div>
        )}
        <div className="w-16 h-12 bg-gradient-to-br from-[#d4f3ed] to-blue-100 rounded-xl flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[#0a917a]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="flex flex-col justify-center flex-1 h-12">
          {renaming ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input 
                className="border border-[#90e2d0] rounded-lg px-2 py-1 text-sm focus:border-[#43ccb0] focus:ring-1 focus:ring-[#43ccb0] focus:outline-none" 
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
                    if (onNotify) onNotify('重命名失败，请重试');
                  }
                }} 
                className="text-xs px-2 py-1 rounded-lg bg-[#06c3a8] text-white hover:bg-[#04b094] shadow-lg shadow-[#8de2d5] transition-colors"
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
                className="text-xs px-2 py-1 rounded-lg border border-[#90e2d0] text-[#0a917a] hover:bg-[#eef6fd] transition-colors"
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
          className="menu-button p-2 rounded-full hover:bg-[#d4f3ed]"
          style={{ zIndex: 1000 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-500" viewBox="0 0 20 20" fill="currentColor"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
        </button>
        {menuOpen && (
          <div 
            className="dropdown-menu absolute top-8 right-0 w-40 bg-white rounded-2xl shadow-xl border-2 border-[#b5ece0] z-50 overflow-hidden text-xs"
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
                  if (onNotify) onNotify('无来源链接');
                }
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-slate-900 hover:bg-[#eef6fd]"
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
              className="w-full text-left px-4 py-2 text-slate-900 hover:bg-[#eef6fd] hover:text-[#0a6154] transition-colors"
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
              className="w-full text-left px-4 py-2 text-slate-900 hover:bg-[#eef6fd]"
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
                    if (onNotify) onNotify('删除失败，请重试');
                  }
                }
                setMenuOpen(false);
              }} 
              className="w-full text-left px-4 py-2 text-rose-600 hover:bg-rose-50"
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
          className="px-1.5 py-0.5 text-xs rounded-xl border border-gray-300 text-gray-700 hover:bg-[#eef6fd] hover:border-[#b5ece0] hover:text-[#0a6154] transition-colors"
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
  const location = useLocation();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [currentNotebookId, setCurrentNotebookId] = useState<string>(notebookId);
  const notesCacheRef = useRef<Map<string, { notes: Note[]; notebook: Notebook | null; fetchedAt: number }>>(new Map());
  const lastFetchRef = useRef<Map<string, number>>(new Map());
  const notesRequestIdRef = useRef(0);
  const notebooksRequestIdRef = useRef(0);
  
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false); // 首次加载后不再整页loading
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  
  // 批量操作状态
  const [batchMode, setBatchMode] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [creatingNote, setCreatingNote] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [customNotebookModalOpen, setCustomNotebookModalOpen] = useState(false);
  const createMenuRootRef = useRef<HTMLDivElement | null>(null);

  const highlightNoteId = useRef<string | null>(null);
  const [activeHighlightNoteId, setActiveHighlightNoteId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const id = params.get('highlightNoteId');
      highlightNoteId.current = id ? String(id) : null;
      setActiveHighlightNoteId(highlightNoteId.current);
    } catch {
      highlightNoteId.current = null;
      setActiveHighlightNoteId(null);
    }
  }, [location.search]);

  useEffect(() => {
    const id = activeHighlightNoteId;
    if (!id) return;
    if (!notes || notes.length === 0) return;
    const timer = window.setTimeout(() => {
      const selectorId = id.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-note-id="${selectorId}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    const clearTimer = window.setTimeout(() => setActiveHighlightNoteId(null), 3500);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [activeHighlightNoteId, notes]);
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
  
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 1600);
  }, []);

  const isFilterActive = useMemo(
    () => Boolean(searchQuery.trim() || dateFilter.startDate || dateFilter.endDate),
    [searchQuery, dateFilter.startDate, dateFilter.endDate]
  );

  const selectableNoteIds = useMemo(() => {
    const source = isFilterActive ? filteredNotes : notes;
    return source.map((note) => String(note.id || note.note_id || '')).filter(Boolean);
  }, [filteredNotes, isFilterActive, notes]);

  const allSelectedInScope = useMemo(() => {
    if (!selectableNoteIds.length) return false;
    return selectableNoteIds.every((id) => selectedNotes.includes(id));
  }, [selectableNoteIds, selectedNotes]);

  // 点击外部区域关闭“新建”下拉菜单
  useEffect(() => {
    if (!createMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (createMenuRootRef.current && createMenuRootRef.current.contains(target)) return;
      setCreateMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [createMenuOpen]);

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
        const noteDate = new Date(note.created_at || note.updated_at || '');
        if (Number.isNaN(noteDate.getTime())) return false;
        const startDate = dateFilter.startDate ? new Date(`${dateFilter.startDate}T00:00:00`) : null;
        const endDate = dateFilter.endDate ? new Date(`${dateFilter.endDate}T23:59:59.999`) : null;
        
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
    const requestId = (notebooksRequestIdRef.current += 1);
    try {
      const notebooksList = await apiClient.getNotebooks();
      if (isMountedRef.current && requestId === notebooksRequestIdRef.current) {
        setNotebooks(notebooksList);
      }
    } catch (err) {
      console.error('Failed to load notebooks:', err);
    }
  }, []);

  const fetchNotes = useCallback(
    async ({ forceNetwork = false }: { forceNetwork?: boolean } = {}) => {
      const requestId = (notesRequestIdRef.current += 1);
      const requestNotebookId = notebookId;
      if (!notebookId) {
        if (isMountedRef.current) {
          setLoading(false);
          setNotebook(null);
          setNotes([]);
        }
        return;
      }

      const cached = notesCacheRef.current.get(notebookId);
      const hadCache = Boolean(cached);
      const now = Date.now();

      if (cached && isMountedRef.current) {
        setNotebook(prev => prev ?? cached.notebook);
        setNotes(cached.notes);
        setLoading(false);
        setHasLoadedOnce(true);

        const lastFetchedAt = lastFetchRef.current.get(notebookId) ?? cached.fetchedAt;
        if (!forceNetwork && now - lastFetchedAt < 5000) {
          return;
        }
      }

      if (isMountedRef.current) {
        // 仅在无缓存且从未加载过时才显示整体加载态，避免切换闪烁
        setLoading(!hadCache && !hasLoadedOnce);
        setError(null);
      }

      try {
        const response = await apiClient.get('/api/notes', {
          params: { notebook_id: notebookId }
        });
        if (!isMountedRef.current || requestId !== notesRequestIdRef.current) return;
        if (requestNotebookId !== notebookId) return;
        
        const data = response.data;

        if (data?.success === false) {
          const message = data?.message || `加载笔记失败 (HTTP ${response.status})`;
          if (isMountedRef.current) {
            setError(message);
            if (!cached) {
              setNotebook(null);
              setNotes([]);
            }
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

        if (isMountedRef.current && requestId === notesRequestIdRef.current) {
          setNotebook(notebookPayload);
          setNotes(notesPayload);
          setLoading(false);
          setHasLoadedOnce(true);
          notesCacheRef.current.set(notebookId, {
            notes: notesPayload,
            notebook: notebookPayload,
            fetchedAt: Date.now()
          });
          lastFetchRef.current.set(notebookId, Date.now());
        }
      } catch (err: unknown) {
        console.error('❌ Error fetching notes:', err);
        if (!isMountedRef.current || requestId !== notesRequestIdRef.current) return;
        const message = `加载笔记失败：${getErrorMessage(err, '请稍后再试')}`;
        setError(message);
        if (!cached) {
          setNotebook(null);
          setNotes([]);
        } else {
          showNotice(message);
        }
      } finally {
        if (isMountedRef.current && requestId === notesRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [notebookId, normalizeNotes, hasLoadedOnce, showNotice]
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

  // 监听新建笔记本事件，刷新笔记本列表
  useEffect(() => {
    const handleNotebookCreated = () => {
      loadNotebooks();
    };
    window.addEventListener('notebook:created', handleNotebookCreated as EventListener);
    return () => window.removeEventListener('notebook:created', handleNotebookCreated as EventListener);
  }, [loadNotebooks]);

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
    if (!selectableNoteIds.length) return;
    if (allSelectedInScope) {
      setSelectedNotes((prev) => prev.filter((id) => !selectableNoteIds.includes(id)));
      return;
    }
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      selectableNoteIds.forEach((id) => next.add(id));
      return Array.from(next);
    });
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
      showNotice('批量删除失败，请重试');
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
      showNotice('批量移动失败，请重试');
    }
  };

  if (loading && !hasLoadedOnce) {
    return <div className="flex items-center justify-center h-full text-gray-500">Loading notes...</div>;
  }

  const fatalError = Boolean(error) && notes.length === 0 && !hasLoadedOnce;
  if (fatalError) {
    return <div className="flex items-center justify-center h-full text-red-500">{error}</div>;
  }

  if (!notebook) {
    return <div className="flex items-center justify-center h-full text-gray-500">Select a notebook to view notes.</div>;
  }

  return (
    <div className="pl-2 pr-6 pt-0 pb-12">
      {notice && (
        <div className="mb-4 rounded-xl border border-[#d4f3ed] bg-white/80 px-4 py-2 text-sm text-[#0a917a] shadow-sm">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {/* Header Section */}
      <div className="mb-6">
        <div className="grid grid-cols-[260px_1fr] gap-4 items-stretch">
          <div className="flex flex-col justify-center bg-white p-4 rounded-2xl border border-gray-200 shadow-sm w-[260px] min-w-[260px] h-full">
            <div className="text-xs text-gray-500 space-y-1">
              <div className="whitespace-nowrap">
                当前位置：<span className="text-[#0a917a] font-medium">{notebook.name}</span>
              </div>
              <div className="whitespace-nowrap">
                创建于：{new Date(notebook.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="whitespace-nowrap">
                笔记数：{notebook.note_count} 篇
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-3 justify-between h-full">
            {/* 日期筛选 */}
            <div className="flex items-start justify-end gap-3 flex-wrap">
              {/* 日期筛选器 */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 whitespace-nowrap">时间区间</span>
                <input
                  type="date"
                  value={dateFilter.startDate}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                  className="px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#43ccb0]"
                />
                <span className="text-xs text-gray-500">至</span>
                <input
                  type="date"
                  value={dateFilter.endDate}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                  className="px-3 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#43ccb0]"
                />
                <button
                  type="button"
                  onClick={() => {
                    refreshNotes();
                    showNotice('已刷新');
                  }}
                  className="px-3 py-2 text-xs font-medium text-white bg-[#06c3a8] rounded-lg hover:bg-[#04b094] shadow-lg shadow-[#8de2d5]"
                >
                  查询
                </button>
              </div>
            </div>
            
            {/* 搜索、筛选、批量操作等按钮 */}
            <div className="flex items-center justify-end gap-2 flex-wrap">
                {/* 搜索框 */}
                <div className="relative w-48">
                    <input 
                      type="text" 
                      placeholder="搜索笔记..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-24 px-3 py-2 text-xs font-medium border border-gray-300 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#43ccb0]" 
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
                      ? 'text-white bg-[#06c3a8] hover:bg-[#04b094] shadow-lg shadow-[#8de2d5]' 
                      : 'text-gray-700 bg-white border border-gray-300 hover:bg-[#eef6fd] hover:border-[#b5ece0]'
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
                    <div
                      ref={createMenuRootRef}
                      className="relative inline-flex rounded-2xl border border-gray-300 bg-white"
                    >
                      <button
                        type="button"
                        disabled={creatingNote}
                        onClick={async () => {
                          try {
                            if (creatingNote) return;
                            if (!notebookId) {
                              showNotice('未选择笔记本');
                              return;
                            }

                            setCreatingNote(true);
                            const response = await apiClient.post('/api/notes', {
                              notebook_id: notebookId,
                              title: '未命名笔记',
                              content_text: '',
                              component_data: {
                                note_meta: {
                                  type: 'meta',
                                  title: 'note_meta',
                                  value: { sourceType: 'manual', contentHtml: '<p></p>', imgUrls: [] }
                                }
                              },
                              source_type: 'manual',
                              skipAI: true
                            });

                            const created = response?.data?.note;
                            const createdId = created?.note_id || created?.noteId;
                            if (!createdId) {
                              throw new Error(response?.data?.error || response?.data?.message || '创建失败');
                            }

                            navigate(`/note/${createdId}`, { state: { note: created, notebook } });
                          } catch (err: any) {
                            showNotice(
                              err?.response?.data?.error ||
                                err?.response?.data?.message ||
                                err?.message ||
                                '创建笔记失败'
                            );
                          } finally {
                            setCreatingNote(false);
                          }
                        }}
                        className="rounded-l-2xl px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[#eef6fd] disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2 whitespace-nowrap"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                          />
                        </svg>
                        {creatingNote ? '创建中…' : '新建笔记'}
                      </button>
                      <button
                        type="button"
                        disabled={creatingNote}
                        onClick={() => setCreateMenuOpen((v) => !v)}
                        className="rounded-r-2xl px-2 py-2 text-gray-600 hover:bg-[#eef6fd] disabled:cursor-not-allowed disabled:opacity-60 border-l border-gray-300"
                        aria-haspopup="menu"
                        aria-expanded={createMenuOpen}
                        title="更多创建选项"
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${createMenuOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M6 9l6 6 6-6"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>

                      {createMenuOpen && (
                        <div className="absolute right-0 top-full z-[999] mt-2 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setCreateMenuOpen(false);
                              setCustomNotebookModalOpen(true);
                            }}
                            className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-[#eef6fd] flex items-center gap-2"
                          >
                            <svg
                              className="h-4 w-4 text-[#0a917a]"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
                                stroke="currentColor"
                                strokeWidth="1.6"
                              />
                              <path
                                d="M8 9h8M8 12h8M8 15h5"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                              />
                            </svg>
                            新建笔记本
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
            </div>
          </div>
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
            highlightNoteId={activeHighlightNoteId}
            batchMode={batchMode}
            isSelected={selectedNotes.includes(note.id || note.note_id || '')}
            onSelect={handleNoteSelect}
            onNotify={showNotice}
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
            <h2 className="text-xl font-bold mb-4 text-[#0a917a]">移动笔记</h2>
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
                  className="px-4 py-2 text-sm font-medium text-white bg-[#06c3a8] rounded-lg hover:bg-[#04b094] shadow-lg shadow-[#8de2d5]"
                >
                  确认移动
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CustomNotebookModal
        open={customNotebookModalOpen}
        onClose={() => setCustomNotebookModalOpen(false)}
        onCreated={loadNotebooks}
      />

    </div>
  );
}

export default NotesPage;
