import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type Variant = 'topbar' | 'sidebar' | 'landing'

const UserAvatarSvg = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M1022.902124 511.989429A511.40215 511.40215 0 1 1 325.273949 36.293814a499.186757 499.186757 0 0 1 372.452049 0 510.932328 510.932328 0 0 1 325.176126 475.695615M314.820391 404.223817a225.221319 225.221319 0 0 0 108.235435 197.149405 175.243916 175.243916 0 0 0 173.775719 1.585652 224.575313 224.575313 0 0 0 111.171827-198.735057 197.912867 197.912867 0 1 0-393.47662 0m198.852513 585.57543a475.695615 475.695615 0 0 0 369.985478-176.183561c-10.336102-84.803021-92.966192-157.038281-209.952077-193.038455a238.141447 238.141447 0 0 1-327.349057-2.995121c-113.814581 32.476503-197.149405 98.721522-216.70578 178.12158a475.695615 475.695615 0 0 0 384.021436 194.095557m0 0z"
      fill="currentColor"
    />
  </svg>
)

export default function UserAvatarMenu({ variant = 'topbar' }: { variant?: Variant }) {
  const navigate = useNavigate()
  const { user, authReady, openAuthModal, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const scheduleClose = (delayMs = 180) => {
    cancelScheduledClose()
    closeTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false)
      closeTimerRef.current = null
    }, delayMs)
  }

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  useEffect(() => {
    return () => {
      cancelScheduledClose()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [menuOpen])

  const displayName = useMemo(() => {
    if (!user) return ''
    const name = (user.name || '').trim()
    if (name) return name
    const email = String(user.email || '')
    const at = email.indexOf('@')
    return at > 0 ? email.slice(0, at) : email
  }, [user])

  const buttonClass =
    variant === 'sidebar'
      ? 'inline-flex items-center justify-center rounded-xl p-2 text-slate-300 transition hover:bg-white/60 hover:text-slate-400'
      : 'inline-flex items-center justify-center rounded-xl p-2 text-slate-300 transition hover:bg-white/60 hover:text-slate-400'

  const iconClass = variant === 'sidebar' ? 'h-7 w-7' : 'h-6 w-6'

  if (!authReady) {
    if (variant === 'sidebar') {
      return (
        <div className="w-full rounded-2xl border border-white/70 bg-white/60 px-3 py-3">
          <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />
        </div>
      )
    }
    return null
  }

  if (!user) {
    if (variant === 'sidebar') {
      return (
        <button
          type="button"
          onClick={() => openAuthModal('login')}
          className="w-full rounded-2xl bg-[#06c3a8] px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-[#8de2d5] hover:bg-[#04b094]"
        >
          登录/注册
        </button>
      )
    }

    const cls =
      variant === 'landing'
        ? 'rounded-full bg-[#06c3a8] px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-[#8de2d5] hover:bg-[#04b094]'
        : 'rounded-xl bg-[#06c3a8] px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-[#8de2d5] hover:bg-[#04b094]'

    return (
      <button type="button" onClick={() => openAuthModal('login')} className={cls}>
        登录/注册
      </button>
    )
  }

  const dropdownCls =
    variant === 'sidebar'
      ? 'absolute left-0 bottom-full mb-2 w-full rounded-2xl border border-slate-100 bg-white py-2 text-sm text-slate-700 shadow-lg'
      : 'absolute right-0 mt-2 w-52 rounded-xl border border-slate-100 bg-white py-2 text-sm text-slate-700 shadow-lg'

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onMouseEnter={() => {
          cancelScheduledClose()
          setMenuOpen(true)
        }}
        onMouseLeave={() => scheduleClose()}
        onClick={() => {
          cancelScheduledClose()
          setMenuOpen((prev) => !prev)
        }}
        onFocus={() => setMenuOpen(true)}
        className={buttonClass}
        title={user.name || user.email}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <UserAvatarSvg className={iconClass} />
      </button>

      {menuOpen && (
        <div
          className={dropdownCls}
          role="menu"
          onMouseEnter={() => {
            cancelScheduledClose()
            setMenuOpen(true)
          }}
          onMouseLeave={() => scheduleClose()}
        >
          <div className="px-4 py-2">
            <div className="text-sm font-semibold text-slate-900">{displayName}</div>
            <div className="mt-0.5 text-xs text-slate-500">{user.email}</div>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <button
            className="flex w-full items-center px-4 py-2 text-left hover:bg-[#eef6fd]"
            onClick={() => {
              setMenuOpen(false)
              navigate('/workspace')
            }}
            role="menuitem"
          >
            进入工作区
          </button>
          <button className="flex w-full items-center px-4 py-2 text-left hover:bg-[#eef6fd]" disabled role="menuitem">
            账号信息（开发中）
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            className="flex w-full items-center px-4 py-2 text-left text-red-500 hover:bg-red-50"
            onClick={() => {
              setMenuOpen(false)
              logout().catch(() => {})
            }}
            role="menuitem"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
