import { useState, useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import apiClient, { type Notebook } from './apiClient'
import AINoteImportPage from './components/AINoteImportPage'
import CreateNote from './components/CreateNote'
import AnalysisListPage from './components/AnalysisListPage'
import NotesPage from './components/NotesPage'
import LandingPage from './landing/LandingPage'
import NoteDetailPage from './components/NoteDetailPage'
import AnalysisPage from './components/AnalysisPage'
import AnalysisDetailPage from './components/AnalysisDetailPage'

type TabId = 'creatnote' | 'ai-import' | 'analysis-list'
type ViewType = 'category' | 'notes' | 'ai-import' | 'analysis-list' | 'analysis-select'

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewType>('category')
  const [active, setActive] = useState<TabId>('creatnote')
  const [createOpen, setCreateOpen] = useState(true)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null)

  // 加载笔记本列表
  const loadNotebooks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const notebookList = await apiClient.getNotebooks()
      setNotebooks(notebookList)
    } catch (err: any) {
      console.error('加载笔记本列表失败:', err)
      setError(err.message || '加载笔记本列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotebooks()
    
    const handleNotebookCreated = () => {
      loadNotebooks()
    }
    
    window.addEventListener('notebook:created', handleNotebookCreated)
    window.addEventListener('notebooks:refresh', handleNotebookCreated)
    
    return () => {
      window.removeEventListener('notebook:created', handleNotebookCreated)
      window.removeEventListener('notebooks:refresh', handleNotebookCreated)
    }
  }, [loadNotebooks])

  // 根据路由更新视图
  useEffect(() => {
    const path = location.pathname
    if (path === '/ai-import') {
      setView('ai-import')
      setCreateOpen(true)
    } else if (path === '/CreateNote') {
      setView('category')
      setActive('creatnote')
      setCreateOpen(true)
    } else if (path.startsWith('/notes/')) {
      const notebookId = path.split('/notes/')[1]
      setView('notes')
      setActiveNotebookId(notebookId)
    } else if (path === '/notes') {
      setView('notes')
    } else if (path === '/') {
      setView('category')
      setActive('creatnote')
      setCreateOpen(true)
    }
  }, [location.pathname])

  const handleNotebookListChange = (newList: Array<{
    notebook_id: string | null
    name: string
    description?: string | null
    note_count?: number
    created_at?: string | null
    updated_at?: string | null
  }>) => {
    setNotebooks(newList.map(nb => ({
      notebook_id: nb.notebook_id || '',
      name: nb.name,
      note_count: nb.note_count || 0,
      created_at: nb.created_at || new Date().toISOString(),
      updated_at: nb.updated_at || new Date().toISOString()
    })))
  }

  const handleRequestNotebookRefresh = () => {
    loadNotebooks()
  }

  // 如果正在加载，显示加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-purple-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-slate-600">加载中...</p>
        </div>
      </div>
    )
  }

  // 如果有错误，显示错误信息
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-purple-50">
        <div className="text-center max-w-md p-6 bg-white rounded-lg shadow-lg">
          <div className="text-red-600 text-xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">加载失败</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={loadNotebooks}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-purple-50">
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<AppContent />} />
        <Route path="/CreateNote" element={<AppContent />} />
        <Route path="/ai-import" element={<AppContent />} />
        <Route path="/analysis" element={<AppContent />} />
        <Route path="/AnalysisPage/Select" element={<AppContent />} />
        <Route path="/AnalysisPage/Select/:notebookId" element={<AppContent />} />
        <Route path="/notes" element={<AppContent />} />
        <Route path="/notes/:notebookId" element={<AppContent />} />
        <Route path="/note/:noteId" element={<NoteDetailPage />} />
        <Route path="/analysis/:analysisId" element={<AnalysisDetailPage />} />
      </Routes>
    </div>
  )
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const [notebooks, setNotebooks] = useState<Notebook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewType>('category')
  const [active, setActive] = useState<TabId>('creatnote')
  const [createOpen, setCreateOpen] = useState(true)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null)

  // 加载笔记本列表
  const loadNotebooks = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const notebookList = await apiClient.getNotebooks()
      setNotebooks(notebookList)
    } catch (err: any) {
      console.error('加载笔记本列表失败:', err)
      setError(err.message || '加载笔记本列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadNotebooks()
    
    const handleNotebookCreated = () => {
      loadNotebooks()
    }
    
    window.addEventListener('notebook:created', handleNotebookCreated)
    window.addEventListener('notebooks:refresh', handleNotebookCreated)
    
    return () => {
      window.removeEventListener('notebook:created', handleNotebookCreated)
      window.removeEventListener('notebooks:refresh', handleNotebookCreated)
    }
  }, [loadNotebooks])

  // 根据路由更新视图
  useEffect(() => {
    const path = location.pathname
    if (path === '/ai-import') {
      setView('ai-import')
      setCreateOpen(true)
    } else if (path.startsWith('/AnalysisPage/Select')) {
      setView('analysis-select')
      setActive('analysis-list')
      setAnalysisOpen(true)
    } else if (path === '/analysis') {
      setView('analysis-list')
      setActive('analysis-list')
      setAnalysisOpen(true)
    } else if (path === '/CreateNote') {
      setView('category')
      setActive('creatnote')
      setCreateOpen(true)
    } else if (path.startsWith('/notes/')) {
      const notebookId = path.split('/notes/')[1]
      setView('notes')
      setActiveNotebookId(notebookId)
      setNotesOpen(true)
    } else if (path === '/notes') {
      setView('notes')
      setNotesOpen(true)
    } else if (path === '/app') {
      setView('category')
      setActive('creatnote')
      setCreateOpen(true)
    }
  }, [location.pathname])

  const handleNotebookListChange = (newList: Array<{
    notebook_id: string | null
    name: string
    description?: string | null
    note_count?: number
    created_at?: string | null
    updated_at?: string | null
  }>) => {
    setNotebooks(newList.map(nb => ({
      notebook_id: nb.notebook_id || '',
      name: nb.name,
      note_count: nb.note_count || 0,
      created_at: nb.created_at || new Date().toISOString(),
      updated_at: nb.updated_at || new Date().toISOString()
    })))
  }

  const handleRequestNotebookRefresh = () => {
    loadNotebooks()
  }

  // 如果正在加载，显示加载状态
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-purple-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-slate-600">加载中...</p>
        </div>
      </div>
    )
  }

  // 如果有错误，显示错误信息
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-purple-50">
        <div className="text-center max-w-md p-6 bg-white rounded-lg shadow-lg">
          <div className="text-red-600 text-xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">加载失败</h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={loadNotebooks}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-48px)] flex gap-2 py-6 px-4 bg-purple-50 text-slate-800 overflow-hidden">
      <aside className="bg-transparent p-4 overflow-y-auto overflow-x-hidden sticky top-6 self-start flex-shrink-0 no-scrollbar" style={{ width: '280px', minWidth: '280px' }}>
        <div className="mb-3">
          <button
            onClick={() => navigate('/')}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-slate-700 bg-white/70 hover:bg-white/90 hover:text-[#2B2F21] transition-colors"
            style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
          >
            <span>←</span>
            <span>返回首页</span>
          </button>
        </div>

        <button
          onClick={() => setCreateOpen(v => !v)}
          className="w-full flex items-center justify-between rounded-2xl px-3 py-2 bg-white/70 hover:bg-white/90 text-slate-800 transition-colors"
          style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
        >
          <span className="flex items-center gap-2">
            <span>{createOpen ? '📂' : '📁'}</span>
            <span className="font-medium text-slate-700">创建</span>
          </span>
          <span className="text-slate-400">{createOpen ? '▾' : '▸'}</span>
        </button>
        
        {createOpen && (
          <nav className="mt-2 space-y-1 pl-6">
            <button
              onClick={() => {
                setView('ai-import')
                navigate('/ai-import')
              }}
              className={`w-full h-9 flex items-center gap-2 rounded-xl px-3 min-w-0 ${
                view === 'ai-import' ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30' : 'text-slate-800 hover:bg-purple-50'
              }`}
              style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
            >
              <span>🤖</span>
              <span className="font-medium whitespace-nowrap">AI 导入笔记</span>
            </button>
            <button
              onClick={() => {
                setView('category')
                setActive('creatnote')
                navigate('/CreateNote')
              }}
              className={`w-full h-9 flex items-center gap-2 rounded-xl px-3 min-w-0 ${
                view === 'category' && active === 'creatnote'
                  ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30'
                  : 'text-slate-800 hover:bg-purple-50'
              }`}
              style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
            >
              <span>📝</span>
              <span className="font-medium">创建笔记本</span>
            </button>
          </nav>
        )}

        <div className="my-3" />

        <button
          onClick={() => setAnalysisOpen(v => !v)}
          className="w-full flex items-center justify-between rounded-xl px-3 py-2 bg-white/60 hover:bg-white/80 text-slate-800 border border-transparent transition-colors"
          style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
        >
          <span className="flex items-center gap-2">
            <span>{analysisOpen ? '📂' : '📁'}</span>
            <span className="font-medium text-slate-700">AI分析管理</span>
          </span>
          <span className="text-slate-400">{analysisOpen ? '▾' : '▸'}</span>
        </button>
        
        {analysisOpen && (
          <nav className="mt-2 space-y-1 pl-6">
            <button
              onClick={() => {
                setView('analysis-list')
                setActive('analysis-list')
                navigate('/analysis')
              }}
              className={`w-full h-9 flex items-center gap-2 rounded-xl px-3 min-w-0 ${
                view === 'analysis-list' && active === 'analysis-list'
                  ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30'
                  : 'text-slate-800 hover:bg-purple-50'
              }`}
              style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
            >
              <span>📊</span>
              <span className="font-medium whitespace-nowrap">分析结果列表</span>
            </button>
            <button
              onClick={() => {
                setView('analysis-select')
                navigate('/AnalysisPage/Select')
              }}
              className={`w-full h-9 flex items-center gap-2 rounded-xl px-3 min-w-0 ${
                view === 'analysis-select'
                  ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30'
                  : 'text-slate-800 hover:bg-purple-50'
              }`}
              style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
            >
              <span>➕</span>
              <span className="font-medium whitespace-nowrap">新建分析</span>
            </button>
          </nav>
        )}

        <div className="my-3" />

        <button
          onClick={() => {
            setNotesOpen(v => !v)
            if (!notesOpen && !activeNotebookId) {
              if (notebooks && notebooks.length > 0) {
                setActiveNotebookId(notebooks[0].notebook_id)
                navigate(`/notes/${notebooks[0].notebook_id}`)
              } else {
                navigate('/notes')
              }
            }
          }}
          className="w-full flex items-center justify-between rounded-xl px-3 py-2 bg-white/60 hover:bg-white/80 text-slate-800 border border-transparent transition-colors"
          style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
        >
          <span className="flex items-center gap-2">
            <span>{notesOpen ? '📂' : '📁'}</span>
            <span className="font-medium text-slate-700">笔记本</span>
          </span>
          <span className="text-slate-400">{notesOpen ? '▾' : '▸'}</span>
        </button>
        
        {notesOpen && (
          <nav className="mt-2 space-y-1 pl-6">
            {notebooks && notebooks.length > 0 ? (
              notebooks.map(notebook => (
                <button
                  key={notebook.notebook_id}
                  onClick={() => {
                    setView('notes')
                    setActiveNotebookId(notebook.notebook_id)
                    navigate(`/notes/${notebook.notebook_id}`)
                  }}
                  className={`w-full h-9 flex items-center gap-2 rounded-xl px-3 min-w-0 ${
                    view === 'notes' && activeNotebookId === notebook.notebook_id
                      ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30'
                      : 'text-slate-800 hover:bg-purple-50'
                  }`}
                  style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}
                >
                  <span>🗒️</span>
                  <span className="whitespace-nowrap flex-1 text-left">{notebook.name}</span>
                </button>
              ))
            ) : (
              <div className="text-gray-500 px-3 py-2" style={{ fontSize: '14px', lineHeight: '1.5', letterSpacing: '0.2px' }}>暂无笔记本</div>
            )}
          </nav>
        )}
      </aside>

      <section className="flex-1 h-full px-2 min-w-0 bg-purple-50 overflow-y-auto no-scrollbar">
        {view === 'category' && active === 'creatnote' && <CreateNote />}
        {view === 'ai-import' && (
          <AINoteImportPage
            notebooks={notebooks.map(nb => ({
              notebook_id: nb.notebook_id,
              name: nb.name,
              note_count: nb.note_count
            }))}
            onNotebookListChange={handleNotebookListChange}
            onRequestNotebookRefresh={handleRequestNotebookRefresh}
          />
        )}
        {view === 'analysis-list' && active === 'analysis-list' && <AnalysisListPage />}
        {view === 'analysis-select' && <AnalysisPage />}
        {view === 'notes' && activeNotebookId && (
          <NotesPage notebookId={activeNotebookId} />
        )}
        {view === 'notes' && !activeNotebookId && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-2xl mb-4">📝</div>
              <h2 className="text-xl font-semibold mb-2">选择笔记本</h2>
              <p className="text-gray-600 mb-4">请从左侧选择一个笔记本来查看笔记</p>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default App

