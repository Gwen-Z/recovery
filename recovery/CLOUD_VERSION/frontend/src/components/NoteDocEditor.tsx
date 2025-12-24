import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { createPortal } from 'react-dom';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Highlight } from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import { ReactNodeViewRenderer } from '@tiptap/react';
import CodeBlockComponent from './CodeBlockComponent';
import { Extension } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';

export type OutlineItem = {
  id: string;
  level: 1 | 2 | 3;
  text: string;
};

export type NoteDocContent = {
  html: string;
  text: string;
  outline: OutlineItem[];
};

export type NoteDocEditorProps = {
  initialHTML: string;
  onChange?: (content: NoteDocContent, editor: Editor) => void;
  placeholder?: string;
  className?: string;
};

const lowlight = createLowlight();
lowlight.register({ javascript, typescript, python, css, json, xml });

type BlockTypeId =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bullet'
  | 'ordered'
  | 'todo'
  | 'quote'
  | 'code';

const getActiveBlockType = (editor: Editor): { id: BlockTypeId; label: string } => {
  if (editor.isActive('codeBlock')) return { id: 'code', label: '</>' };
  if (editor.isActive('blockquote')) return { id: 'quote', label: '“”' };
  if (editor.isActive('taskList') || editor.isActive('taskItem')) return { id: 'todo', label: '☑' };
  if (editor.isActive('orderedList')) return { id: 'ordered', label: '1.' };
  if (editor.isActive('bulletList')) return { id: 'bullet', label: '•' };
  if (editor.isActive('heading', { level: 1 })) return { id: 'heading1', label: 'H1' };
  if (editor.isActive('heading', { level: 2 })) return { id: 'heading2', label: 'H2' };
  if (editor.isActive('heading', { level: 3 })) return { id: 'heading3', label: 'H3' };
  return { id: 'paragraph', label: '正文' };
};

const getAlignLabel = (editor: Editor): string => {
  if (editor.isActive({ textAlign: 'center' })) return '居中';
  if (editor.isActive({ textAlign: 'right' })) return '居右';
  return '居左';
};

const BlockBackground = Extension.create({
  name: 'blockBackground',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          blockBg: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-block-bg') || null,
            renderHTML: (attributes: Record<string, any>) => {
              if (!attributes.blockBg) return {};
              return {
                'data-block-bg': String(attributes.blockBg),
                style: `background-color:${String(attributes.blockBg)};border-radius:10px;padding:8px 10px;`
              };
            }
          }
        }
      }
    ];
  }
});

const MaxTextLength = Extension.create<{ limit: number; onExceed?: (limit: number) => void }>({
  name: 'maxTextLength',
  addOptions() {
    return { limit: 100000, onExceed: undefined };
  },
  addProseMirrorPlugins() {
    const limit = this.options.limit;
    const onExceed = this.options.onExceed;
    return [
      new Plugin({
        filterTransaction: (tr, state) => {
          if (!tr.docChanged) return true;
          // 注意：这里不能调用 state.apply(tr)，否则会触发 filterTransaction 递归，导致所有命令看起来“没反应”
          const text = tr.doc.textBetween(0, tr.doc.content.size, '\n', '\n');
          if (text.length <= limit) return true;
          onExceed?.(limit);
          return false;
        }
      })
    ];
  }
});

const slugify = (value: string) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .slice(0, 48) || 'section';

const buildOutlineFromDom = (root: HTMLElement): OutlineItem[] => {
  const headings = Array.from(root.querySelectorAll('h1,h2,h3')) as HTMLElement[];
  const outline: OutlineItem[] = [];
  headings.forEach((el, index) => {
    const tag = el.tagName.toLowerCase();
    const level = tag === 'h1' ? 1 : tag === 'h2' ? 2 : 3;
    const text = (el.innerText || '').trim();
    if (!text) return;
    const id = `h-${level}-${slugify(text)}-${index}`;
    el.id = id;
    el.dataset.outlineId = id;
    outline.push({ id, level: level as 1 | 2 | 3, text });
  });
  return outline;
};

const isImageUrl = (raw: string) => {
  const candidate = (raw || '').trim();
  if (!candidate) return false;
  if (!/^https?:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    const path = url.pathname.toLowerCase();
    const ext = path.includes('.') ? path.split('.').pop() || '' : '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return true;
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

const NoteDocEditor: React.FC<NoteDocEditorProps> = ({
  initialHTML,
  onChange,
  placeholder = '开始写作…',
  className
}) => {
  const GUTTER_PX = 64;
  const HANDLE_GAP_PX = 12;
  const HANDLE_ANCHOR_LEFT = GUTTER_PX - HANDLE_GAP_PX;

  const contentRootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [bubbleColorOpen, setBubbleColorOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [handleTop, setHandleTop] = useState(16);
  const [activeBlockType, setActiveBlockType] = useState<{ id: BlockTypeId; label: string }>({
    id: 'paragraph',
    label: '正文'
  });
  const [activeAlign, setActiveAlign] = useState('居左');
  const [selectedTextColor, setSelectedTextColor] = useState<string>('');
  const [selectedHighlightColor, setSelectedHighlightColor] = useState<string>('');
  const [limitHint, setLimitHint] = useState('');
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [selectionToolbarPos, setSelectionToolbarPos] = useState<{
    top: number;
    left: number;
    placement: 'top' | 'bottom';
  } | null>(null);

  const extensions = useMemo(
    () => [
      MaxTextLength.configure({
        limit: 100000,
        onExceed: (limit) => {
          setLimitHint(`文本最多不超过 ${limit.toLocaleString()} 字`);
          window.setTimeout(() => setLimitHint(''), 1600);
        }
      }),
      BlockBackground,
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        codeBlock: false
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { class: 'tiptap-link' }
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList.configure({ HTMLAttributes: { class: 'tiptap-task-list' } }),
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockComponent);
        }
      }).configure({
        lowlight,
        HTMLAttributes: { class: 'hljs' }
      }),
      Underline,
      Image,
      Placeholder.configure({ placeholder })
    ],
    [placeholder]
  );

  const syncToolbarState = useCallback((instance: Editor) => {
    setActiveBlockType(getActiveBlockType(instance));
    setActiveAlign(getAlignLabel(instance));
    const color = instance.getAttributes('textStyle')?.color;
    if (typeof color === 'string') setSelectedTextColor(color);
    const highlight = instance.getAttributes('highlight')?.color;
    if (typeof highlight === 'string') setSelectedHighlightColor(highlight);
  }, []);

  const editor = useEditor({
    extensions,
    content: initialHTML || '<p></p>',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const text = editor.getText();
      syncToolbarState(editor);

      // 等 DOM 更新后再扫描 heading，避免 outline 滞后
      window.requestAnimationFrame(() => {
        const root = contentRootRef.current;
        if (!root) return;
        const outline = buildOutlineFromDom(root);
        onChange?.({ html, text, outline }, editor);
      });
    },
    onSelectionUpdate: ({ editor }) => {
      syncToolbarState(editor);
      try {
        updateFloatingUi(editor);
      } catch {
        // ignore
      }
    },
    editorProps: {
      attributes: {
        class: [
          'w-full max-w-none outline-none',
          'text-[14px] leading-[1.75] text-slate-900',
          '[&_h1]:text-[24px] [&_h1]:font-semibold [&_h1]:mt-10 [&_h1]:mb-4',
          '[&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3',
          '[&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-3',
          '[&_p]:my-2',
          '[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3',
          '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3',
          '[&_ul[data-type="taskList"]]:list-none [&_ul[data-type="taskList"]]:pl-0 [&_ul[data-type="taskList"]]:my-3',
          '[&_li[data-type="taskItem"]]:flex [&_li[data-type="taskItem"]]:items-start [&_li[data-type="taskItem"]]:gap-2',
          '[&_li[data-type="taskItem"]>label]:mt-[3px] [&_li[data-type="taskItem"]>label]:flex-shrink-0',
          '[&_li[data-type="taskItem"]>label>input]:h-4 [&_li[data-type="taskItem"]>label>input]:w-4',
          '[&_li[data-type="taskItem"]>div]:flex-1',
          '[&_a]:text-[#1f4fd9] [&_a]:underline',
          '[&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-sky-200 [&_img]:my-3',
          '[&_pre]:rounded-xl [&_pre]:border [&_pre]:border-sky-200 [&_pre]:bg-sky-50 [&_pre]:p-3'
        ].join(' '),
        spellCheck: 'true'
      },
      handleDOMEvents: {
        focus: () => {
          setIsFocused(true);
          return false;
        },
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return false;
          if (target.tagName !== 'IMG') return false;
          const img = target as HTMLImageElement;
          const src = (img.getAttribute('src') || '').trim();
          if (!src || !/^https?:\/\//i.test(src)) return false;
          try {
            window.open(src, '_blank', 'noreferrer');
            event.preventDefault();
            event.stopPropagation();
            return true;
          } catch {
            return false;
          }
        },
        blur: () => {
          // 当块菜单打开时，点击菜单不应导致编辑器失焦后菜单立刻关闭
          if (menuOpen) {
            return false;
          }
          setIsFocused(false);
          setMenuOpen(false);
          setColorOpen(false);
          setBubbleColorOpen(false);
          return false;
        }
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') || '';
        const trimmed = text.trim();
        if (trimmed && isImageUrl(trimmed) && editor) {
          event.preventDefault();
          editor.chain().focus().setImage({ src: trimmed }).run();
          return true;
        }
        return false;
      }
    }
  });

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setColorOpen(false);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menuRootRef.current && menuRootRef.current.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeMenu, menuOpen]);

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn();
      setColorOpen(false);
      closeMenu();
    },
    [closeMenu]
  );

  const runNoClose = useCallback((fn: () => void) => {
    fn();
  }, []);

  const execToolbar = useCallback(
    (event: React.MouseEvent, action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        editor.commands.focus();
        action();
        syncToolbarState(editor);
      } catch {
        // ignore
      }
    },
    [editor, syncToolbarState]
  );

  const applyLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link')?.href as string | undefined;
    const url = window.prompt('输入链接 URL（留空则移除）', prev || '');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }, [editor]);

  const TEXT_COLORS: Array<{ label: string; value: string }> = [
    { label: '默认', value: '' },
    { label: '黑', value: '#0f172a' },
    { label: '灰', value: '#64748b' },
    { label: '红', value: '#ef4444' },
    { label: '橙', value: '#f97316' },
    { label: '黄', value: '#eab308' },
    { label: '绿', value: '#22c55e' },
    { label: '蓝', value: '#3b82f6' },
    { label: '紫', value: '#a855f7' }
  ];

  const BG_COLORS: Array<{ label: string; value: string }> = [
    { label: '无', value: '' },
    { label: '浅灰', value: '#f1f5f9' },
    { label: '浅红', value: '#fee2e2' },
    { label: '浅橙', value: '#ffedd5' },
    { label: '浅黄', value: '#fef9c3' },
    { label: '浅绿', value: '#dcfce7' },
    { label: '浅蓝', value: '#dbeafe' },
    { label: '浅紫', value: '#f3e8ff' },
    { label: '灰', value: '#e5e7eb' },
    { label: '红', value: '#fecaca' },
    { label: '橙', value: '#fed7aa' },
    { label: '黄', value: '#fde68a' },
    { label: '绿', value: '#bbf7d0' },
    { label: '蓝', value: '#bfdbfe' },
    { label: '紫', value: '#e9d5ff' }
  ];

  const BLOCK_BGS: Array<{ label: string; value: string }> = [
    { label: '无', value: '' },
    { label: '浅灰', value: '#f1f5f9' },
    { label: '浅红', value: '#fee2e2' },
    { label: '浅橙', value: '#ffedd5' },
    { label: '浅黄', value: '#fef9c3' },
    { label: '浅绿', value: '#dcfce7' },
    { label: '浅蓝', value: '#dbeafe' },
    { label: '浅紫', value: '#f3e8ff' }
  ];

  const applyBlockBackground = useCallback(
    (value: string) => {
      if (!editor) return;
      const attrs = value ? { blockBg: value } : { blockBg: null };
      editor.chain().focus().updateAttributes('paragraph', attrs).updateAttributes('heading', attrs).run();
    },
    [editor]
  );

  const applyTextColor = useCallback(
    (value: string) => {
      if (!editor) return;
      if (!value) {
        editor.chain().focus().unsetColor().run();
        setSelectedTextColor('');
        return;
      }
      editor.chain().focus().setColor(value).run();
      setSelectedTextColor(value);
    },
    [editor]
  );

  const applyTextHighlight = useCallback(
    (value: string) => {
      if (!editor) return;
      if (!value) {
        editor.chain().focus().unsetHighlight().run();
        setSelectedHighlightColor('');
        return;
      }
      editor.chain().focus().setHighlight({ color: value }).run();
      setSelectedHighlightColor(value);
    },
    [editor]
  );

  const resetColors = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().unsetColor().unsetHighlight().run();
    setSelectedTextColor('');
    setSelectedHighlightColor('');
    editor
      .chain()
      .focus()
      .updateAttributes('paragraph', { blockBg: null })
      .updateAttributes('heading', { blockBg: null })
      .run();
  }, [editor]);

  const updateFloatingUi = useCallback(
    (instance?: Editor) => {
      const active = instance ?? editor;
      const root = contentRootRef.current;
      if (!active || !root) return;

      const selection = active.state.selection;
      const coords = active.view.coordsAtPos(selection.from);
      const rect = root.getBoundingClientRect();
      const nextTop = Math.max(12, coords.top - rect.top - 6);
      setHandleTop(nextTop);

      if (selection.empty) {
        setSelectionToolbarPos(null);
        setBubbleColorOpen(false);
        return;
      }

      // 选中内容时：使用选区工具条，避免块菜单/颜色面板穿透
      setMenuOpen(false);
      setColorOpen(false);

      const fromCoords = active.view.coordsAtPos(selection.from);
      const toCoords = active.view.coordsAtPos(selection.to);
      const minLeft = Math.min(fromCoords.left, toCoords.left);
      const maxRight = Math.max(fromCoords.right, toCoords.right);
      const minTop = Math.min(fromCoords.top, toCoords.top);
      const maxBottom = Math.max(fromCoords.bottom, toCoords.bottom);
      const anchorX = (minLeft + maxRight) / 2;

      const viewportPadding = 12;
      const approxHalfWidth = 240;
      const clampedLeft = Math.min(
        window.innerWidth - approxHalfWidth - viewportPadding,
        Math.max(approxHalfWidth + viewportPadding, anchorX)
      );

      const preferredTop = minTop - 56;
      const placeAbove = preferredTop >= viewportPadding;
      const top = placeAbove ? preferredTop : maxBottom + 12;

      setSelectionToolbarPos({
        top: Math.max(viewportPadding, top),
        left: clampedLeft,
        placement: placeAbove ? 'top' : 'bottom'
      });
    },
    [editor]
  );

  // 初次挂载时也要生成一次 outline
  useEffect(() => {
    if (!editor) return;
    window.requestAnimationFrame(() => {
      const root = contentRootRef.current;
      if (!root) return;
      const outline = buildOutlineFromDom(root);
      onChange?.({ html: editor.getHTML(), text: editor.getText(), outline }, editor);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // 选区工具栏是 fixed，需要在滚动/缩放时更新位置
  useEffect(() => {
    if (!editor) return;
    if (!isFocused) return;
    if (!selectionToolbarPos) return;

    const handler = () => updateFloatingUi();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [editor, isFocused, selectionToolbarPos, updateFloatingUi]);

  if (!editor) return null;

  return (
    <div className={className}>
      <div
        ref={contentRootRef}
        className="relative pr-10 pt-4 pb-10 pl-16"
      >
        {isFocused && selectionToolbarPos ? (
          createPortal(
            <div
              className="fixed z-[9999]"
              style={{
                top: selectionToolbarPos.top,
                left: selectionToolbarPos.left,
                transform: 'translateX(-50%)'
              }}
              role="toolbar"
              aria-label="格式工具栏"
              onMouseDown={(e) => {
                // 避免点击工具栏导致 selection 丢失
                e.preventDefault();
              }}
            >
              <div className="relative flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('bold') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] font-semibold text-slate-700 hover:bg-slate-50`}
                  title="加粗"
                  onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleBold().run())}
                >
                  B
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('strike') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] text-slate-700 hover:bg-slate-50`}
                  title="删除线"
                  onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleStrike().run())}
                >
                  S̶
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('italic') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] italic text-slate-700 hover:bg-slate-50`}
                  title="斜体"
                  onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleItalic().run())}
                >
                  I
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('underline') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] underline text-slate-700 hover:bg-slate-50`}
                  title="下划线"
                  onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleUnderline().run())}
                >
                  U
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('code') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } font-mono text-[12px] text-slate-700 hover:bg-slate-50`}
                  title="内联代码"
                  onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleCode().run())}
                >
                  {'</>'}
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    editor.isActive('link') ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] text-slate-700 hover:bg-slate-50`}
                  title="链接"
                  onMouseDown={(e) => execToolbar(e, () => applyLink())}
                >
                  🔗
                </button>

                <button
                  type="button"
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                    bubbleColorOpen ? 'border-sky-400 bg-sky-100' : 'border-slate-200 bg-white'
                  } text-[13px] font-semibold text-slate-700 hover:bg-slate-50`}
                  title="文字颜色"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setBubbleColorOpen((v) => !v);
                  }}
                >
                  A
                </button>

                {bubbleColorOpen ? (
                  <div className="absolute left-0 top-full z-[10000] mt-2 w-[320px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                    <div className="text-[11px] font-medium text-slate-700">文字颜色</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TEXT_COLORS.map((item) => {
                        const selected =
                          (!item.value && !selectedTextColor) ||
                          (item.value &&
                            selectedTextColor &&
                            item.value.toLowerCase() === selectedTextColor.toLowerCase());
                        return (
                          <button
                            key={`text-${item.label}`}
                            type="button"
                            className={[
                              'inline-flex h-8 items-center gap-2 rounded-lg border px-2 text-xs',
                              selected ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                            ].join(' ')}
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              applyTextColor(item.value);
                            }}
                            title={item.label}
                          >
                            <span
                              className="h-4 w-4 rounded-full border border-slate-200"
                              style={{ backgroundColor: item.value || '#ffffff' }}
                            />
                            <span className="whitespace-nowrap">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 text-[11px] font-medium text-slate-700">高亮</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {BG_COLORS.map((item) => {
                        const selected =
                          (!item.value && !selectedHighlightColor) ||
                          (item.value &&
                            selectedHighlightColor &&
                            item.value.toLowerCase() === selectedHighlightColor.toLowerCase());
                        return (
                          <button
                            key={`bg-${item.label}`}
                            type="button"
                            className={[
                              'inline-flex h-8 items-center gap-2 rounded-lg border px-2 text-xs',
                              selected ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                            ].join(' ')}
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              applyTextHighlight(item.value);
                            }}
                            title={item.label}
                          >
                            <span
                              className="h-4 w-4 rounded-full border border-slate-200"
                              style={{ backgroundColor: item.value || '#ffffff' }}
                            />
                            <span className="whitespace-nowrap">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          resetColors();
                          setBubbleColorOpen(false);
                        }}
                      >
                        重置
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body
          )
        ) : null}

        {isFocused && !selectionToolbarPos ? (
          <div
            className="absolute z-40"
            style={{
              top: handleTop,
              left: HANDLE_ANCHOR_LEFT,
              transform: 'translateX(-100%)'
            }}
          >
            <div ref={menuRootRef} className="relative">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.commands.focus();
                  setMenuOpen((v) => !v);
                }}
                className="flex items-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1 text-xs text-sky-700 shadow-sm hover:bg-sky-50"
                title="块类型 / 段落设置"
              >
                <span className="font-medium">{activeBlockType.label || '正文'}</span>
                <svg className="h-3 w-3 text-slate-500" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M6 8L10 12L14 8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {menuOpen ? (
                <div className="absolute left-0 z-50 mt-2 w-56 rounded-xl border border-sky-200 bg-white p-1 shadow-xl">
                  <div className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('bold') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] font-semibold text-sky-700 hover:bg-sky-50`}
                        title="加粗"
                        onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleBold().run())}
                      >
                        B
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('strike') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] text-sky-700 hover:bg-sky-50`}
                        title="删除线"
                        onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleStrike().run())}
                      >
                        S̶
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('italic') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] italic text-sky-700 hover:bg-sky-50`}
                        title="斜体"
                        onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleItalic().run())}
                      >
                        I
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('underline') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] underline text-sky-700 hover:bg-sky-50`}
                        title="下划线"
                        onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleUnderline().run())}
                      >
                        U
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('code') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } font-mono text-[12px] text-sky-700 hover:bg-sky-50`}
                        title="内联代码"
                        onMouseDown={(e) => execToolbar(e, () => editor.chain().toggleCode().run())}
                      >
                        {'</>'}
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          editor.isActive('link') ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] text-sky-700 hover:bg-sky-50`}
                        title="链接"
                        onMouseDown={(e) => execToolbar(e, () => applyLink())}
                      >
                        🔗
                      </button>
                      <button
                        type="button"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border ${
                          colorOpen ? 'border-sky-400 bg-sky-100' : 'border-sky-200 bg-white'
                        } text-[13px] text-sky-700 hover:bg-sky-50`}
                        title="颜色"
                        onMouseDown={(e) => execToolbar(e, () => setColorOpen((v) => !v))}
                      >
                        A
                      </button>
                    </div>
                  </div>

                  {colorOpen ? (
                    <div className="mx-2 mb-2 rounded-xl border border-sky-200 bg-white p-3 shadow-sm w-[320px]">
                      <div className="text-xs font-medium text-slate-700">字体颜色</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {TEXT_COLORS.map((item) => {
                          const selected =
                            (!item.value && !selectedTextColor) ||
                            (item.value && selectedTextColor?.toLowerCase() === item.value.toLowerCase());
                          return (
                            <button
                              key={item.label}
                              type="button"
                              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
                                selected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-sky-200'
                              } bg-white text-base font-semibold`}
                              onMouseDown={(e) => {
                                execToolbar(e, () => applyTextColor(item.value));
                              }}
                              title={item.label}
                              style={item.value ? { color: item.value } : { color: '#0f172a' }}
                            >
                              A
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-4 text-xs font-medium text-slate-700">背景颜色</div>
                      <div className="mt-2 grid grid-cols-8 gap-2">
                        {BG_COLORS.map((item) => {
                          const selected =
                            (!item.value && !selectedHighlightColor) ||
                            (item.value && selectedHighlightColor?.toLowerCase() === item.value.toLowerCase());
                          return (
                            <button
                              key={item.label}
                              type="button"
                              className={`h-6 w-6 rounded-md border ${
                                selected ? 'border-sky-500 ring-2 ring-sky-200' : 'border-sky-200'
                              }`}
                              onMouseDown={(e) => {
                                execToolbar(e, () => applyTextHighlight(item.value));
                              }}
                              title={item.label}
                              style={item.value ? { backgroundColor: item.value } : undefined}
                            />
                          );
                        })}
                      </div>

                      <div className="mt-4 text-xs font-medium text-slate-700">高亮块（整段）</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {BLOCK_BGS.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            className="h-6 w-6 rounded-md border border-sky-200"
                            onMouseDown={(e) => {
                              execToolbar(e, () => applyBlockBackground(item.value));
                            }}
                            title={item.label}
                            style={item.value ? { backgroundColor: item.value } : undefined}
                          />
                        ))}
                      </div>

                      <button
                        type="button"
                        className="mt-4 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50"
                        onMouseDown={(e) => {
                          execToolbar(e, () => resetColors());
                        }}
                      >
                        恢复默认
                      </button>
                    </div>
                  ) : null}

                  <div className="my-1 h-px bg-sky-100" />
                  <div className="px-2 py-1 text-[11px] text-slate-400">文本类型</div>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().setParagraph().run());
                    }}
                  >
                    正文
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleHeading({ level: 1 }).run());
                    }}
                  >
                    H1 一级标题
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleHeading({ level: 2 }).run());
                    }}
                  >
                    H2 二级标题
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleHeading({ level: 3 }).run());
                    }}
                  >
                    H3 三级标题
                  </button>

                  <div className="my-1 h-px bg-sky-100" />
                  <div className="px-2 py-1 text-[11px] text-slate-400">列表与块</div>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleBulletList().run());
                    }}
                  >
                    无序列表
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleOrderedList().run());
                    }}
                  >
                    有序列表
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleTaskList().run());
                    }}
                  >
                    待办事项
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleBlockquote().run());
                    }}
                  >
                    引用
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().toggleCodeBlock().run());
                    }}
                  >
                    代码块
                  </button>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left text-[13px] text-sky-800 hover:bg-sky-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runAndClose(() => editor.chain().focus().setHorizontalRule().run());
                    }}
                  >
                    分割线
                  </button>
                  <div className="px-2 py-1 text-[11px] text-slate-400">缩进与对齐</div>
                  <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                    <button
                      type="button"
                      className="rounded-lg border border-sky-200 bg-white px-2 py-1 text-[12px] text-sky-700 hover:bg-sky-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runAndClose(() => editor.chain().focus().setTextAlign('left').run());
                      }}
                      title="居左"
                    >
                      左
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-sky-200 bg-white px-2 py-1 text-[12px] text-sky-700 hover:bg-sky-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runAndClose(() => editor.chain().focus().setTextAlign('center').run());
                      }}
                      title="居中"
                    >
                      中
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-sky-200 bg-white px-2 py-1 text-[12px] text-sky-700 hover:bg-sky-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runAndClose(() => editor.chain().focus().setTextAlign('right').run());
                      }}
                      title="居右"
                    >
                      右
                    </button>
                  </div>
                  <div className="px-2 pb-2 text-[11px] text-slate-400">
                    当前对齐：{activeAlign}
                  </div>

                  {limitHint ? (
                    <div className="mt-1 px-2 pb-2 text-[11px] text-rose-600">{limitHint}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default NoteDocEditor;
