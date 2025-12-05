import type { ComponentInstance } from '../utils/componentSync';

export type ComponentType =
  | 'text-short'
  | 'text-long'
  | 'date'
  | 'number'
  | 'image'
  | 'ai-custom'
  | 'chart';

export interface NotebookComponentDefinition {
  type: ComponentType;
  label: string;
  description: string;
  icon: string;
  defaultTitle: string;
  placeholder?: string;
  advancedHint?: string;
}

export const COMPONENT_LIBRARY: NotebookComponentDefinition[] = [
  {
    type: 'text-short',
    label: '短文本',
    description: '适合标题、作者、标签等单行内容',
    icon: '📝',
    defaultTitle: '标题',
    placeholder: '请输入短文本…'
  },
  {
    type: 'text-long',
    label: '长文本',
    description: '适合正文、摘要等多段落内容',
    icon: '📄',
    defaultTitle: '正文',
    placeholder: '请输入长文本…'
  },
  {
    type: 'date',
    label: '日期',
    description: '自动格式化的日期/时间字段',
    icon: '📅',
    defaultTitle: '日期'
  },
  {
    type: 'number',
    label: '数字',
    description: '支持整数、小数，适合分值、金额等',
    icon: '🔢',
    defaultTitle: '数值',
    placeholder: '请输入数字'
  },
  {
    type: 'image',
    label: '图片',
    description: '可粘贴一行一个的图片 URL',
    icon: '🖼️',
    defaultTitle: '配图',
    advancedHint: '每行一个链接，支持多张图片'
  },
  {
    type: 'ai-custom',
    label: 'AI 摘要',
    description: '用于存储 AI 生成的摘要/要点',
    icon: '✨',
    defaultTitle: 'AI 摘要',
    placeholder: '例如：输入或粘贴 AI 生成的内容'
  },
  {
    type: 'chart',
    label: '可视化数据',
    description: '存储结构化 JSON，用于图表组件',
    icon: '📊',
    defaultTitle: '数据图表',
    advancedHint: '请粘贴合法 JSON，包含 datasets / labels 等字段'
  }
];

const DEFAULT_NOTEBOOK_COMPONENT_TYPES: ComponentType[] = ['text-short', 'text-long', 'date'];

export const getComponentDefinition = (type?: string) =>
  COMPONENT_LIBRARY.find(item => item.type === type);

export const generateComponentId = (type: ComponentType) =>
  `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createComponentInstance = (
  type: ComponentType,
  overrides?: Partial<ComponentInstance>
): ComponentInstance => {
  const definition = getComponentDefinition(type);
  const baseTitle = overrides?.title ?? definition?.defaultTitle ?? '未命名组件';

  return {
    id: overrides?.id ?? generateComponentId(type),
    type,
    title: baseTitle,
    config: overrides?.config ?? {},
    dataMapping: overrides?.dataMapping ?? {},
    ...overrides
  };
};

export const buildDefaultComponentInstances = (): ComponentInstance[] =>
  DEFAULT_NOTEBOOK_COMPONENT_TYPES.map((type, index) => {
    const definition = getComponentDefinition(type);
    return createComponentInstance(type, {
      title: definition ? definition.defaultTitle : `组件 ${index + 1}`
    });
  });

const isComponentInstance = (value: unknown): value is ComponentInstance =>
  Boolean(value && typeof value === 'object' && 'type' in (value as ComponentInstance));

export const parseComponentConfig = (input: unknown): ComponentInstance[] => {
  if (!input) return [];

  const normalized =
    typeof input === 'string'
      ? safeJsonParse(input)
      : input;

  if (
    normalized &&
    typeof normalized === 'object' &&
    Array.isArray((normalized as { componentInstances?: ComponentInstance[] }).componentInstances)
  ) {
    return sanitizeComponentInstances(
      (normalized as { componentInstances: ComponentInstance[] }).componentInstances
    );
  }

  if (Array.isArray(normalized)) {
    return sanitizeComponentInstances(normalized as ComponentInstance[]);
  }

  return [];
};

const safeJsonParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('Failed to parse component config JSON:', error);
    return null;
  }
};

export const sanitizeComponentInstances = (instances: ComponentInstance[]): ComponentInstance[] => {
  return instances
    .filter(isComponentInstance)
    .map(item => ({
      id: item.id || generateComponentId((item.type as ComponentType) || 'text-short'),
      type: item.type as ComponentType,
      title: item.title || getComponentDefinition(item.type)?.defaultTitle || '未命名组件',
      config: item.config || {},
      dataMapping: item.dataMapping || {}
    }));
};

export const serializeComponentConfig = (instances: ComponentInstance[]) => ({
  componentInstances: sanitizeComponentInstances(instances)
});


