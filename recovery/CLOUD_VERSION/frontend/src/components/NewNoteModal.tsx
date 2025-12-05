import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import apiClient from '../apiClient';
import {
  smartSync,
  triggerConfigUpdate,
  type ComponentInstance,
  type ComponentConfig
} from '../utils/componentSync';
import {
  recordComponentTypes,
  analysisComponentTypes,
  chartTypes
} from '../utils/componentTypes';

// 与 AINoteImportPage 中保持一致的 AI 摘要默认提示词及存储键
const TEXT_PROMPT_STORAGE_KEY = 'ai_parse_text_prompt_v1';
const DEFAULT_AI_SUMMARY_PROMPT =
  '请将内容整理为不超过5条的要点，突出文章核心信息，使用简洁的中文有序列表输出。';

interface NewNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  onCreated?: (noteId: string) => void;
  mode?: 'create' | 'edit';
}

const formatNow = () => {
  const now = new Date();
  const pad = (num: number) => num.toString().padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const createInstance = (type: string): ComponentInstance => ({
  id: `component_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  type,
  title:
    type === 'date'
      ? '笔记创建时间'
      : recordComponentTypes.concat(analysisComponentTypes).find((item) => item.id === type)?.label ||
        '未命名组件',
  content: type === 'date' ? formatNow() : '',
  config: type === 'chart' ? { chartType: 'bar' } : type === 'ai-custom' ? { prompt: '' } : {}
});

const DEFAULT_NOTE_COMPONENT_TYPES = ['text-short', 'text-long', 'date'];
const buildDefaultNoteComponents = () => DEFAULT_NOTE_COMPONENT_TYPES.map(createInstance);

const SortableCard: React.FC<{
  instance: ComponentInstance;
  isEditing: boolean;
  draftTitle: string;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDraftTitleChange: (value: string) => void;
  onDelete: () => void;
  children: React.ReactNode;
}> = ({
  instance,
  isEditing,
  draftTitle,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDraftTitleChange,
  onDelete,
  children
}) => {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: instance.id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white border border-purple-200 rounded-2xl p-4 shadow-sm ${
        isDragging ? 'ring-2 ring-purple-400' : 'hover:border-purple-300'
      } transition-colors`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            className="inline-flex items-center justify-center rounded-full border border-purple-200 bg-purple-50 px-2 py-1 text-[12px] text-purple-500 hover:border-purple-400 hover:text-purple-700 flex-shrink-0"
            {...attributes}
            {...listeners}
            type="button"
          >
            <span className="text-[12px]">☰</span>
          </button>
          {isEditing ? (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => onDraftTitleChange(e.target.value)}
                className="flex-1 px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-[12px]"
                placeholder="字段标题"
              />
          ) : (
            <div className="flex-1 text-[12px] font-medium text-slate-800 truncate">
              {instance.title}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isEditing ? (
            <>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-purple-600 px-3 py-1 text-[12px] font-medium text-white"
                onClick={onSaveEdit}
              >
                保存
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-[12px] font-medium text-purple-700"
                onClick={onCancelEdit}
              >
                取消
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-[12px] font-medium text-purple-700"
                onClick={onDelete}
              >
                删除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-[12px] font-medium text-purple-700"
                onClick={onStartEdit}
              >
                编辑
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-purple-100 px-3 py-1 text-[12px] font-medium text-purple-700"
                onClick={onDelete}
              >
                删除
              </button>
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
};

const NewNoteModal: React.FC<NewNoteModalProps> = ({
  isOpen,
  onClose,
  notebookId,
  onCreated,
  mode = 'create'
}) => {
  const [componentInstances, setComponentInstances] = useState<ComponentInstance[]>(buildDefaultNoteComponents());
  const [submitting, setSubmitting] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  // AI 摘要提示词（与 AI 导入页同步）
  const [aiPromptValue, setAiPromptValue] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_AI_SUMMARY_PROMPT;
    try {
      const stored = window.localStorage.getItem(TEXT_PROMPT_STORAGE_KEY);
      return stored && stored.trim() ? stored : DEFAULT_AI_SUMMARY_PROMPT;
    } catch {
      return DEFAULT_AI_SUMMARY_PROMPT;
    }
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }
    })
  );

  useEffect(() => {
    if (!isOpen || !notebookId) return;

    let mounted = true;
    setComponentInstances(buildDefaultNoteComponents());

    const loadTemplate = async () => {
      try {
        const { data } = await apiClient.get(`/api/notebooks/${notebookId}`);
        const template =
          data?.notebook?.component_config?.componentInstances ??
          data?.component_config?.componentInstances ??
          [];

        if (!mounted) return;

        if (Array.isArray(template) && template.length > 0) {
          const clearedInstances = template.map((instance: ComponentInstance) => ({
            ...instance,
            title: instance.type === 'date' ? '笔记创建时间' : instance.title,
            content:
              instance.type === 'date'
                ? formatNow()
                : instance.content || ''
          }));
          setComponentInstances(clearedInstances);
        } else {
          setComponentInstances(buildDefaultNoteComponents());
        }
      } catch (error) {
        console.error('加载笔记本模板失败，将使用默认字段。', error);
        if (mounted) {
          setComponentInstances(buildDefaultNoteComponents());
        }
      }
    };

    loadTemplate();

    return () => {
      mounted = false;
    };
  }, [isOpen, notebookId]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const resetModalState = () => {
    setComponentInstances(buildDefaultNoteComponents());
    setSelection([]);
    setShowAddPanel(false);
    setEditingId(null);
    setDraftTitle('');
    setDraftContent('');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setComponentInstances((items) => {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const addComponents = () => {
    if (selection.length === 0) return;
    const newInstances = selection.map((type) => createInstance(type));
    setComponentInstances((prev) => [...prev, ...newInstances]);
    setSelection([]);
    setShowAddPanel(false);
  };

  const removeComponent = (id: string) => {
    setComponentInstances((prev) => prev.filter((instance) => instance.id !== id));
  };

  const updateInstance = (id: string, updates: Partial<ComponentInstance>) => {
    setComponentInstances((prev) =>
      prev.map((instance) => (instance.id === id ? { ...instance, ...updates } : instance))
    );
  };

  const handleSaveTemplate = async () => {
    setSubmitting(true);
    try {
      const payload: ComponentConfig = {
        componentInstances: componentInstances.map(({ content, ...rest }) => rest)
      };
      const { data } = await apiClient.put(`/api/notebooks/${notebookId}`, {
        componentConfig: payload
      });

      if (!data?.success) {
        throw new Error(data?.message || '保存模板失败');
      }

      triggerConfigUpdate(notebookId, payload);
      alert('模板已保存，下次新建笔记会使用此结构。');
    } catch (error) {
      console.error('保存模板失败:', error);
      alert((error as Error).message || '保存模板失败');
    }
    setSubmitting(false);
  };

  const buildComponentData = () => {
    const data: Record<
      string,
      {
        value: string;
        type: string;
        title: string;
      }
    > = {};

    componentInstances.forEach((instance) => {
      if (instance.content && instance.content.trim()) {
        data[instance.id] = {
          value: instance.content.trim(),
          type: instance.type,
          title: instance.title || ''
        };
      }
    });

    return data;
  };

  const deriveNoteTitle = () => {
    const short = componentInstances.find((inst) => inst.type === 'text-short');
    if (short?.content?.trim()) return short.content.trim();
    const first = componentInstances[0];
    return first?.content?.trim() || '未命名笔记';
  };

  const deriveNoteSummary = () => {
    const long = componentInstances.find((inst) => inst.type === 'text-long');
    return long?.content?.trim() || '';
  };

  // 当 AI 提示词变更时，写入 localStorage，供 AI 导入页等地方复用
  useEffect(() => {
    try {
      const trimmed = aiPromptValue.trim();
      if (trimmed) {
        window.localStorage.setItem(TEXT_PROMPT_STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(TEXT_PROMPT_STORAGE_KEY);
      }
    } catch {
      // 忽略本地存储错误
    }
  }, [aiPromptValue]);

  const handleCreateNote = async () => {
    if (componentInstances.length === 0) {
      alert('请先添加至少一个组件');
      return;
    }

    setSubmitting(true);
    try {
      const componentData = buildComponentData();
      const template = componentInstances.map(({ content, ...rest }) => rest);
      const nowFormatted = formatNow();

      const response = await apiClient.post('/api/notes', {
        notebook_id: notebookId,
        title: deriveNoteTitle(),
        content_text: deriveNoteSummary(),
        component_data: componentData,
        component_instances: template,
        upload_time: nowFormatted,
        parseFields: ['summary', 'keywords'],
        skipAI: false
      });

      if (!response.data?.success) {
        throw new Error(response.data?.message || '创建笔记失败');
      }

      const noteId = response.data?.note?.note_id || response.data?.noteId;
      await smartSync(notebookId, componentInstances, 'note');

      if (onCreated && noteId) {
        onCreated(noteId);
      }

      window.dispatchEvent(
        new CustomEvent('note:created', { detail: { noteId, notebookId, template: componentData } })
      );

      resetModalState();
      onClose();
    } catch (error) {
      console.error('创建笔记失败:', error);
      alert((error as Error).message || '创建笔记失败');
    }
    setSubmitting(false);
  };

  const renderEditableField = (instance: ComponentInstance) => {
    switch (instance.type) {
      case 'text-short':
        return (
          <input
            type="text"
            value={draftContent}
            placeholder="输入短文本内容"
            onChange={(e) => setDraftContent(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
          />
        );
      case 'text-long':
        return (
          <textarea
            value={draftContent}
            placeholder="输入长文本内容"
            rows={4}
            onChange={(e) => setDraftContent(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none"
          />
        );
      case 'date':
        return (
          <input
            type="datetime-local"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
          />
        );
      case 'number':
        return (
          <input
            type="number"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
          />
        );
      case 'image':
        return (
          <div className="space-y-2">
            <input
              type="file"
              accept="image/*"
              multiple
              className="block w-full text-xs text-slate-600
                         file:mr-3 file:rounded-full file:border-0
                         file:bg-purple-50 file:px-3 file:py-1.5
                         file:text-xs file:font-medium file:text-purple-700
                         hover:file:bg-purple-100"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                const names = files.map((f) => f.name).join('\n');
                setDraftContent(names || draftContent);
              }}
            />
            <textarea
              value={draftContent}
              placeholder="每行一个图片链接或文件名"
              rows={3}
              onChange={(e) => setDraftContent(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none text-xs"
            />
          </div>
        );
      case 'ai-custom':
        return (
          <div className="space-y-2">
            <textarea
              value={aiPromptValue}
              onChange={(e) => {
                const next = e.target.value;
                setAiPromptValue(next);
                setDraftContent(next);
              }}
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-xs leading-relaxed resize-y"
              placeholder={DEFAULT_AI_SUMMARY_PROMPT}
            />
            <p className="text-xs text-slate-400">
              此处的提示词会与「AI 导入笔记」中的 AI 摘要提示词保持一致，例如：
              {DEFAULT_AI_SUMMARY_PROMPT}
            </p>
          </div>
        );
      case 'chart':
        return (
          <div className="text-xs text-slate-500">
            图表组件已在分析页面中使用，新建笔记暂不支持配置。
          </div>
        );
      default:
        return (
          <input
            type="text"
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
          />
        );
    }
  };

  const renderDisplayContent = (instance: ComponentInstance) => {
    const value = (instance.content || '').trim();
    if (!value) {
      return <div className="text-xs text-slate-400">暂无内容</div>;
    }
    if (instance.type === 'image') {
      const lines = value.split(/\n+/).filter(Boolean);
      return (
        <ul className="list-disc pl-4 text-xs text-slate-600 space-y-0.5">
          {lines.map((line, idx) => (
            <li key={idx} className="break-all">
              {line}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
        {value}
      </div>
    );
  };

  const recordComponents = useMemo(
    () => recordComponentTypes.filter((c) => c.id !== 'chart'),
    []
  );
  const analysisComponents = useMemo(
    () => analysisComponentTypes.filter((c) => c.id !== 'chart'),
    []
  );

  if (!isOpen) return null;

  const modalNode = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[94vh] overflow-y-auto">
        <div className="border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900 text-[14px]">
              {mode === 'edit' ? '编辑组件配置' : '新建笔记'}
            </h2>
            <p className="text-slate-500 mt-1 text-[14px]">
              拖动调整字段顺序，支持结构化记录、AI 提示和图表配置
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 text-[12px]">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAddPanel((prev) => !prev)}
              className="px-4 py-2 border border-purple-400 rounded-lg text-purple-700 hover:border-purple-500 hover:bg-purple-50 transition-colors flex items-center gap-2 text-[12px]"
            >
              <span className="text-[12px]">➕</span>
              <span>添加组件</span>
            </button>
            <button
              type="button"
              onClick={handleSaveTemplate}
              disabled={componentInstances.length === 0 || submitting}
              className="px-4 py-2 border border-purple-300 rounded-lg text-slate-700 hover:border-purple-500 hover:text-purple-700 disabled:opacity-40"
            >
              保存为模板
            </button>
          </div>

          {showAddPanel && (
            <div className="border border-slate-200 rounded-2xl p-4 bg-slate-50 space-y-4">
              <div>
                <div className="text-xs font-semibold text-slate-500 mb-2">记录组件</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {recordComponents.map((component) => (
                    <label
                      key={component.id}
                      className={`border rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer text-sm ${
                        selection.includes(component.id)
                          ? 'border-purple-500 bg-white text-purple-600'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selection.includes(component.id)}
                        onChange={() =>
                          setSelection((prev) =>
                            prev.includes(component.id)
                              ? prev.filter((item) => item !== component.id)
                              : [...prev, component.id]
                          )
                        }
                      />
                      <span>{component.icon}</span>
                      <span>{component.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-500 mb-2">分析组件</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {analysisComponents.map((component) => (
                    <label
                      key={component.id}
                      className={`border rounded-xl px-3 py-2 flex items-center gap-2 cursor-pointer text-sm ${
                        selection.includes(component.id)
                          ? 'border-purple-500 bg-white text-purple-600'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selection.includes(component.id)}
                        onChange={() =>
                          setSelection((prev) =>
                            prev.includes(component.id)
                              ? prev.filter((item) => item !== component.id)
                              : [...prev, component.id]
                          )
                        }
                      />
                      <span>{component.icon}</span>
                      <span>{component.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 text-slate-600 hover:text-slate-800"
                  onClick={() => {
                    setSelection([]);
                    setShowAddPanel(false);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg disabled:opacity-40"
                  disabled={selection.length === 0}
                  onClick={addComponents}
                >
                  添加 {selection.length} 个组件
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {componentInstances.length === 0 && (
              <div className="border border-dashed border-purple-300 rounded-2xl p-10 text-center text-slate-500">
                暂无组件，点击「添加组件」开始构建笔记结构
              </div>
            )}

            {componentInstances.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={componentInstances.map((instance) => instance.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {componentInstances.map((instance) => {
                      const isEditing = editingId === instance.id;
                      return (
                        <SortableCard
                          key={instance.id}
                          instance={instance}
                          isEditing={isEditing}
                          draftTitle={draftTitle}
                          onDraftTitleChange={setDraftTitle}
                          onStartEdit={() => {
                            setEditingId(instance.id);
                            setDraftTitle(instance.title || '');
                            setDraftContent(instance.content || '');
                          }}
                          onSaveEdit={() => {
                            updateInstance(instance.id, {
                              title: draftTitle || instance.title,
                              content: draftContent
                            });
                            setEditingId(null);
                            setDraftTitle('');
                            setDraftContent('');
                          }}
                          onCancelEdit={() => {
                            setEditingId(null);
                            setDraftTitle('');
                            setDraftContent('');
                          }}
                          onDelete={() => {
                            removeComponent(instance.id);
                          }}
                        >
                          <div className="space-y-3">
                            <div>
                              {isEditing ? renderEditableField(instance) : renderDisplayContent(instance)}
                            </div>
                          </div>
                        </SortableCard>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        <div className="border-t px-6 py-4 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              resetModalState();
              onClose();
            }}
            className="px-4 py-2 rounded-lg border border-purple-300 text-slate-700 hover:bg-purple-50 hover:border-purple-500 transition-colors text-[12px]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSaveTemplate}
            disabled={componentInstances.length === 0 || submitting}
            className="px-4 py-2 rounded-lg border border-purple-400 text-purple-700 hover:border-purple-500 hover:bg-purple-50 disabled:opacity-40 text-[12px]"
          >
            保存模板
          </button>
          <button
            type="button"
            onClick={handleCreateNote}
            disabled={componentInstances.length === 0 || submitting}
            className="px-5 py-2 rounded-lg bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30 disabled:bg-slate-300 disabled:cursor-not-allowed text-[12px]"
          >
            {submitting ? '提交中...' : '创建笔记'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalNode;
  }

  return createPortal(modalNode, document.body);
};

export default NewNoteModal;
