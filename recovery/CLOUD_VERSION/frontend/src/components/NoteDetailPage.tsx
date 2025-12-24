import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../apiClient';
import { formatDateTimeChinese } from '../utils/dateFormatter';
import NoteDocEditor, { type NoteDocContent, type OutlineItem } from './NoteDocEditor';

type Note = {
  note_id: string;
  notebook_id: string;
  title: string;
  content_text: string;
  created_at: string;
  updated_at: string;
  component_data?: any;
};

type Notebook = {
  notebook_id: string;
  name: string;
  description?: string;
};

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
const OUTLINE_OPEN_STORAGE_KEY = 'note-outline-open';
const OUTLINE_WIDTH_STORAGE_KEY = 'note-outline-width';
const NOTE_TITLE_MAX_LENGTH = 256;
const NOTE_TEXT_MAX_LENGTH = 100_000;

const OUTLINE_WIDTH_DEFAULT = 280;
const OUTLINE_WIDTH_MIN = 200;
const OUTLINE_WIDTH_MAX = 520;

const formatDateTimeSlash = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

const BackIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 1024 1024"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M640 810.666667c-12.8 0-21.333333-4.266667-29.866667-12.8l-256-256c-17.066667-17.066667-17.066667-42.666667 0-59.733334l256-256c17.066667-17.066667 42.666667-17.066667 59.733334 0s17.066667 42.666667 0 59.733334L443.733333 512l226.133334 226.133333c17.066667 17.066667 17.066667 42.666667 0 59.733334-8.533333 8.533333-17.066667 12.8-29.866667 12.8z"
      fill="currentColor"
    />
  </svg>
);

const SidebarToggleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 1024 1024"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M11.945301 540.842667L383.213568 912.110933a40.7552 40.7552 0 1 0 57.685333-57.685333L98.47330101 512 440.898901 169.608533a40.7552 40.7552 0 1 0-57.685333-57.685333L11.945301 483.157333a40.686933 40.686933 0 0 0 0 57.685334zM583.098368 540.842667L954.366635 912.110933a40.7552 40.7552 0 1 0 57.685333-57.685333L669.660501 512 1012.051968 169.608533a40.7552 40.7552 0 1 0-57.68533301-57.685333l-371.23413399 371.268267a40.686933 40.686933 0 0 0-0.034133 57.6512z"
      fill="currentColor"
    />
  </svg>
);

const escapeHtml = (input: string) =>
  (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const safeJsonParse = (value: unknown, fallback: any = null) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const isLikelyImageUrl = (rawUrl: string): boolean => {
  const candidate = (rawUrl || '').trim();
  if (!candidate) return false;
  if (!/^https?:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    const path = url.pathname.toLowerCase();
    const ext = path.includes('.') ? path.split('.').pop() || '' : '';
    if (ext && IMAGE_EXTENSIONS.includes(ext)) return true;
    const query = url.search.toLowerCase();
    if (
      query.includes('format=jpg') ||
      query.includes('format=jpeg') ||
      query.includes('format=png') ||
      query.includes('format=webp') ||
      query.includes('format=gif')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const extractImageUrlsFromHtml = (html: string): string[] => {
  const source = html || '';
  const urls: string[] = [];
  const imgRegex = /<img[^>]*\s+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = imgRegex.exec(source))) {
    const url = (match[1] || '').trim();
    if (url && isLikelyImageUrl(url)) urls.push(url);
  }
  return Array.from(new Set(urls));
};

const isHtmlEffectivelyEmpty = (html: string): boolean => {
  const normalized = (html || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!normalized) return true;
  // <p></p> / <p><br></p> / <p><br/></p> / multiple empty paragraphs
  return /^((<p>(<br\/?>)?<\/p>)+)$/.test(normalized);
};

const plainTextToHtml = (text: string): string => {
  const lines = (text || '').split('\n');
  const mdImageRegex = /^!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)\s*$/i;

  const parts = lines.map((line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return '<p><br/></p>';

    const mdMatch = trimmed.match(mdImageRegex);
    if (mdMatch?.[1] && isLikelyImageUrl(mdMatch[1])) {
      const url = escapeHtml(mdMatch[1]);
      return `<a href="${url}" target="_blank" rel="noreferrer"><img src="${url}" /></a>`;
    }

    if (isLikelyImageUrl(trimmed)) {
      const url = escapeHtml(trimmed);
      return `<a href="${url}" target="_blank" rel="noreferrer"><img src="${url}" /></a>`;
    }

    return `<p>${escapeHtml(line)}</p>`;
  });

  return parts.join('') || '<p><br/></p>';
};

const getNoteMetaValue = (note: Note | null): Record<string, any> => {
  if (!note?.component_data) return {};
  const parsed = safeJsonParse(note.component_data, {}) || {};
  const entry = parsed?.note_meta;
  const value = entry?.value;
  return value && typeof value === 'object' ? value : {};
};

const NoteDetailPage: React.FC = () => {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { note?: Note; notebook?: Notebook } | null;
  const initialNote = locationState?.note ?? null;

  const [note, setNote] = useState<Note | null>(initialNote);
  const [notebook, setNotebook] = useState<Notebook | null>(locationState?.notebook ?? null);
  const [loading, setLoading] = useState(() => !initialNote);
  const [error, setError] = useState<string | null>(null);
  const [editingNow, setEditingNow] = useState<Date>(() => new Date());

  const [title, setTitle] = useState<string>(initialNote?.title || '');
  const [contentHtml, setContentHtml] = useState<string>('');
  const [contentTextForSave, setContentTextForSave] = useState<string>(initialNote?.content_text || '');
  const [imgUrlsForSave, setImgUrlsForSave] = useState<string[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [outlineOpen, setOutlineOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const raw = window.localStorage.getItem(OUTLINE_OPEN_STORAGE_KEY);
      if (!raw) return true;
      return raw === '1';
    } catch {
      return true;
    }
  });
  const [outlineWidth, setOutlineWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return OUTLINE_WIDTH_DEFAULT;
    try {
      const raw = window.localStorage.getItem(OUTLINE_WIDTH_STORAGE_KEY);
      const num = raw ? Number(raw) : NaN;
      if (!Number.isFinite(num)) return OUTLINE_WIDTH_DEFAULT;
      return Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, num));
    } catch {
      return OUTLINE_WIDTH_DEFAULT;
    }
  });

  const saveTimerRef = useRef<number | null>(null);
  const lastSavedFingerprintRef = useRef<string>('');
  const savingInFlightRef = useRef<boolean>(false);
  const didInitFromEditorRef = useRef<boolean>(false);
  const outlineAsideRef = useRef<HTMLElement | null>(null);
  const resizingRef = useRef(false);
  const outlineWidthRef = useRef(outlineWidth);

  useEffect(() => {
    outlineWidthRef.current = outlineWidth;
  }, [outlineWidth]);
  const editingNowTimeoutRef = useRef<number | null>(null);
  const editingNowIntervalRef = useRef<number | null>(null);

  const fetchNoteDetail = useCallback(
    async (options: { withSpinner?: boolean } = {}) => {
      if (!noteId) return;
      const { withSpinner = true } = options;

      if (withSpinner) setLoading(true);
      setError(null);

      try {
        const response = await apiClient.get(`/api/note-detail-data?id=${noteId}`);
        const { data } = response;

        if (data?.error) {
          setError(data.error || '加载笔记失败');
          return;
        }

        if (data?.success && data?.note) {
          setNote(data.note);
          setNotebook(data.notebook);
        } else {
          setError(data?.error || data?.message || '加载笔记失败：数据格式异常');
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || '加载笔记失败');
      } finally {
        if (withSpinner) setLoading(false);
      }
    },
    [noteId]
  );

  useEffect(() => {
    if (!note && noteId) fetchNoteDetail();
  }, [fetchNoteDetail, note, noteId]);

  useEffect(() => {
    const tick = () => setEditingNow(new Date());
    tick();

    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    editingNowTimeoutRef.current = window.setTimeout(() => {
      tick();
      editingNowIntervalRef.current = window.setInterval(tick, 60_000);
    }, msToNextMinute);

    return () => {
      if (editingNowTimeoutRef.current) window.clearTimeout(editingNowTimeoutRef.current);
      if (editingNowIntervalRef.current) window.clearInterval(editingNowIntervalRef.current);
    };
  }, []);

  const initialHTML = useMemo(() => {
    if (!note) return '<p><br/></p>';
    const meta = getNoteMetaValue(note);
    const storedHtml = typeof meta.contentHtml === 'string' ? meta.contentHtml : '';
    if (storedHtml && storedHtml.trim()) return storedHtml;
    return plainTextToHtml(note.content_text || '');
  }, [note]);

  useEffect(() => {
    if (!note) return;
    didInitFromEditorRef.current = false;
    const isNewBlankDraft =
      (note.title || '').trim() === '未命名笔记' &&
      !(note.content_text || '').trim() &&
      isHtmlEffectivelyEmpty(initialHTML || '');
    setTitle(isNewBlankDraft ? '' : note.title || '');
    setContentTextForSave(note.content_text || '');
    setContentHtml(initialHTML);
    const fp = JSON.stringify({
      title: (isNewBlankDraft ? '' : note.title || '').trim(),
      content_text: note.content_text || '',
      content_html: initialHTML || ''
    });
    lastSavedFingerprintRef.current = fp;
    setSaveStatus('saved');
  }, [initialHTML, note?.note_id]);

  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        title: (title || '').trim(),
        content_text: contentTextForSave || '',
        content_html: contentHtml || ''
      }),
    [contentHtml, contentTextForSave, title]
  );

  const saveNow = useCallback(async () => {
    if (!noteId) return;
    if (savingInFlightRef.current) return;
    if (fingerprint === lastSavedFingerprintRef.current) return;

    const trimmedTitle = (title || '').trim();
    const trimmedText = (contentTextForSave || '').trim();
    const trimmedHtml = (contentHtml || '').trim();
    if (!trimmedTitle && !trimmedText && !trimmedHtml) {
      setSaveStatus('error');
      return;
    }
    if (trimmedTitle.length > NOTE_TITLE_MAX_LENGTH) {
      setSaveStatus('error');
      return;
    }
    if (trimmedText.length > NOTE_TEXT_MAX_LENGTH) {
      setSaveStatus('error');
      return;
    }

    savingInFlightRef.current = true;
    setSaveStatus('saving');
    try {
      const response = await apiClient.put(`/api/notes/${noteId}/content`, {
        title: trimmedTitle,
        content_text: contentTextForSave || '',
        content_html: contentHtml || '',
        img_urls: imgUrlsForSave
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.error || response?.data?.message || '保存失败');
      }
      lastSavedFingerprintRef.current = fingerprint;
      setSaveStatus('saved');
      const updated = response.data?.note;
      if (updated && typeof updated === 'object') {
        setNote((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    } catch (err: any) {
      setSaveStatus('error');
      console.error('❌ 自动保存失败:', err);
    } finally {
      savingInFlightRef.current = false;
    }
  }, [contentHtml, contentTextForSave, fingerprint, imgUrlsForSave, noteId, title]);

  useEffect(() => {
    if (!note) return;
    if (fingerprint === lastSavedFingerprintRef.current) {
      if (saveStatus !== 'saving') setSaveStatus('saved');
      return;
    }

    setSaveStatus((prev) => (prev === 'saving' ? prev : 'dirty'));
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveNow();
    }, 900);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [fingerprint, note, saveNow, saveStatus]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(OUTLINE_OPEN_STORAGE_KEY, outlineOpen ? '1' : '0');
    } catch {
      // ignore
    }
  }, [outlineOpen]);

  const handleStartResizeOutline = useCallback((event: React.MouseEvent) => {
    if (!outlineOpen) return;
    event.preventDefault();
    event.stopPropagation();

    resizingRef.current = true;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const clamp = (value: number) => Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, value));

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const rect = outlineAsideRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nextWidth = clamp(ev.clientX - rect.left);
      setOutlineWidth(nextWidth);
    };

    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      try {
        window.localStorage.setItem(OUTLINE_WIDTH_STORAGE_KEY, String(outlineWidthRef.current));
      } catch {
        // ignore
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [outlineOpen]);

  const handleEditorChange = useCallback(
    (content: NoteDocContent) => {
      const imgUrls = extractImageUrlsFromHtml(content.html);

      const baseText = (content.text || '').slice(0, NOTE_TEXT_MAX_LENGTH).trimEnd();

      setContentHtml(content.html);
      setContentTextForSave(baseText);
      setImgUrlsForSave(imgUrls);
      setOutline(content.outline || []);

      if (!didInitFromEditorRef.current) {
        didInitFromEditorRef.current = true;
        const nextFingerprint = JSON.stringify({
          title: (title || '').trim(),
          content_text: baseText || '',
          content_html: content.html || ''
        });
        lastSavedFingerprintRef.current = nextFingerprint;
        setSaveStatus('saved');
      }
    },
    [title]
  );

  const handleJumpToOutline = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const saveLabel = useMemo(() => {
    if (saveStatus === 'saving') return '保存中…';
    if (saveStatus === 'saved') return '已保存';
    if (saveStatus === 'dirty') return '未保存';
    if (saveStatus === 'error') return '保存失败';
    return '';
  }, [saveStatus]);

  const updatedLabel = useMemo(() => {
    if (!note?.updated_at) return '';
    return `最近修改：${formatDateTimeChinese(note.updated_at)}`;
  }, [note?.updated_at]);

  if (loading) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center">
        <div className="text-sm text-slate-500">加载中…</div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="min-h-screen bg-sky-50 flex items-center justify-center px-4">
        <div className="max-w-md rounded-2xl bg-white p-6 shadow-sm border border-sky-200">
          <div className="text-sm font-medium text-slate-900 mb-2">加载失败</div>
          <div className="text-xs text-slate-500 whitespace-pre-wrap">{error || '未找到笔记'}</div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => navigate(-1)}
              className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs text-sky-700 hover:bg-sky-50"
            >
              返回
            </button>
            <button
              onClick={() => fetchNoteDetail()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-sky-50 flex flex-col">
      <div className="sticky top-0 z-30 border-b border-sky-200 bg-sky-50/90 backdrop-blur">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex h-8 w-8 items-center justify-center text-sky-700 hover:text-sky-800"
              title="返回"
            >
              <BackIcon className="h-5 w-5" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                {saveLabel ? <span>{saveLabel}</span> : null}
                <span>
                  {notebook?.name ? `来自「${notebook.name}」` : '笔记详情'}
                  {updatedLabel ? <span className="ml-2">{updatedLabel}</span> : null}
                </span>
              </div>
            </div>
          </div>
          <div />
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <aside
          ref={outlineAsideRef}
          className={[
            'relative flex-shrink-0 border-r border-sky-200 bg-sky-50/80 overflow-y-auto transition-[width] duration-200'
          ].join(' ')}
          style={{ width: outlineOpen ? outlineWidth : 48 }}
        >
          {outlineOpen ? (
            <>
              <div className="pl-4 pr-3 py-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOutlineOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center text-sky-700 hover:text-sky-800"
                    title="收起目录"
                  >
                    <SidebarToggleIcon className="h-4 w-4" />
                  </button>
                  <div className="text-xs font-medium text-slate-600">目录</div>
                </div>
              </div>
              <div className="px-2 pb-6">
                {outline.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400">暂无标题</div>
                ) : (
                  <ul className="space-y-1">
                    {outline.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => handleJumpToOutline(item.id)}
                          className="w-full rounded-lg px-3 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-100"
                          style={{ paddingLeft: 12 + (item.level - 1) * 12 }}
                          title={item.text}
                        >
                          <div className="truncate">{item.text}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-start py-3 pl-4 pr-0">
              <button
                type="button"
                onClick={() => setOutlineOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center text-sky-700 hover:text-sky-800"
                title="展开目录"
              >
                <SidebarToggleIcon className="h-4 w-4 rotate-180" />
              </button>
            </div>
          )}

          {outlineOpen ? (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleStartResizeOutline}
              onDoubleClick={() => {
                setOutlineWidth(OUTLINE_WIDTH_DEFAULT);
                try {
                  window.localStorage.setItem(OUTLINE_WIDTH_STORAGE_KEY, String(OUTLINE_WIDTH_DEFAULT));
                } catch {
                  // ignore
                }
              }}
              className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none"
              title="拖动调整目录宽度（双击重置）"
            >
              <div className="mx-auto h-full w-px bg-sky-200/80" />
            </div>
          ) : null}
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1100px] px-6 py-10">
            <input
              value={title}
              maxLength={NOTE_TITLE_MAX_LENGTH}
              onChange={(e) => setTitle(e.target.value.slice(0, NOTE_TITLE_MAX_LENGTH))}
              placeholder="请输入标题..."
              className="w-full bg-transparent px-10 text-[24px] font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-300"
            />

            <div className="mt-2 px-10 text-[12px] text-slate-400">
              编辑于：{formatDateTimeSlash(editingNow)}
            </div>

            <div className="mt-3">
              <NoteDocEditor
                key={note.note_id}
                initialHTML={initialHTML}
                placeholder="请输入正文..."
                onChange={handleEditorChange}
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default NoteDetailPage;
