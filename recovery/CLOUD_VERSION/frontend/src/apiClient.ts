import type { ComponentConfig } from './utils/componentSync';

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
      const displayUrl = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
      throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
    }
    
    throw error;
  }
};

// 获取笔记列表
const getNotes = async (notebookId: string): Promise<{ notebook: Notebook; notes: Note[] }> => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notes?notebook_id=${notebookId}`, { credentials: 'include' });
    
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
      return {
        notebook: data.notebook,
        notes: data.notes || []
      };
    } else {
      throw new Error(data.message || 'Failed to fetch notes');
    }
  } catch (error: any) {
    console.error('❌ Error fetching notes:', error);
    
    // 处理网络错误
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      const requestUrl = `${API_BASE_URL || window.location.origin}/api/notes`;
      const displayUrl = API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
      throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
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
      
      return { data, status: response.status, headers: response.headers };
    } catch (error: any) {
      console.error('❌ GET请求失败:', error);
      
      // 处理取消请求（超时）
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        throw new Error('请求超时，请稍后重试');
      }
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const displayUrl = this.baseURL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
        throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
      }
      
      // 重新抛出其他错误
      throw error;
    }
  }

  async post(url: string, data?: any) {
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
      console.error('❌ POST请求失败:', error);
      
      // 处理网络错误
      if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
        const displayUrl = this.baseURL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
        throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
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
        const displayUrl = this.baseURL || (typeof window !== 'undefined' ? window.location.origin : 'localhost:3001');
        throw new Error(`无法连接到服务器 (${displayUrl})。请检查：\n1. 后端服务是否在端口 3001 运行\n2. 如果使用开发模式，请确保通过 http://localhost:3000 访问\n3. 检查浏览器控制台的网络请求错误详情`);
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

  async healthCheck(): Promise<boolean> {
    return healthCheck();
  }

  // 分析相关API
  async analyzeNotes(request: {
    mode: 'ai' | 'custom';
    selectedNotes: {
      notebookId: string;
      noteIds: string[];
      dateRange: { from: string; to: string };
    };
    config?: any;
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
}

// 创建默认实例
const apiClient = new ApiClient();

// 默认导出所有API函数和客户端实例
export default apiClient;

// 同时导出所有函数，以便组件可以直接导入
export { getNotebooks, getNotes, healthCheck };
