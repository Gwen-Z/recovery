import React from 'react';
import { AnalysisResult } from '../types/Analysis';
import ChartAnalysisComponent from './analysis/ChartAnalysisComponent';
import AIAnalysisComponent from './analysis/AIAnalysisComponent';

interface DynamicAnalysisResultProps {
  analysisResult: AnalysisResult;
  onAIClick?: () => void;
  filterDateRange?: { from?: string; to?: string };
}

/**
 * 动态分析结果组件
 * 根据用户选择的组件类型渲染对应的分析页面，并传递分析结果数据
 */
function DynamicAnalysisResult({ analysisResult, onAIClick, filterDateRange }: DynamicAnalysisResultProps) {
  // 从analysisData中获取组件配置，如果没有则从根级别获取（向后兼容）
  const selectedComponents = analysisResult.analysisData?.selectedAnalysisComponents || analysisResult.selectedAnalysisComponents;
  const componentConfigs = analysisResult.analysisData?.componentConfigs || analysisResult.componentConfigs;
  
  // 一致化结构：图表类优先，AI 组件最后
  const orderedComponents = Array.isArray(selectedComponents)
    ? [...selectedComponents].sort((a, b) => (a === 'ai-custom' ? 1 : 0) - (b === 'ai-custom' ? 1 : 0))
    : [];
  
  // 如果没有选择任何组件，显示提示信息
  if (!selectedComponents || selectedComponents.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600 mb-2">未选择分析组件</div>
        <div className="text-sm text-gray-500">请先选择要使用的分析组件类型</div>
      </div>
    );
  }

  // 渲染所有选择的组件
  return (
    <div className="space-y-6">
      {orderedComponents.map((componentType: string) => {
        // 准备传递给分析组件的数据
        const componentProps = {
          onAIClick,
          // 传递分析结果数据
          analysisData: {
            // 优先使用组件级的处理后数据（包含 notes 列表），否则回退到顶层或原始 data
            processedData: componentConfigs?.chart?.processedData 
              || analysisResult.analysisData?.processedData 
              || analysisResult.data,
            fieldMappings: componentConfigs?.chart?.fieldMappings || [],
            chartConfigs: componentConfigs?.chart?.chartConfigs || [],
            insights: componentConfigs?.['ai-custom']?.insights || [],
            metadata: analysisResult.metadata
          },
          // 传递原始分析结果（用于调试和扩展）
          analysisResult,
          // 标记这是来自分析结果的数据
          fromAnalysis: true,
          // 统一过滤范围
          filterDateRange
        };

        if (componentType === 'chart') {
          // 图表分析：不再展示标题/卡片，直接展示内容，避免重复的"图表分析"标题
          return (
            <div key={componentType} className="space-y-4">
              <ChartAnalysisComponent {...componentProps} />
            </div>
          );
        }

        if (componentType === 'ai-custom') {
          // AI 提示词：使用与图表一致的白色背景
          return (
            <div
              key={componentType}
              className="rounded-2xl bg-white border border-gray-200 p-5"
            >
              <AIAnalysisComponent {...componentProps} />
            </div>
          );
        }

        // 其他类型的组件（mood, life, study, work）暂时不支持
        return (
          <div key={componentType} className="border border-gray-200 rounded-lg bg-white p-6">
            <div className="text-center text-gray-500">
              组件类型 "{componentType}" 暂不支持
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default DynamicAnalysisResult;

