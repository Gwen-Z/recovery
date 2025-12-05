import apiClient from '../apiClient';
import {
  recordComponentTypes,
  analysisComponentTypes,
  getComponentTitle as getComponentTitleFromTypes
} from './componentTypes';

export interface ComponentInstance {
  id: string;
  type: string;
  title: string;
  content?: string;
  config?: Record<string, unknown>;
  dataMapping?: {
    source?: string;
  };
}

export interface ComponentConfig {
  componentInstances: ComponentInstance[];
}

export const RECORD_COMPONENT_TYPES = recordComponentTypes;
export const ANALYSIS_COMPONENT_TYPES = analysisComponentTypes;

export const getComponentTitle = getComponentTitleFromTypes;

export const getComponentConfig = (componentType: string): Record<string, unknown> => {
  switch (componentType) {
    case 'ai-custom':
      return { prompt: '请总结以下内容' };
    case 'chart':
      return { chartType: 'bar' };
    default:
      return {};
  }
};

export const validateComponentConfig = (config: ComponentConfig): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!config.componentInstances || !Array.isArray(config.componentInstances)) {
    errors.push('缺少组件实例配置');
  } else {
    config.componentInstances.forEach((instance, index) => {
      if (!instance.id) errors.push(`组件实例 ${index} 缺少 ID`);
      if (!instance.type) errors.push(`组件实例 ${index} 缺少类型`);
      if (!instance.title) errors.push(`组件实例 ${index} 缺少标题`);
    });
  }

  return { valid: errors.length === 0, errors };
};

export const normalizeComponentConfig = (config: any): ComponentConfig => {
  if (config && typeof config === 'object' && Array.isArray(config.componentInstances)) {
    return {
      componentInstances: config.componentInstances
    };
  }
  return { componentInstances: [] };
};

export const mergeComponentConfig = (
  existing: ComponentConfig,
  updates: Partial<ComponentConfig>
): ComponentConfig => ({
  componentInstances: updates.componentInstances ?? existing.componentInstances
});

const dispatchConfigEvent = (notebookId: string, config: ComponentConfig) => {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    const event = new CustomEvent('notebook:configUpdated', {
      detail: { notebookId, config }
    });
    window.dispatchEvent(event);
  }
};

export const triggerConfigUpdate = (notebookId: string, config: ComponentConfig) => {
  dispatchConfigEvent(notebookId, config);
};

export const onConfigUpdate = (
  callback: (notebookId: string, config: ComponentConfig) => void
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail) {
      callback(detail.notebookId, detail.config);
    }
  };

  window.addEventListener('notebook:configUpdated', handler as EventListener);
  return () => window.removeEventListener('notebook:configUpdated', handler as EventListener);
};

export enum SyncDirection {
  NOTE_TO_NOTEBOOK = 'note_to_notebook',
  NOTEBOOK_TO_NOTES = 'notebook_to_notes',
  BIDIRECTIONAL = 'bidirectional'
}

export interface SyncConfig {
  direction: SyncDirection;
  notebookId: string;
  noteId?: string;
  componentInstances: ComponentInstance[];
  syncToNotes?: boolean;
}

export interface SyncResult {
  success: boolean;
  message: string;
  updatedNotebook?: boolean;
  updatedNotes?: string[];
  errors?: string[];
}

const sanitizeComponentInstances = (instances: ComponentInstance[] = []): ComponentInstance[] => {
  return instances.map(({ content, ...rest }) => ({
    ...rest
  }));
};

const parseNotebookResponse = (data: any) => {
  if (data?.notebook) return data.notebook;
  if (data?.data?.notebook) return data.data.notebook;
  return data?.data ?? data;
};

export const syncNoteToNotebook = async (
  notebookId: string,
  componentInstances: ComponentInstance[],
  options: { syncToNotes?: boolean } = {}
): Promise<SyncResult> => {
  try {
    const response = await apiClient.get(`/api/notebooks/${notebookId}`);
    if (!response.data?.success) {
      throw new Error(response.data?.message || '获取笔记本配置失败');
    }

    const sanitizedInstances = sanitizeComponentInstances(componentInstances);

    const updatedConfig: ComponentConfig = {
      componentInstances: sanitizedInstances
    };

    const updateResponse = await apiClient.put(`/api/notebooks/${notebookId}`, {
      componentConfig: updatedConfig,
      syncToNotes: options.syncToNotes === true
    });

    if (!updateResponse.data?.success) {
      throw new Error(updateResponse.data?.message || '更新笔记本配置失败');
    }

    triggerConfigUpdate(notebookId, updatedConfig);

    return {
      success: true,
      message: '笔记组件实例已同步到笔记本配置',
      updatedNotebook: true
    };
  } catch (error) {
    console.error('❌ 同步笔记到笔记本失败:', error);
    return {
      success: false,
      message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      errors: [error instanceof Error ? error.message : '未知错误']
    };
  }
};

export const syncNotebookToNotes = async (
  notebookId: string,
  componentInstances: ComponentInstance[]
): Promise<SyncResult> => {
  try {
    const sanitizedInstances = sanitizeComponentInstances(componentInstances);
    const updatedConfig: ComponentConfig = { componentInstances: sanitizedInstances };

    const response = await apiClient.put(`/api/notebooks/${notebookId}`, {
      componentConfig: updatedConfig,
      syncToNotes: true
    });

    if (!response.data?.success) {
      throw new Error(response.data?.message || '同步笔记本配置失败');
    }

    return {
      success: true,
      message: response.data?.message || '笔记本模板已同步到所有笔记'
    };
  } catch (error) {
    console.error('❌ 同步笔记本到笔记失败:', error);
    return {
      success: false,
      message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      errors: [error instanceof Error ? error.message : '未知错误']
    };
  }
};

export const syncComponentInstances = async (config: SyncConfig): Promise<SyncResult> => {
  try {
    switch (config.direction) {
      case SyncDirection.NOTE_TO_NOTEBOOK:
        return syncNoteToNotebook(config.notebookId, config.componentInstances, {
          syncToNotes: config.syncToNotes
        });
      case SyncDirection.NOTEBOOK_TO_NOTES:
        return syncNotebookToNotes(config.notebookId, config.componentInstances);
      case SyncDirection.BIDIRECTIONAL: {
        const notebookResult = await syncNoteToNotebook(config.notebookId, config.componentInstances);
        if (!notebookResult.success) return notebookResult;
        const notesResult = await syncNotebookToNotes(config.notebookId, config.componentInstances);
        return {
          success: notesResult.success,
          message: `${notebookResult.message}; ${notesResult.message}`,
          updatedNotebook: notebookResult.updatedNotebook,
          updatedNotes: notesResult.updatedNotes,
          errors: [...(notebookResult.errors ?? []), ...(notesResult.errors ?? [])]
        };
      }
      default:
        throw new Error(`不支持的同步方向: ${config.direction}`);
    }
  } catch (error) {
    console.error('❌ 双向同步失败:', error);
    return {
      success: false,
      message: `同步失败: ${error instanceof Error ? error.message : '未知错误'}`,
      errors: [error instanceof Error ? error.message : '未知错误']
    };
  }
};

export const smartSync = async (
  notebookId: string,
  componentInstances: ComponentInstance[],
  source: 'note' | 'notebook' = 'note'
): Promise<SyncResult> => {
  const direction =
    source === 'note' ? SyncDirection.NOTE_TO_NOTEBOOK : SyncDirection.NOTEBOOK_TO_NOTES;
  return syncComponentInstances({
    direction,
    notebookId,
    componentInstances
  });
};

export const validateConsistency = async (
  notebookId: string
): Promise<{
  consistent: boolean;
  issues: string[];
  notebookInstances: ComponentInstance[];
  noteInstances: Record<string, ComponentInstance[]>;
}> => {
  try {
    const notebookResponse = await apiClient.get(`/api/notebooks/${notebookId}`);
    if (!notebookResponse.data?.success) {
      throw new Error(notebookResponse.data?.message || '获取笔记本配置失败');
    }

    const notebook = parseNotebookResponse(notebookResponse.data);
    const notebookInstances = notebook?.component_config?.componentInstances || [];

    const notesResponse = await apiClient.get(`/api/notes?notebook_id=${notebookId}`);
    if (!notesResponse.data?.success) {
      throw new Error(notesResponse.data?.message || '获取笔记列表失败');
    }

    const notes = notesResponse.data?.notes || [];
    const issues: string[] = [];
    const noteInstances: Record<string, ComponentInstance[]> = {};

    notes.forEach((note: any) => {
      const noteComponentInstances = note.component_instances || [];
      noteInstances[note.note_id] = noteComponentInstances;

      if (noteComponentInstances.length !== notebookInstances.length) {
        issues.push(
          `笔记 ${note.note_id} 组件数量不一致: 笔记本(${notebookInstances.length}) vs 笔记(${noteComponentInstances.length})`
        );
      }

      const notebookTypes = notebookInstances.map((inst: ComponentInstance) => inst.type).sort();
      const noteTypes = noteComponentInstances.map((inst: ComponentInstance) => inst.type).sort();
      if (JSON.stringify(notebookTypes) !== JSON.stringify(noteTypes)) {
        issues.push(
          `笔记 ${note.note_id} 组件类型不一致: 笔记本[${notebookTypes.join(',')}] vs 笔记[${noteTypes.join(',')}]`
        );
      }
    });

    return {
      consistent: issues.length === 0,
      issues,
      notebookInstances,
      noteInstances
    };
  } catch (error) {
    console.error('❌ 验证一致性失败:', error);
    return {
      consistent: false,
      issues: [`验证失败: ${error instanceof Error ? error.message : '未知错误'}`],
      notebookInstances: [],
      noteInstances: {}
    };
  }
};

export const fixInconsistency = async (notebookId: string): Promise<SyncResult> => {
  try {
    const notebookResponse = await apiClient.get(`/api/notebooks/${notebookId}`);
    if (!notebookResponse.data?.success) {
      throw new Error(notebookResponse.data?.message || '获取笔记本配置失败');
    }

    const notebook = parseNotebookResponse(notebookResponse.data);
    const instances = notebook?.component_config?.componentInstances || [];

    return syncNotebookToNotes(notebookId, instances);
  } catch (error) {
    console.error('❌ 修复不一致性失败:', error);
    return {
      success: false,
      message: `修复失败: ${error instanceof Error ? error.message : '未知错误'}`,
      errors: [error instanceof Error ? error.message : '未知错误']
    };
  }
};

