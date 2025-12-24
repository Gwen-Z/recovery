import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const useQuery = () => {
  const location = useLocation()
  return useMemo(() => new URLSearchParams(location.search), [location.search])
}

export default function ResetPasswordPage() {
  const query = useQuery()
  const token = query.get('token') || ''
  const { openAuthModal } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    setStatus('idle')
    setMessage('')
  }, [token])

  const submit = async () => {
    if (submitting) return
    if (!token) {
      setStatus('error')
      setMessage('缺少 token')
      return
    }
    if (!password || password.length < 8) {
      setStatus('error')
      setMessage('新密码至少 8 位')
      return
    }
    if (password !== confirm) {
      setStatus('error')
      setMessage('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setStatus('idle')
    setMessage('')
    try {
      const resp = await fetch('/api/auth/password/reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password })
      })
      const payload = await resp.json().catch(() => null)
      if (!resp.ok || !payload?.success) {
        throw new Error(String(payload?.message || '重置失败'))
      }
      setStatus('success')
      setMessage(String(payload?.message || '密码已重置'))
    } catch (e: any) {
      setStatus('error')
      setMessage(String(e?.message || '重置失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#eef6fd] px-4 py-10">
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-[#d4f3ed] bg-white shadow-xl">
        <div className="border-b border-[#eef6fd] px-6 py-5">
          <div className="text-sm font-semibold text-slate-900">重置密码</div>
          <div className="mt-1 text-xs text-slate-500">设置一个新的登录密码</div>
        </div>
        <div className="px-6 py-6">
          <div className="space-y-3">
            <label className="block">
              <div className="mb-1 text-xs font-medium text-slate-600">新密码</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#6bd8c0]"
                placeholder="至少 8 位"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium text-slate-600">确认新密码</div>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#6bd8c0]"
                placeholder="再输入一次"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </label>
          </div>

          {status === 'success' && (
            <div className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
          )}
          {status === 'error' && (
            <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-[#0a917a] px-4 py-3 text-sm font-semibold text-white hover:bg-[#087b67] disabled:opacity-60"
          >
            {submitting ? '处理中…' : '确认重置'}
          </button>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => openAuthModal('login')}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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

