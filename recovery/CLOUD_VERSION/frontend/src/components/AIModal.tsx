import React, { useState } from 'react';
import apiClient from '../apiClient';

interface AIModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: string;
  notes?: any[];
}

const AIModal: React.FC<AIModalProps> = ({ isOpen, onClose, context, notes = [] }) => {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleAnalyze = async () => {
    setLoading(true);
    setResponse('');
    try {
      const result = await apiClient.post('/api/ai-analysis', {
        context,
        notes
      });
      if (result.data.success) {
        setResponse(result.data.analysis || result.data.response || '分析完成');
      } else {
        setResponse('分析失败：' + (result.data.message || '未知错误'));
      }
    } catch (error: any) {
      console.error('AI分析失败:', error);
      setResponse('分析失败：' + (error?.message || '网络错误'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] mx-4 flex flex-col"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">AI总结和建议</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto mb-4">
          {response ? (
            <div className="bg-gray-50 rounded-lg p-4 whitespace-pre-wrap text-sm">
              {response}
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              点击"开始分析"按钮获取AI总结和建议
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
          >
            关闭
          </button>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-4 py-2 bg-[#1a1a1a] text-white rounded-md hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? '分析中...' : '开始分析'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIModal;

