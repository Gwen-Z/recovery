import React, { useCallback, useState } from 'react';
import apiClient from '../apiClient';

type CustomNotebookModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

const CustomNotebookModal: React.FC<CustomNotebookModalProps> = ({ open, onClose, onCreated }) => {
  const [customNotebookName, setCustomNotebookName] = useState('');
  const [customNotebookDescription, setCustomNotebookDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setCustomNotebookName('');
    setCustomNotebookDescription('');
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetForm();
    onClose();
  }, [onClose, resetForm, submitting]);

  const handleCreateCustomNotebook = async () => {
    const trimmedName = customNotebookName.trim();
    if (!trimmedName) {
      alert('请输入笔记本名称');
      return;
    }

    try {
      setSubmitting(true);
      const { data } = await apiClient.post('/api/notebooks', {
        name: trimmedName,
        description: customNotebookDescription.trim() || undefined
      });

      if (!data?.success) {
        throw new Error(data?.message || '创建笔记本失败');
      }

      const createdId = data?.notebook?.notebook_id || data?.data?.notebook_id || null;
      if (createdId) {
        window.dispatchEvent(new CustomEvent('notebook:created', { detail: { id: createdId } }));
      } else {
        window.dispatchEvent(new Event('notebook:created'));
      }

      resetForm();
      onClose();
      onCreated?.();
    } catch (error) {
      console.error('创建笔记本失败:', error);
      alert((error as Error).message || '创建笔记本失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-900">新建笔记本</h3>
            <p className="text-sm text-slate-500 mt-1">不再配置字段组件，创建后直接开始记录</p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          <div className="flex flex-col gap-4">
            <label className="text-sm font-medium text-slate-700">
              笔记本名称
              <input
                type="text"
                value={customNotebookName}
                onChange={(e) => setCustomNotebookName(e.target.value)}
                className="mt-2 w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#43ccb0] outline-none"
                placeholder="例如：财经分析、学习备忘..."
                disabled={submitting}
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              描述（可选）
              <textarea
                value={customNotebookDescription}
                onChange={(e) => setCustomNotebookDescription(e.target.value)}
                rows={3}
                className="mt-2 w-full px-4 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#43ccb0] outline-none resize-none"
                placeholder="为笔记本提供一句描述，方便 AI 推荐。"
                disabled={submitting}
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreateCustomNotebook}
              disabled={!customNotebookName.trim() || submitting}
              className="px-5 py-2 rounded-lg bg-[#06c3a8] text-white shadow-lg shadow-[#8de2d5] disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {submitting ? '创建中...' : '创建笔记本'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomNotebookModal;
