import React from 'react';
import { useNavigate } from 'react-router-dom';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-purple-50">
      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            个人数据分析平台
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 mb-8 max-w-3xl mx-auto">
            智能笔记管理、AI 分析、数据可视化，让您的个人数据更有价值
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-16">
            <button
              onClick={() => navigate('/CreateNote')}
              className="px-8 py-4 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors text-lg font-semibold flex items-center gap-2"
            >
              <span>🚀</span>
              开始使用
            </button>
            <button
              onClick={() => navigate('/ai-import')}
              className="px-8 py-4 bg-white text-[#1a1a1a] border-2 border-[#1a1a1a] rounded-lg hover:bg-purple-50 transition-colors text-lg font-semibold flex items-center gap-2"
            >
              <span>🤖</span>
              AI 导入笔记
            </button>
          </div>
        </div>

        {/* Features Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-20">
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">📝</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">智能笔记管理</h3>
            <p className="text-gray-600">
              创建和管理多个笔记本，支持分类、标签、搜索等功能，让您的笔记井然有序
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">🤖</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">AI 智能分析</h3>
            <p className="text-gray-600">
              使用 AI 技术自动解析文章内容，智能推荐分类，快速生成笔记摘要
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-3">数据可视化</h3>
            <p className="text-gray-600">
              通过图表和统计信息，直观了解您的笔记趋势、分类分布等数据洞察
            </p>
          </div>
        </div>

        {/* CTA Section */}
        <div className="mt-20 text-center">
          <div className="bg-gradient-to-r from-purple-100/70 via-white to-purple-100/70 rounded-2xl p-8 shadow-[0_20px_50px_-30px_rgba(124,58,237,0.45)]">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">准备好开始了吗？</h2>
            <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
              立即创建您的第一个笔记本，开始记录和管理您的个人数据
            </p>
            <button
              onClick={() => navigate('/CreateNote')}
              className="px-8 py-4 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors text-lg font-semibold"
            >
              立即开始
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;

