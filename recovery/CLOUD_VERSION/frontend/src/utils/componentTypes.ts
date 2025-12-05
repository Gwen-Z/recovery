export interface BaseComponentType {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export interface ChartType {
  id: string;
  label: string;
  icon: string;
}

export type ComponentType = BaseComponentType;

export const recordComponentTypes: ComponentType[] = [
  { id: 'text-short', label: '短文本', icon: '📝', description: '输入标题、作者等简短文本' },
  { id: 'text-long', label: '长文本', icon: '📄', description: '输入正文、摘要等长文本' },
  { id: 'date', label: '日期', icon: '📅', description: '选择日期或时间' },
  { id: 'number', label: '数字', icon: '🔢', description: '输入时长、得分等数值' },
  { id: 'image', label: '图片', icon: '🖼️', description: '上传或粘贴图片链接' },
  { id: 'video', label: '视频', icon: '🎥', description: '上传或粘贴视频链接' },
  { id: 'audio', label: '音频', icon: '🎵', description: '上传音频或语音内容' },
  { id: 'file', label: '文件', icon: '📎', description: '上传文档或附件' }
];

export const analysisComponentTypes: ComponentType[] = [
  { id: 'ai-custom', label: 'AI提示词', icon: '🤖', description: '自定义 AI 摘要/分析' },
  { id: 'chart', label: '图表分析', icon: '📊', description: '结构化数据可视化' }
];

export const chartTypes: ChartType[] = [
  { id: 'bar', label: '柱状图', icon: '📊' },
  { id: 'line', label: '折线图', icon: '📈' },
  { id: 'gantt', label: '甘特图', icon: '📅' },
  { id: 'scatter', label: '散点图', icon: '🔵' },
  { id: 'pie', label: '饼图', icon: '🥧' },
  { id: 'area', label: '面积图', icon: '📉' }
];

const allComponents = [...recordComponentTypes, ...analysisComponentTypes];

export const getComponentTitle = (componentType: string): string => {
  const component = allComponents.find((c) => c.id === componentType);
  return component ? component.label : '未命名组件';
};

export const getComponentInfo = (componentType: string): ComponentType | undefined => {
  return allComponents.find((c) => c.id === componentType);
};

