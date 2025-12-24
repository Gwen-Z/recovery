import { useNavigate } from 'react-router-dom'
import UserAvatarMenu from './UserAvatarMenu'

const TopNavigation = () => {
  const navigate = useNavigate()

  return (
    <header className="sticky top-0 z-30 border-b border-[#e0f1fb] bg-[#f8fcff]/80 backdrop-blur">
      <div className="flex h-[56px] items-center justify-end gap-4 px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-xl px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#d8f5ec]"
        >
          首页
        </button>
        <button
          type="button"
          className="rounded-xl px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-[#d8f5ec]"
        >
          帮助
        </button>
        <UserAvatarMenu variant="topbar" />
      </div>
    </header>
  )
}

export default TopNavigation
