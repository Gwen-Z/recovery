import React from 'react';
import { InsightCard } from '../../types/Analysis';

interface AIAnalysisComponentProps {
  analysisData?: {
    insights?: InsightCard[];
    metadata?: any;
  };
  onAIClick?: () => void;
  fromAnalysis?: boolean;
  analysisResult?: any;
}

/**
 * AI分析结果组件
 * 专门用于显示分析结果中的AI洞察和建议
 */
function AIAnalysisComponent({ 
  analysisData, 
  onAIClick, 
  fromAnalysis = false, 
  analysisResult 
}: AIAnalysisComponentProps) {
  
  // 如果没有AI洞察数据，显示提示信息
  if (!analysisData?.insights || analysisData.insights.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-sm text-gray-500">暂无AI分析结果</div>
        {onAIClick && (
          <button
            onClick={onAIClick}
            className="mt-4 inline-flex items-center px-4 py-2 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
          >
            <span className="mr-2">🤖</span>
            开始AI分析
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* AI洞察块 */}
      <div className="grid gap-3">
        {analysisData.insights.map((insight, index) => (
          <div
            key={insight.id || index}
            className="p-5"
          >
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  insight.type === 'positive' ? 'bg-green-100 text-green-800' :
                  insight.type === 'negative' ? 'bg-red-100 text-red-800' :
                  insight.type === 'neutral' ? 'bg-blue-100 text-blue-800' :
                  'bg-slate-100 text-slate-800'
                }`}>
                  {getInsightIcon(insight.type)}
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-gray-900 mb-1" style={{ fontSize: '14px' }}>
                  {mapTitleToDisplay(insight.title)}
                </h4>
                
                {(() => {
                  const displayTitle = mapTitleToDisplay(insight.title);
                  const isExtensionDirection = displayTitle === '延伸方向';
                  const isNotesPoints = displayTitle === '笔记要点';
                  
                  // 如果是"延伸方向"，不显示 description，直接显示列表
                  if (isExtensionDirection && insight.suggestions && insight.suggestions.length > 0) {
                    return (
                      <ul className="space-y-1 mt-2">
                        {insight.suggestions.map((suggestion, suggestionIndex) => {
                          // 清理文本开头的圆点、空格等符号，避免重复显示
                          const cleanSuggestion = (typeof suggestion === 'string' ? suggestion : String(suggestion))
                            .replace(/^[•·\-\s]+/, '') // 移除开头的圆点、中圆点、横线、空格
                            .replace(/^\d+[.。、]\s*/, '') // 移除开头的数字编号
                            .trim();
                          
                          return (
                            <li key={suggestionIndex} className="text-gray-700 flex items-start" style={{ fontSize: '12px' }}>
                              <span className="mr-2">•</span>
                              <span>{cleanSuggestion}</span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  }
                  
                  // 如果是"笔记要点"，将 description 解析成列表格式
                  if (isNotesPoints && insight.description) {
                    // 将 description 按换行符或特定标记分割成列表项
                    const parseDescriptionToList = (text: string): string[] => {
                      if (!text) return [];
                      
                      // 清理文本，移除多余的空白
                      const cleanText = text.trim();
                      
                      // 优先尝试按换行符分割
                      let items = cleanText.split(/\n+/)
                        .map(line => line.trim())
                        .filter(line => line.length > 0);
                      
                      // 如果按换行符分割后只有一个项或没有分割，尝试按其他分隔符分割
                      if (items.length <= 1) {
                        const singleLine = items[0] || cleanText;
                        
                        // 尝试按 • 分割（支持中文和英文的 bullet point）
                        if (singleLine.includes('•') || singleLine.includes('·')) {
                          items = singleLine.split(/[•·]/)
                            .map(item => item.trim())
                            .filter(item => item.length > 0 && !item.match(/^\d+[.。]/)); // 排除数字编号
                        }
                        // 尝试按 - 分割（但不是作为负数的一部分）
                        else if (singleLine.includes('-') && !singleLine.match(/^[-\d\s]+$/)) {
                          items = singleLine.split(/\s*-\s+/)
                            .map(item => item.trim())
                            .filter(item => item.length > 0);
                        }
                        // 尝试按数字编号分割（如 1. 2. 3. 或 1、2、3、）
                        else if (singleLine.match(/\d+[.。、]/)) {
                          items = singleLine.split(/\d+[.。、]\s*/)
                            .map(item => item.trim())
                            .filter(item => item.length > 0 && !item.match(/^[•·\-\s]+$/)); // 排除只有符号的行
                        }
                        // 尝试按中文顿号、分号分割
                        else if (singleLine.includes('、') || singleLine.includes('；')) {
                          items = singleLine.split(/[、；]/)
                            .map(item => item.trim())
                            .filter(item => item.length > 0);
                        }
                      }
                      
                      // 清理列表项，移除已有的 •、-、数字编号等标记
                      items = items.map(item => {
                        // 移除开头的各种标记符号和编号
                        return item
                          .replace(/^[•·\-\s]+/, '') // 移除开头的 bullet points
                          .replace(/^\d+[.。、]\s*/, '') // 移除开头的数字编号
                          .trim();
                      }).filter(item => item.length > 0);
                      
                      // 如果解析后仍然只有一个项，且长度很长，可能是单段文本，不强制分割
                      // 否则返回解析后的列表
                      return items.length > 0 ? items : [cleanText];
                    };
                    
                    const listItems = parseDescriptionToList(insight.description);
                    
                    // 始终显示为列表格式
                    return (
                      <ul className="space-y-1 mt-2">
                        {listItems.map((item, itemIndex) => (
                          <li key={itemIndex} className="text-gray-700 flex items-start" style={{ fontSize: '12px' }}>
                            <span className="mr-2">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  
                  // 其他情况正常显示 description
                  return (
                    <>
                      <p className="text-gray-700 mb-3" style={{ fontSize: '12px' }}>
                        {insight.description}
                      </p>
                      
                      {/* 洞察详情 */}
                      {insight.details && (
                        <div className="rounded-lg bg-white/60 border border-slate-100 p-3 mb-3">
                          <div className="font-medium text-gray-700 mb-1" style={{ fontSize: '12px' }}>详细分析：</div>
                          <div className="text-gray-600 whitespace-pre-wrap" style={{ fontSize: '12px' }}>
                            {insight.details}
                          </div>
                        </div>
                      )}

                      {/* 建议行动 - 非延伸方向的情况 */}
                      {insight.suggestions && insight.suggestions.length > 0 && (
                        <div className="rounded-lg bg-indigo-50/70 border border-indigo-100 p-3">
                          <div className="font-medium text-indigo-900 mb-2" style={{ fontSize: '12px' }}>💡 延伸方向：</div>
                          <ul className="space-y-1">
                            {insight.suggestions.map((suggestion, suggestionIndex) => (
                              <li key={suggestionIndex} className="text-indigo-800 flex items-start" style={{ fontSize: '12px' }}>
                                <span className="mr-2">•</span>
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* 相关数据 */}
                {insight.relatedData && (
                  <div className="mt-3 p-2 bg-yellow-50/70 rounded border-l-4 border-yellow-300">
                    <div className="font-medium text-yellow-800 mb-1" style={{ fontSize: '12px' }}>相关数据：</div>
                    <div className="text-yellow-700" style={{ fontSize: '12px' }}>
                      {typeof insight.relatedData === 'string' 
                        ? insight.relatedData 
                        : JSON.stringify(insight.relatedData, null, 2)
                      }
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI助手按钮 */}
      {onAIClick && (
        <div className="text-center pt-4">
          <button
            onClick={onAIClick}
            className="inline-flex items-center px-6 py-3 bg-[#1a1a1a] text-white rounded-lg hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-all duration-200"
          >
            <span className="mr-2">🤖</span>
            与AI助手深入交流
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 获取洞察类型的图标
 */
function getInsightIcon(type: string): string {
  const icons: Record<string, string> = {
    'positive': '✅',
    'negative': '⚠️',
    'neutral': 'ℹ️',
    'suggestion': '💡',
    'trend': '📈',
    'pattern': '🔍'
  };
  return icons[type] || '💭';
}

/**
 * 映射标题：将AI返回的标题映射为用户期望的标题
 */
function mapTitleToDisplay(title: string): string {
  const titleMap: Record<string, string> = {
    '关键发现': '一句话总结',
    '趋势分析': '笔记要点',
    '建议与行动': '延伸方向',
    '建议': '延伸方向'
  };
  
  // 如果标题在映射表中，返回映射后的标题
  if (titleMap[title]) {
    return titleMap[title];
  }
  
  // 否则返回原标题
  return title;
}

export default AIAnalysisComponent;

