import React, { useEffect, useMemo, useState } from 'react';
import type { FieldTemplateField, FieldTemplateSource } from '../types/fieldTemplate';
import { buildDefaultTemplateFields } from '../constants/fieldTemplates';

interface FieldTemplateModalProps {
  isOpen: boolean;
  sourceType: FieldTemplateSource;
  notebookName?: string | null;
  fields: FieldTemplateField[];
  loading: boolean;
  saving: boolean;
  error?: string | null;
  hasChanges: boolean;
  onClose: () => void;
  onToggleField: (fieldKey: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onReset: () => void;
  onSave: () => Promise<void> | void;
  aiSummaryPrompt?: string;
  onAiSummaryPromptChange?: (nextPrompt: string) => void;
}

const sourceLabels: Record<FieldTemplateSource, string> = {
  link: '解析链接',
  manual: '键入笔记'
};

const PRIMARY_CONTENT_KEYS = new Set([
  'title',
  'content',
  'summary',
  'keywords',
  'img_urls',
  'source_url'
]);

const FieldTemplateModal: React.FC<FieldTemplateModalProps> = ({
  isOpen,
  sourceType,
  notebookName,
  fields,
  loading,
  saving,
  error,
  hasChanges,
  onClose,
  onToggleField,
  onSelectAll,
  onClearAll,
  onReset,
  onSave,
  aiSummaryPrompt,
  onAiSummaryPromptChange
}) => {
  if (!isOpen) return null;

  const sortedFields = [...fields].sort((a, b) => a.order - b.order);
  const allowActions = !loading && !saving;
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(aiSummaryPrompt || '');
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  const recommendedKeys = useMemo(() => {
    const defaults = buildDefaultTemplateFields(sourceType);
    return new Set(defaults.filter((f) => f.enabled !== false).map((f) => f.key));
  }, [sourceType]);

  useEffect(() => {
    if (isEditingPrompt) return;
    setPromptDraft(aiSummaryPrompt || '');
  }, [aiSummaryPrompt, isEditingPrompt]);

  const handlePromptSave = () => {
    if (!onAiSummaryPromptChange) return;
    onAiSummaryPromptChange(promptDraft);
    setIsEditingPrompt(false);
  };

  const handleSaveClick = async () => {
    try {
      await onSave();
    } catch (err) {
      console.error('❌ 保存字段模板失败:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">解析内容设置 · {sourceLabels[sourceType]}</h2>
            <p className="text-xs text-slate-500 mt-1">
              选择要写入笔记的内容项（不影响解析本身，只影响保存到笔记的展示）。下次解析将按此设置执行。
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-medium text-slate-700">上一次保存内容设置</p>
            <p className="text-xs text-slate-500 mt-1">
              {notebookName ? `用了此配置的笔记本：${notebookName}` : '正在加载上一次使用的笔记本...'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>保留内容</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-100"
                disabled={!allowActions}
                onClick={onSelectAll}
              >
                全部保留
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-100"
                disabled={!allowActions}
                onClick={onClearAll}
              >
                全部不保留
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 hover:bg-slate-100"
                disabled={!allowActions}
                onClick={onReset}
              >
                恢复推荐
              </button>
            </div>
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              加载内容设置中...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {sortedFields
                  .filter((field) => PRIMARY_CONTENT_KEYS.has(field.key))
                  .map((field) => {
                    const isSummaryField = field.key === 'summary' && aiSummaryPrompt !== undefined;
                    const isRecommended = recommendedKeys.has(field.key);
                    return (
                      <div
                        key={field.key}
                        className={`rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors ${
                          field.enabled !== false
                            ? 'border-[#b5ece0] bg-[#eef6fd] text-[#062b23]'
                            : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={field.enabled !== false}
                            disabled={!allowActions}
                            onChange={() => onToggleField(field.key)}
                            className="h-4 w-4 rounded border-slate-300 text-[#0a917a] focus:ring-[#43ccb0]"
                          />
                          <span className="flex items-center gap-2">
                            <span>{field.label}</span>
                            {isRecommended && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                推荐
                              </span>
                            )}
                          </span>
                        </label>
                        {isSummaryField && onAiSummaryPromptChange && (
                          <div className="ml-7 mt-2 space-y-2 text-xs text-slate-600">
                            {isEditingPrompt ? (
                              <>
                                <textarea
                                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:border-[#43ccb0] focus:ring-1 focus:ring-[#b5ece0]"
                                  rows={3}
                                  value={promptDraft}
                                  onChange={(e) => setPromptDraft(e.target.value)}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="rounded-lg bg-[#06c3a8] px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-[#04b094]"
                                    onClick={handlePromptSave}
                                  >
                                    保存
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                                    onClick={() => {
                                      setPromptDraft(aiSummaryPrompt || '');
                                      setIsEditingPrompt(false);
                                    }}
                                  >
                                    取消
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600 leading-relaxed whitespace-pre-line">
                                  {aiSummaryPrompt}
                                </div>
                                <button
                                  type="button"
                                  className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                                  onClick={() => {
                                    setPromptDraft(aiSummaryPrompt || '');
                                    setIsEditingPrompt(true);
                                  }}
                                >
                                  编辑 AI 总结提示词
                                </button>
                              </>
                            )}
                            <p className="text-[11px] text-slate-400">
                              用于生成 AI 总结，例如「请将内容整理为不超过 5 条要点」。
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {sortedFields.some((field) => !PRIMARY_CONTENT_KEYS.has(field.key)) && (
                <div className="rounded-xl border border-slate-200 bg-white">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setAdvancedExpanded((prev) => !prev)}
                  >
                    <span>
                      更多信息项
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        {sortedFields.filter((field) => !PRIMARY_CONTENT_KEYS.has(field.key)).length} 项
                      </span>
                    </span>
                    <span className="text-slate-400">{advancedExpanded ? '收起' : '展开'}</span>
                  </button>
                  {advancedExpanded && (
                    <div className="grid grid-cols-2 gap-3 px-4 pb-4">
                      {sortedFields
                        .filter((field) => !PRIMARY_CONTENT_KEYS.has(field.key))
                        .map((field) => {
                          const isRecommended = recommendedKeys.has(field.key);
                          return (
                            <div
                              key={field.key}
                              className={`rounded-xl border px-3 py-2 text-sm shadow-sm transition-colors ${
                                field.enabled !== false
                                  ? 'border-[#b5ece0] bg-[#eef6fd] text-[#062b23]'
                                  : 'border-slate-200 bg-white text-slate-600'
                              }`}
                            >
                              <label className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={field.enabled !== false}
                                  disabled={!allowActions}
                                  onChange={() => onToggleField(field.key)}
                                  className="h-4 w-4 rounded border-slate-300 text-[#0a917a] focus:ring-[#43ccb0]"
                                />
                                <span className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {isRecommended && (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                      推荐
                                    </span>
                                  )}
                                </span>
                              </label>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
          <div className="text-xs text-slate-500">
            {hasChanges ? '有未保存的更改' : '设置已保存'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#06c3a8] px-4 py-2 text-sm font-medium text-white shadow-lg shadow-[#8de2d5] disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={handleSaveClick}
              disabled={!hasChanges || saving || loading}
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FieldTemplateModal;
