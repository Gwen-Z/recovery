import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt?: string;
};

export type AuthModalTab = 'login' | 'register';

type AuthContextValue = {
  user: AuthUser | null;
  authReady: boolean;
  openAuthModal: (tab?: AuthModalTab) => void;
  closeAuthModal: () => void;
  authModalOpen: boolean;
  authModalTab: AuthModalTab;
  setAuthModalTab: (tab: AuthModalTab) => void;
  refreshMe: () => Promise<AuthUser | null>;
  login: (args: { email: string; password: string }) => Promise<void>;
  register: (args: { name?: string; email: string; password: string }) => Promise<string>;
  resendEmailVerification: (args: { email: string }) => Promise<string>;
  requestPasswordReset: (args: { email: string }) => Promise<string>;
  logout: () => Promise<void>;
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  code?: string;
  data?: T;
};

class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

const clampEmail = (value: string) => String(value || '').trim().toLowerCase().slice(0, 160);

const normalizeUser = (input: any): AuthUser | null => {
  if (!input || typeof input !== 'object') return null;
  const email = String(input.email || '').trim();
  if (!email) return null;
  return {
    id: String(input.id || ''),
    email,
    name: input.name ? String(input.name) : null,
    emailVerified: Boolean(input.emailVerified),
    createdAt: input.createdAt ? String(input.createdAt) : undefined
  };
};

const apiFetch = async <T,>(path: string, init?: RequestInit): Promise<ApiResponse<T>> => {
  const resp = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    // ignore
  }

  if (!resp.ok) {
    const message = String(payload?.message || resp.statusText || '请求失败');
    throw new ApiError(message, payload?.code);
  }

  return (payload || { success: false }) as ApiResponse<T>;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<AuthModalTab>('login');

  const refreshMe = useCallback(async () => {
    try {
      const resp = await apiFetch<AuthUser | null>('/api/auth/me', { method: 'GET' });
      const next = normalizeUser(resp.data);
      setUser(next);
      setAuthReady(true);
      return next;
    } catch {
      setUser(null);
      setAuthReady(true);
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = (event && event.data) || null;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'auth:oauth:done') return;
      refreshMe();
      setAuthModalOpen(false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [refreshMe]);

  const openAuthModal = useCallback((tab?: AuthModalTab) => {
    if (tab) setAuthModalTab(tab);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  const login = useCallback(async (args: { email: string; password: string }) => {
    const email = clampEmail(args.email);
    const password = String(args.password || '');
    if (!email) throw new ApiError('请输入邮箱');
    if (!password) throw new ApiError('请输入密码');
    await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    await refreshMe();
    setAuthModalOpen(false);
  }, [refreshMe]);

  const register = useCallback(async (args: { name?: string; email: string; password: string }) => {
    const email = clampEmail(args.email);
    const password = String(args.password || '');
    const name = String(args.name || '').trim();
    if (!email) throw new ApiError('请输入邮箱');
    if (!password) throw new ApiError('请输入密码');
    const resp = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: name || undefined, email, password })
    });
    setAuthModalTab('login');
    return String(resp.message || '注册成功，请验证邮箱后登录');
  }, []);

  const resendEmailVerification = useCallback(async (args: { email: string }) => {
    const email = clampEmail(args.email);
    if (!email) throw new ApiError('请输入邮箱');
    const resp = await apiFetch('/api/auth/email/resend', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    return String(resp.message || '验证邮件已发送');
  }, []);

  const requestPasswordReset = useCallback(async (args: { email: string }) => {
    const email = clampEmail(args.email);
    if (!email) throw new ApiError('请输入邮箱');
    const resp = await apiFetch('/api/auth/password/request', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    return String(resp.message || '如果账号存在，重置邮件已发送');
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      setUser(null);
      setAuthModalOpen(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authReady,
      openAuthModal,
      closeAuthModal,
      authModalOpen,
      authModalTab,
      setAuthModalTab,
      refreshMe,
      login,
      register,
      resendEmailVerification,
      requestPasswordReset,
      logout
    }),
    [
      user,
      authReady,
      openAuthModal,
      closeAuthModal,
      authModalOpen,
      authModalTab,
      setAuthModalTab,
      refreshMe,
      login,
      register,
      resendEmailVerification,
      requestPasswordReset,
      logout
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
