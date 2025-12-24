import type { ComponentConfig } from './utils/componentSync';
import type { FieldTemplateField, FieldTemplateSource } from './types/fieldTemplate';
import type { AnalysisV3Request, AnalysisV3Response } from './types/Analysis';

// API客户端配置
// 兼容多环境：
const resolveBaseURL = () => {
  // 优先使用环境变量配置（Vite 使用 import.meta.env）
  const viteApiUrl = (import.meta.env as any).VITE_API_URL;
  if (viteApiUrl) {
    console.log('🌐 使用环境变量配置的API地址:', viteApiUrl);
    return viteApiUrl;
  }
  
  // 在浏览器环境中，使用相对路径让 Vite 代理处理
  // Vite 配置了代理：/api -> http://localhost:3001
  if (typeof window !== 'undefined') {
    console.log('🌐 使用相对路径（通过 Vite 代理）');
    return '';
  }
  
  // 服务器端渲染或非浏览器环境
  console.log('🌐 服务器端：使用默认后端地址 http://localhost:3001');
  return 'http://localhost:3001';
};

// 运行时解析
const API_BASE_URL = resolveBaseURL();

// 导入NotebookType类型
export type NotebookType = 'mood' | 'study' | 'work' | 'life';

export interface Notebook {
  notebook_id: string;
  name: string;
  description?: string | null;
  type?: NotebookType;
  note_count: number;
  component_config?: ComponentConfig | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  note_id: string;
  notebook_id: string;
  title: string;
  content: string;
  image_url?: string;
  duration_minutes?: number;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

const looksLikeHtml = (text: string) => {
  const preview = (text || '').trim().slice(0, 300).toLowerCase();
  return preview.startsWith('<!doctype') || preview.startsWith('<html') || preview.includes('<body');
};

const buildHttpError = async (response: Response) => {
  const status = response.status;
  const statusText = response.statusText || '请求失败';
  const contentType = response.headers.get('content-type') || '';

  const fallbackMessage = statusText || '未知错误';

  try {
    if (contentType.includes('application/json')) {
      const json = await response.json().catch(() => null);
      const msg =
        (json && (json.error || json.message)) ||
        (typeof json === 'string' ? json : null) ||
        fallbackMessage;
      return new Error(`请求失败(${status}): ${String(msg)}`);
    }

    const text = await response.text().catch(() => '');
    if (!text) return new Error(`请求失败(${status}): ${fallbackMessage}`);
    if (looksLikeHtml(text)) return new Error(`请求失败(${status}): ${fallbackMessage}`);

    return new Error(`请求失败(${status}): ${text}`);
  } catch {
    return new Error(`请求失败(${status}): ${fallbackMessage}`);
  }
};

const parseComponentConfig = (value: unknown): ComponentConfig | null => {
  if (!value) return null;
  let normalized = value;
  if (typeof value === 'string') {
    try {
      normalized = JSON.parse(value);
    } catch (error) {
      console.warn('Failed to parse notebook component_config:', error);
      return null;
    }
  }

  if (normalized && typeof normalized === 'object') {
    if (Array.isArray((normalized as ComponentConfig).componentInstances)) {
      return normalized as ComponentConfig;
    }
    if (Array.isArray((normalized as any).instances)) {
      return {
        componentInstances: (normalized as any).instances
      };
    }
  }
  return null;
};

const normalizeNotebook = (item: any): Notebook | null => {
  if (!item) return null;
  const notebookId =
    item.notebook_id ??
    item.id ??
    item.notebookId ??
    item.notebookID ??
    item.uuid ??
    null;

  if (!notebookId) {
    return null;
  }

  return {
    notebook_id: notebookId,
    name: item.name ?? item.title ?? '未命名笔记本',
    description: item.description ?? item.summary ?? null,
    type: item.type ?? item.notebook_type ?? item.category,
    component_config: parseComponentConfig(item.component_config ?? item.componentConfig),
    note_count: Number(
      item.note_count ??
        item.noteCount ??
        item.notes_count ??
        item.notesCount ??
        item.count ??
        0
    ) || 0,
    created_at:
      item.created_at ?? item.createdAt ?? item.created_at_iso ?? new Date().toISOString(),
    updated_at:
      item.updated_at ?? item.updatedAt ?? item.updated_at_iso ?? item.created_at ?? new Date().toISOString()
  };
};

const extractNotebookArray = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.notebooks)) return payload.notebooks;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.notebooks)) return payload.data.notebooks;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
};

// 获取笔记本列表
const getNotebooks = async (): Promise<Notebook[]> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notebooks`, { credentials: 'include' });
    
    // 检查响应状态
    if (!response.ok) {
      throw await buildHttpError(response);
    }
    
    // 尝试解析 JSON
    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      console.error('❌ JSON解析失败:', jsonError);
      throw new Error('服务器返回了无效的JSON格式');
    }

    if (data.success === false) {
      throw new Error(data.message || 'Failed to fetch notebooks');
    }

    let notebooksSource = extractNotebookArray(data);

    if (
      (!Array.isArray(notebooksSource) || notebooksSource.length === 0) &&
      data?.data &&
      typeof data.data === 'object'
    ) {
      const nestedArray = Object.values(data.data).find(value => Array.isArray(value));
      if (Array.isArray(nestedArray)) {
        notebooksSource = nestedArray;
      }
    }

    if (!Array.isArray(notebooksSource)) {
      throw new Error('Unexpected notebooks response format');
    }

    const normalized = notebooksSource
      .map(normalizeNotebook)
      .filter((item): item is Notebook => Boolean(item));

    return normalized;
  } catch (error: any) {
    console.error('❌ Error fetching notebooks:', error);
    
    // 处理网络错误
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      const requestUrl = `${API_BASE_URL || window.location.origin}/api/notebooks`;
      const backendUrl = API_BASE_URL || 'http://localhost:3001';
      throw new Error(`无法连接到后端服务器 (${backendUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 检查浏览器控制台的网络请求错误详情`);
    }
    
    throw error;
  }
};

// 获取笔记列表
const getNotes = async (notebookId: string): Promise<{ notebook: Notebook; notes: Note[] }> => {
  try {
    // 添加超时控制（5秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 5000);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/notes?notebook_id=${notebookId}`, { 
        credentials: 'include',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // 检查响应状态
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      
      // 尝试解析 JSON
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      if (data.success) {
        return {
          notebook: data.notebook,
          notes: data.notes || []
        };
      } else {
        throw new Error(data.message || 'Failed to fetch notes');
      }
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) {
        throw new Error('请求超时（5秒），后端可能正在处理中，请稍后重试');
      }
      throw fetchError;
    }
  } catch (error: any) {
    console.error('❌ Error fetching notes:', error);
    
    // 处理网络错误
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      const requestUrl = `${API_BASE_URL || window.location.origin}/api/notes`;
      const backendUrl = API_BASE_URL || 'http://localhost:3001';
      throw new Error(`无法连接到后端服务器 (${backendUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 检查浏览器控制台的网络请求错误详情`);
    }
    
    throw error;
  }
};

// 健康检查
const healthCheck = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, { credentials: 'include' });
    const data = await response.json();
    return data.success === true;
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
};

const buildFieldTemplateUrl = (notebookId: string, source: FieldTemplateSource) =>
  `${API_BASE_URL}/api/notebooks/${notebookId}/field-template?source=${source}`;

export const fetchNotebookFieldTemplate = async (
  notebookId: string,
  source: FieldTemplateSource
): Promise<{ notebook_id: string; source_type: FieldTemplateSource; fields: FieldTemplateField[]; available_fields?: FieldTemplateField[] }> => {
  if (!notebookId) {
    throw new Error('请提供 notebookId');
  }
  const response = await fetch(buildFieldTemplateUrl(notebookId, source), {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('字段模板接口未启用（404），请升级后端或稍后再试');
    throw await buildHttpError(response);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.error || '获取字段模板失败');
  }
  return data.data;
};

export const saveNotebookFieldTemplate = async (
  notebookId: string,
  source: FieldTemplateSource,
  fields: FieldTemplateField[]
): Promise<{ notebook_id: string; source_type: FieldTemplateSource; fields: FieldTemplateField[] }> => {
  if (!notebookId) {
    throw new Error('请提供 notebookId');
  }
  const response = await fetch(`${API_BASE_URL}/api/notebooks/${notebookId}/field-template`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source, fields }),
    credentials: 'include'
  });
  if (!response.ok) {
    throw await buildHttpError(response);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.error || '保存字段模板失败');
  }
  return data.data;
};

export const getLastUsedTemplateNotebook = async (
  source: FieldTemplateSource
): Promise<string | null> => {
  const response = await fetch(`${API_BASE_URL}/api/field-template/last-used?source=${source}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw await buildHttpError(response);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.error || '获取最近使用记录失败');
  }
  return data.data?.notebook_id || null;
};

export const setLastUsedTemplateNotebook = async (
  source: FieldTemplateSource,
  notebookId: string | null
): Promise<void> => {
  const response = await fetch(`${API_BASE_URL}/api/field-template/last-used`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ source, notebook_id: notebookId }),
    credentials: 'include'
  });
  if (!response.ok) {
    throw await buildHttpError(response);
  }
  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.error || '更新最近使用记录失败');
  }
};

// HTTP客户端类
class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  async get(url: string, options?: { params?: any; signal?: AbortSignal }) {
    try {
      const queryString = options?.params ? new URLSearchParams(options.params).toString() : '';
      const separator = queryString ? (url.includes('?') ? '&' : '?') : '';
      const fullUrl = `${this.baseURL}${url}${separator}${queryString}`;
      
      console.log('📤 GET请求:', fullUrl);
      
      const response = await fetch(fullUrl, {
        signal: options?.signal,
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      
      // 尝试解析 JSON
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      return { data, status: response.status, headers: response.headers };
    } catch (error: any) {
      console.error('❌ GET请求失败:', error);
      
      // 处理取消请求（超时）
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        throw new Error('请求超时，请稍后重试');
      }
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const backendUrl = this.baseURL || 'http://localhost:3001';
        throw new Error(`无法连接到后端服务器 (${backendUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 检查浏览器控制台的网络请求错误详情`);
      }
      
      // 重新抛出其他错误
      throw error;
    }
  }

  async post<T = any>(url: string, data?: any): Promise<{ data: T; status: number; headers: Headers }> {
    try {
      const fullUrl = `${this.baseURL}${url}`;
      console.log('📤 POST请求:', fullUrl);
      
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      
      // 尝试解析 JSON
      let responseData;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      return { data: responseData, status: response.status, headers: response.headers };
    } catch (error: any) {
      console.error('❌ POST请求失败:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const backendUrl = this.baseURL || 'http://localhost:3001';
        throw new Error(`无法连接到后端服务器 (${backendUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 检查浏览器控制台的网络请求错误详情`);
      }
      
      // 重新抛出其他错误
      throw error;
    }
  }

  async put(url: string, data?: any) {
    try {
      const fullUrl = `${this.baseURL}${url}`;
      console.log('📤 PUT请求:', { url: fullUrl, data });
      
      const response = await fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: data ? JSON.stringify(data, null, 2) : undefined,
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        throw await buildHttpError(response);
      }
      
      // 尝试解析 JSON
      let responseData;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      console.log('📥 PUT响应:', { status: response.status, data: responseData });
      return { data: responseData, status: response.status, headers: response.headers };
    } catch (error: any) {
      console.error('❌ PUT请求失败:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        throw new Error(`无法连接到服务器 (${this.baseURL})。请检查后端服务是否运行。`);
      }
      
      // 重新抛出其他错误
      throw error;
    }
  }

  async delete(url: string, options?: { data?: any }) {
    try {
      const fullUrl = `${this.baseURL}${url}`;
      console.log('📤 DELETE请求:', fullUrl);
      
      const response = await fetch(fullUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: options?.data ? JSON.stringify(options.data) : undefined,
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      // 尝试解析 JSON
      let responseData;
      try {
        responseData = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      return { data: responseData, status: response.status, headers: response.headers };
    } catch (error: any) {
      console.error('❌ DELETE请求失败:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const backendUrl = this.baseURL || 'http://localhost:3001';
        throw new Error(`无法连接到后端服务器 (${backendUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 检查浏览器控制台的网络请求错误详情`);
      }
      
      // 重新抛出其他错误
      throw error;
    }
  }

  // 原有的方法
  async getNotebooks(): Promise<Notebook[]> {
    return getNotebooks();
  }

  async getNotes(notebookId: string): Promise<{ notebook: Notebook; notes: Note[] }> {
    return getNotes(notebookId);
  }

  async renameNotebook(notebookId: string, name: string, description?: string | null) {
    if (!notebookId) throw new Error('notebookId is required');
    if (!name || !name.trim()) throw new Error('请输入新的笔记本名称');
    const response = await this.post(`/api/notebooks/${notebookId}/rename`, {
      name,
      description
    });
    const data = response.data;
    if (!data?.success) {
      throw new Error(data?.message || data?.error || '重命名笔记本失败');
    }
    return data.notebook as Notebook;
  }

  async deleteNotebook(notebookId: string) {
    if (!notebookId) throw new Error('notebookId is required');
    try {
      const response = await this.delete(`/api/notebooks/${notebookId}`);
      const data = response.data;
      if (!data?.success) {
        throw new Error(data?.message || data?.error || '删除笔记本失败');
      }
      return data;
    } catch (primaryError: any) {
      // 某些代理或部署不支持 DELETE，尝试兼容 POST 兜底
      try {
        const fallback = await this.post('/api/notebooks/delete', { notebook_id: notebookId });
        const data = fallback.data;
        if (!data?.success) {
          throw new Error(data?.message || data?.error || '删除笔记本失败');
        }
        return data;
      } catch (fallbackError: any) {
        try {
          const fallbackAlias = await this.post(`/api/notebooks/${notebookId}/delete`);
          const data = fallbackAlias.data;
          if (!data?.success) {
            throw new Error(data?.message || data?.error || '删除笔记本失败');
          }
          return data;
        } catch (aliasError: any) {
          console.error('❌ 删除笔记本失败 (包含兜底):', { primaryError, fallbackError, aliasError });
          throw (aliasError || fallbackError || primaryError);
        }
      }
    }
  }

  async updateNoteComponents(params: {
    noteId: string;
    componentInstances: ComponentConfig['componentInstances'];
    componentData: Record<string, any>;
    syncToNotebook?: boolean;
  }) {
    const { noteId, componentInstances, componentData, syncToNotebook } = params;
    const response = await fetch(`${API_BASE_URL}/api/notes/${noteId}/components`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        component_instances: componentInstances,
        component_data: componentData,
        syncToNotebook: !!syncToNotebook
      }),
      credentials: 'include'
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '未知错误');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data?.success) {
      throw new Error(data?.message || data?.error || '更新笔记组件失败');
    }
    return data;
  }

  async healthCheck(): Promise<boolean> {
    return healthCheck();
  }

  // 分析相关API
  async analyzeNotes(request: {
    notebookId: string;
    notebookType?: string;
    analysisData: any;
    mode?: 'ai' | 'custom';
  }): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      // 尝试解析 JSON
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      if (data.success) {
        return data;
      } else {
        throw new Error(data.message || '分析失败');
      }
    } catch (error: any) {
      console.error('❌ Error analyzing notes:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const displayUrl = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
        throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
      }
      
      throw error;
    }
  }

  async analyzeV3(request: AnalysisV3Request): Promise<AnalysisV3Response> {
    const response = await this.post('/api/analysis/v3', request);
    return response.data as AnalysisV3Response;
  }

  async getAnalysisV3Debug(analysisId: string): Promise<any> {
    const response = await this.get(`/api/analysis/v3/${analysisId}/debug`);
    return response.data;
  }

  async getAnalysisResult(analysisId: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analysis/${analysisId}`, {
        credentials: 'include'
      });
      
      // 检查响应状态
      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      // 尝试解析 JSON
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }
      
      if (data.success) {
        return data;
      } else {
        throw new Error(data.message || '获取分析结果失败');
      }
    } catch (error: any) {
      console.error('❌ Error fetching analysis result:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const displayUrl = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
        throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
      }
      
      throw error;
    }
  }

  async getAnalyses(): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analysis`, {
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }

      if (data.success) {
        return data;
      } else {
        throw new Error(data.message || '获取分析列表失败');
      }
    } catch (error: any) {
      console.error('❌ 获取分析列表失败:', error);
      throw error;
    }
  }

  async getAIAnalysisConfig(notebookId: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/ai-analysis-config/${notebookId}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }

      if (data.success) {
        return data;
      } else {
        throw new Error(data.message || '获取AI分析配置失败');
      }
    } catch (error: any) {
      console.error('❌ 获取AI分析配置失败:', error);
      throw error;
    }
  }

  async saveAIAnalysisConfig(config: {
    notebook_id: string;
    notebook_type?: string;
    chart_config?: any;
    analysis_components?: string[];
    custom_prompt?: string;
  }): Promise<any> {
    try {
      // 验证 chart_config 是否存在
      console.log('📤 [apiClient] 准备发送保存请求:', {
        notebook_id: config.notebook_id,
        hasChartConfig: 'chart_config' in config,
        chartConfig: config.chart_config,
        chartConfigType: typeof config.chart_config,
        chartConfigIsUndefined: config.chart_config === undefined,
        chartConfigIsNull: config.chart_config === null,
        allKeys: Object.keys(config)
      });
      
      // 确保所有字段都有有效值，避免 undefined 导致 JSON 解析错误
      // 重要：如果字段是 undefined，JSON.stringify 会直接省略该字段
      // 但是如果有 undefined 值在对象中，可能导致解析错误
      const requestBody: any = {
        notebook_id: config.notebook_id
      };
      
      // 只添加非 undefined 的字段
      if (config.notebook_type !== undefined) {
        requestBody.notebook_type = config.notebook_type;
      }
      
      if (config.chart_config !== undefined) {
        requestBody.chart_config = config.chart_config;
      }
      
      if (config.analysis_components !== undefined && Array.isArray(config.analysis_components)) {
        requestBody.analysis_components = config.analysis_components;
      }
      
      if (config.custom_prompt !== undefined) {
        requestBody.custom_prompt = config.custom_prompt;
      }
      
      // 验证 chart_config 是否在 requestBody 中
      if (config.chart_config !== undefined && !('chart_config' in requestBody)) {
        console.error('❌ [apiClient] 错误：chart_config 没有添加到 requestBody！', {
          config,
          requestBody
        });
        // 强制添加
        requestBody.chart_config = config.chart_config;
      }
      
      // 验证 requestBody 中没有 undefined 值
      const hasUndefined = Object.values(requestBody).some(v => v === undefined);
      if (hasUndefined) {
        console.error('❌ [apiClient] 错误：requestBody 中包含 undefined 值！', {
          requestBody,
          keys: Object.keys(requestBody),
          values: Object.values(requestBody)
        });
        // 移除 undefined 值
        Object.keys(requestBody).forEach(key => {
          if (requestBody[key] === undefined) {
            delete requestBody[key];
          }
        });
      }
      
      const stringifiedBody = JSON.stringify(requestBody);
      console.log('📤 [apiClient] 序列化后的请求体:', {
        hasChartConfig: 'chart_config' in requestBody,
        chartConfig: requestBody.chart_config,
        chartConfigType: typeof requestBody.chart_config,
        stringifiedLength: stringifiedBody.length,
        stringifiedPreview: stringifiedBody.substring(0, 500),
        allKeys: Object.keys(requestBody)
      });
      
      const response = await fetch(`${API_BASE_URL}/api/ai-analysis-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: stringifiedBody,
        credentials: 'include'
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('❌ JSON解析失败:', jsonError);
        throw new Error('服务器返回了无效的JSON格式');
      }

      if (data.success) {
        return data;
      } else {
        throw new Error(data.message || '保存AI分析配置失败');
      }
    } catch (error: any) {
      console.error('❌ 保存AI分析配置失败:', error);
      throw error;
    }
  }

  // =========================
  // AI 图表分析 V3（推荐/字段择优/字段生成）
  // =========================

  async recommendAIChart(payload: {
    fields: Array<{ name: string; role?: string; data_type?: string; source?: string; example?: string }>;
    notes_sample: Array<{ id?: string; title?: string; excerpt?: string; created_at?: string }>;
    semantic_profile?: Record<string, any>;
    policy_overrides?: Record<string, any>;
    fixed_vocabularies?: Record<string, any>;
  }): Promise<any> {
    const response = await this.post('/api/ai-chart/recommend', payload);
    return response.data;
  }

  async rerankAIChartFields(payload: {
    chart_type: 'line' | 'bar' | 'pie' | 'heatmap';
    candidate_fields: Record<string, any>;
    field_stats?: Record<string, any>;
    semantic_profile?: Record<string, any>;
    policy_overrides?: Record<string, any>;
    fixed_vocabularies?: Record<string, any>;
  }): Promise<any> {
    const response = await this.post('/api/ai-chart/rerank', payload);
    return response.data;
  }

  async deriveAIChartFields(payload: {
    missing_fields: Array<Record<string, any>>;
    notes: Array<{ id: string; title?: string; excerpt?: string; content_excerpt?: string }>;
    policy_overrides?: Record<string, any>;
    fixed_vocabularies?: Record<string, any>;
  }): Promise<any> {
    const response = await this.post('/api/ai-chart/derive-fields', payload);
    return response.data;
  }
}

// 创建默认实例
const apiClient = new ApiClient();

// 默认导出所有API函数和客户端实例
export default apiClient;

// 同时导出所有函数，以便组件可以直接导入
export { getNotebooks, getNotes, healthCheck };
