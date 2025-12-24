import { useEffect, useMemo, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const useQuery = () => {
  const location = useLocation()
  return useMemo(() => new URLSearchParams(location.search), [location.search])
}

export default function AuthCallbackPage() {
  const query = useQuery()
  const { refreshMe } = useAuth()
  const [closing, setClosing] = useState(false)

  const success = query.get('success') === '1'
  const provider = query.get('provider') || ''
  const reason = query.get('reason') || ''

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  useEffect(() => {
    if (!window.opener || window.opener === window) return
    try {
      window.opener.postMessage({ type: 'auth:oauth:done', success, provider, reason }, window.location.origin)
      setClosing(true)
      setTimeout(() => {
        window.close()
      }, 200)
    } catch {
      // ignore
    }
  }, [success, provider, reason])

  return (
    <div className="min-h-screen bg-[#eef6fd] px-4 py-10">
      <div className="mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-[#d4f3ed] bg-white shadow-xl">
        <div className="border-b border-[#eef6fd] px-6 py-5">
          <div className="text-sm font-semibold text-slate-900">登录回调</div>
          <div className="mt-1 text-xs text-slate-500">{provider ? `provider: ${provider}` : null}</div>
        </div>
        <div className="px-6 py-6">
          <div className={`rounded-2xl px-4 py-3 text-sm ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {success ? '登录成功' : `登录失败${reason ? `：${reason}` : ''}`}
          </div>
          {closing ? (
            <div className="mt-4 text-xs text-slate-500">正在关闭窗口…</div>
          ) : (
            <div className="mt-4 flex gap-3">
              <Link
                to="/workspace"
                className="inline-flex items-center justify-center rounded-2xl bg-[#0a917a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#087b67]"
              >
                进入工作区
              </Link>
              <Link
                to="/"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                返回首页
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

