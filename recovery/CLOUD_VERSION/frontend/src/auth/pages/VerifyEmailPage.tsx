import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const useQuery = () => {
  const location = useLocation()
  return useMemo(() => new URLSearchParams(location.search), [location.search])
}

export default function VerifyEmailPage() {
  const query = useQuery()
  const token = query.get('token') || ''
  const { refreshMe, openAuthModal } = useAuth()

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    const run = async () => {
      if (!token) {
        setStatus('error')
        setMessage('缺少 token')
        return
      }
      setStatus('loading')
      setMessage('')
      try {
        const resp = await fetch('/api/auth/verify-email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        })
        const payload = await resp.json().catch(() => null)
        if (!resp.ok || !payload?.success) {
          throw new Error(String(payload?.message || '验证失败'))
        }
        setStatus('success')
        setMessage(String(payload?.message || '邮箱验证成功'))
        refreshMe()
      } catch (e: any) {
        setStatus('error')
        setMessage(String(e?.message || '验证失败'))
      }
    }
    run()
  }, [token, refreshMe])

  return (
    <div className="min-h-screen bg-[#eef6fd] px-4 py-10">
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-[#d4f3ed] bg-white shadow-xl">
        <div className="border-b border-[#eef6fd] px-6 py-5">
          <div className="text-sm font-semibold text-slate-900">邮箱验证</div>
          <div className="mt-1 text-xs text-slate-500">完成后即可使用邮箱密码登录</div>
        </div>
        <div className="px-6 py-6">
          {status === 'loading' && (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">验证中…</div>
          )}
          {status === 'success' && (
            <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
          )}
          {status === 'error' && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>
          )}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="inline-flex items-center justify-center rounded-2xl bg-[#0a917a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#087b67]"
            >
              去登录
            </button>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              返回首页
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

