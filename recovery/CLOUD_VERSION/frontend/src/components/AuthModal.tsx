import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/AuthContext';

const clampEmail = (value: string) => String(value || '').trim().slice(0, 160);

const AuthModal = () => {
  const {
    authModalOpen,
    closeAuthModal,
    authModalTab,
    setAuthModalTab,
    login,
    register,
    resendEmailVerification,
    requestPasswordReset
  } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [needVerify, setNeedVerify] = useState(false);

  useEffect(() => {
    if (!authModalOpen) return;
    setInfo(null);
  }, [authModalOpen]);

  useEffect(() => {
    if (!authModalOpen) return;
    setError(null);
    setNeedVerify(false);
    setSubmitting(false);
    // 保留 email，方便用户切换 tab，不清空
    setPassword('');
    if (authModalTab === 'login') setName('');
  }, [authModalOpen, authModalTab]);

  const title = useMemo(() => (authModalTab === 'login' ? '登录' : '注册'), [authModalTab]);

  const WechatIcon = (
    <svg viewBox="0 0 1024 1024" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path
        d="M684.8 332.8c-166.4 0-300.8 110.08-300.8 245.76 0 77.12 44.16 147.2 118.4 193.92l-29.44 87.04c-2.56 7.68 5.12 15.36 12.8 12.8l103.68-52.48c30.72 7.68 62.72 12.8 95.36 12.8 166.4 0 300.8-110.08 300.8-245.76S851.2 332.8 684.8 332.8z"
        fill="#1AAD19"
      />
      <path
        d="M361.6 256c-162.56 0-294.4 106.24-294.4 238.08 0 74.24 42.24 141.44 113.92 186.88l-28.16 83.2c-2.56 7.68 5.12 15.36 12.8 12.8l99.84-50.56c29.44 7.68 60.16 12.8 92.16 12.8 10.24 0 20.48-0.64 30.72-1.28-18.56-32-28.8-67.2-28.8-104.96 0-142.08 137.6-257.92 307.2-257.92 9.6 0 19.2 0.64 28.16 1.28C655.36 302.08 519.04 256 361.6 256z"
        fill="#1AAD19"
        opacity="0.9"
      />
      <circle cx="276.48" cy="473.6" r="34.56" fill="#fff" />
      <circle cx="430.08" cy="473.6" r="34.56" fill="#fff" />
      <circle cx="606.72" cy="588.8" r="34.56" fill="#fff" />
      <circle cx="760.32" cy="588.8" r="34.56" fill="#fff" />
    </svg>
  );

  const GoogleIcon = (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path
        d="M24 9.5c3.3 0 6.2 1.2 8.5 3.4l6-6C35 3.7 29.8 1.5 24 1.5 14.8 1.5 6.9 6.8 3.1 14.5l7.1 5.5C12 13.8 17.6 9.5 24 9.5z"
        fill="#EA4335"
      />
      <path
        d="M46.5 24.5c0-1.7-0.2-3.3-0.5-4.9H24v9.3h12.6c-0.5 2.6-2 4.8-4.3 6.3l6.6 5.1c3.9-3.6 6.1-8.8 6.1-15.8z"
        fill="#4285F4"
      />
      <path
        d="M10.2 28.2c-0.6-1.7-1-3.4-1-5.2 0-1.8 0.3-3.6 0.9-5.2l-7.1-5.5C1.9 15 1.5 19 1.5 23c0 4.1 1 8 2.8 11.5l7-6.3z"
        fill="#FBBC05"
      />
      <path
        d="M24 46.5c5.8 0 10.6-1.9 14.1-5.2l-6.6-5.1c-1.8 1.2-4.2 2-7.5 2-6.4 0-11.9-4.3-13.8-10.2l-7 6.3c3.8 7.7 11.7 12.2 20.3 12.2z"
        fill="#34A853"
      />
    </svg>
  );

  const openOAuth = (provider: 'google' | 'wechat') => {
    const url = provider === 'google' ? '/api/auth/oauth/google' : '/api/auth/oauth/wechat';
    const width = 520;
    const height = 680;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const win = window.open(
      url,
      `oauth_${provider}`,
      `width=${width},height=${height},left=${Math.max(left, 0)},top=${Math.max(top, 0)},resizable=yes,scrollbars=yes`
    );
    if (!win) {
      window.location.href = url;
    }
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setInfo(null);
    setNeedVerify(false);
    setSubmitting(true);
    try {
      if (authModalTab === 'login') {
        await login({ email: clampEmail(email), password });
        return;
      } else {
        const message = await register({ name: name.trim(), email: clampEmail(email), password });
        setInfo(message);
        setSubmitting(false);
      }
    } catch (e: any) {
      setError(String(e?.message || '操作失败，请重试'));
      setNeedVerify(String(e?.code || '') === 'EMAIL_NOT_VERIFIED');
      setSubmitting(false);
    }
  };

  if (!authModalOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000]">
      <div
        className="absolute inset-0 bg-black/30"
        onMouseDown={() => {
          closeAuthModal();
        }}
      />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2">
        <div
          className="overflow-hidden rounded-3xl border border-[#d4f3ed] bg-white shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 border-b border-[#eef6fd] px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <button
              type="button"
              onClick={closeAuthModal}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>

          <div className="px-5 py-4">
            <div className="flex items-center gap-2 rounded-2xl bg-[#f8fcff] p-1">
              <button
                type="button"
                onClick={() => setAuthModalTab('login')}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  authModalTab === 'login' ? 'bg-white text-[#0a917a] shadow-sm' : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => setAuthModalTab('register')}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  authModalTab === 'register'
                    ? 'bg-white text-[#0a917a] shadow-sm'
                    : 'text-slate-600 hover:text-slate-800'
                }`}
              >
                注册
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {authModalTab === 'register' && (
                <label className="block">
                  <div className="mb-1 text-xs font-medium text-slate-600">昵称（可选）</div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#6bd8c0]"
                    placeholder="例如：小明"
                  />
                </label>
              )}
              <label className="block">
                <div className="mb-1 text-xs font-medium text-slate-600">邮箱</div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#6bd8c0]"
                  placeholder="name@example.com"
                  inputMode="email"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-medium text-slate-600">密码</div>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#6bd8c0]"
                  placeholder="请输入密码"
                  type="password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                  }}
                />
              </label>
              {authModalTab === 'login' && (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={async () => {
                      if (submitting) return;
                      setError(null);
                      setInfo(null);
                      setNeedVerify(false);
                      setSubmitting(true);
                      try {
                        const message = await requestPasswordReset({ email: clampEmail(email) });
                        setInfo(message);
                      } catch (e: any) {
                        setError(String(e?.message || '发送失败'));
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    忘记密码
                  </button>
                  <div className="text-[11px] text-slate-400">邮箱需先验证</div>
                </div>
              )}
              {info && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  {info}
                </div>
              )}
              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}
              {needVerify && (
                <button
                  type="button"
                  onClick={async () => {
                    if (submitting) return;
                    setError(null);
                    setInfo(null);
                    setSubmitting(true);
                    try {
                      const message = await resendEmailVerification({ email: clampEmail(email) });
                      setInfo(message);
                      setNeedVerify(false);
                    } catch (e: any) {
                      setError(String(e?.message || '发送失败'));
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-[#d4f3ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#0a917a] hover:bg-[#f2fffc] disabled:opacity-60"
                  disabled={submitting}
                >
                  重新发送验证邮件
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="mt-1 inline-flex w-full items-center justify-center rounded-2xl bg-[#0a917a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#087b67] disabled:opacity-60"
              >
                {submitting ? '处理中…' : authModalTab === 'login' ? '登录' : '注册'}
              </button>
              {authModalTab === 'register' && (
                <div className="text-center text-[11px] text-slate-400">注册后会发送邮箱验证链接（建议使用真实邮箱）</div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <div className="h-px flex-1 bg-slate-100" />
                <div className="text-[11px] text-slate-400">或</div>
                <div className="h-px flex-1 bg-slate-100" />
              </div>

              <button
                type="button"
                onClick={() => openOAuth('wechat')}
                className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <span className="inline-flex items-center justify-center">{WechatIcon}</span>
                使用微信登录
              </button>
              <button
                type="button"
                onClick={() => openOAuth('google')}
                className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <span className="inline-flex items-center justify-center">{GoogleIcon}</span>
                使用 Google 登录
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AuthModal;
