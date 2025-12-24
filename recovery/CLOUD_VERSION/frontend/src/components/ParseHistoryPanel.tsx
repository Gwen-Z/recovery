import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../apiClient'
import ParseHistoryEditModal from './ParseHistoryEditModal'
import { DEFAULT_AI_SUMMARY_PROMPT } from '../constants/aiSummary'
import { PARSE_HISTORY_EVENTS } from '../constants/events'
import { useAiSummaryPrompts } from '../hooks/useAiSummaryPrompts'
import { HistoryStatus, normalizeHistoryStatus } from '../utils/parseHistoryStatus'

type NotebookOption = {
  notebook_id: string | null
  name: string
  description?: string | null
  note_count?: number
  created_at?: string | null
  updated_at?: string | null
}

const IMPORT_HISTORY_OPEN_STORAGE_KEY = 'ai_import_history_open_v1'

const SearchHistoryIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 1024 1024"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M446.112323 177.545051c137.567677 0.219798 252.612525 104.59798 266.162424 241.493333 13.562828 136.895354-78.778182 261.818182-213.617777 289.008485-134.852525 27.203232-268.386263-52.156768-308.945455-183.608889s25.018182-272.252121 151.738182-325.779394A267.235556 267.235556 0 0 1 446.112323 177.545051m0-62.060607c-182.794343 0-330.989899 148.195556-330.989899 330.989899s148.195556 330.989899 330.989899 330.989899 330.989899-148.195556 330.989899-330.989899-148.195556-330.989899-330.989899-330.989899z m431.321212 793.341415a30.849293 30.849293 0 0 1-21.94101-9.102223l-157.220202-157.220202c-11.752727-12.179394-11.584646-31.534545 0.37495-43.50707 11.972525-11.972525 31.327677-12.140606 43.494141-0.37495l157.220202 157.220202a31.036768 31.036768 0 0 1 6.723232 33.810101 31.004444 31.004444 0 0 1-28.651313 19.174142z"
      fill="currentColor"
    />
  </svg>
)

const loadInitialImportHistoryOpen = (): boolean => {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(IMPORT_HISTORY_OPEN_STORAGE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch {
    // ignore
  }
  return false
}

const parseKeywords = (tags?: string | null) => {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => (typeof item === 'string' ? item.trim() : String(item)))
        .filter(Boolean)
    }
  } catch {
    /* ignore parse error */
  }
  return []
}

const extractNoteTypeFromHistory = (historyLike: any): string | null => {
  if (!historyLike) return null
  const direct =
    typeof historyLike.parsed_note_type === 'string' && historyLike.parsed_note_type.trim()
      ? historyLike.parsed_note_type.trim()
      : null
  if (direct) return direct

  const fallback =
    typeof historyLike.note_type === 'string' && historyLike.note_type.trim()
      ? historyLike.note_type.trim()
      : null
  if (fallback) return fallback

  const fieldsSource =
    historyLike.parsed_fields ?? historyLike.parsedFields ?? historyLike.fields ?? null
  if (!fieldsSource) return null

  try {
    const parsed = typeof fieldsSource === 'string' ? JSON.parse(fieldsSource) : fieldsSource
    const noteTypeCandidate =
      typeof parsed?.note_type === 'string' && parsed.note_type.trim()
        ? parsed.note_type.trim()
        : typeof parsed?.noteType === 'string' && parsed.noteType.trim()
          ? parsed.noteType.trim()
          : ''
    return noteTypeCandidate || null
  } catch (error) {
    console.warn('⚠️ 无法从 parsed_fields 中解析 note_type:', error)
    return null
  }
}

// 格式化解析的内容，清理JSON格式和转义字符（与 AINoteImportPage 保持一致）
const formatParsedContent = (rawContent: string): string => {
  if (!rawContent) return ''

  let cleaned = rawContent.trim()

  // -1. 首先处理不完整的JSON字符串（如："title": "xxx", "su）
  // 这种情况通常是因为后端返回的字段包含了JSON字符串的一部分
  // 检测模式：包含JSON键值对格式但可能不完整
  if ((cleaned.startsWith('"') || cleaned.startsWith('{')) && cleaned.includes('":')) {
    // 尝试从不完整的JSON中提取所有字符串值
    // 使用更强大的正则表达式，能够处理转义的引号
    const extractedValues: string[] = []
    // 匹配 "key": "value" 模式，支持转义引号和JSON格式
    // 这个正则表达式能够处理转义的引号（如 \"）
    let pos = 0
    while (pos < cleaned.length) {
      // 查找键：从 "key" 开始
      const keyStart = cleaned.indexOf('"', pos)
      if (keyStart === -1) break

      // 查找键的结束位置（需要考虑转义引号）
      let keyEnd = keyStart + 1
      while (keyEnd < cleaned.length) {
        if (cleaned[keyEnd] === '"' && cleaned[keyEnd - 1] !== '\\') {
          break
        }
        keyEnd++
      }

      // 查找冒号
      const colonPos = cleaned.indexOf(':', keyEnd)
      if (colonPos === -1) break

      // 跳过空白
      let valueStart = colonPos + 1
      while (valueStart < cleaned.length && /\s/.test(cleaned[valueStart])) {
        valueStart++
      }

      // 如果值是以引号开头
      if (cleaned[valueStart] === '"') {
        // 查找值的结束位置（需要考虑转义引号）
        let valueEnd = valueStart + 1
        while (valueEnd < cleaned.length) {
          if (cleaned[valueEnd] === '"' && cleaned[valueEnd - 1] !== '\\') {
            const value = cleaned
              .substring(valueStart + 1, valueEnd)
              .replace(/\\"/g, '"') // 还原转义的引号
              .replace(/\\n/g, '\n') // 还原换行符
              .trim()
            if (value) {
              extractedValues.push(value)
            }
            pos = valueEnd + 1
            break
          }
          valueEnd++
        }
        if (valueEnd >= cleaned.length) {
          // JSON不完整，尝试提取到最后的值
          const incompleteValue = cleaned
            .substring(valueStart + 1)
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .trim()
            // 移除可能的逗号和其他JSON结构
            .replace(/[,\s}].*$/, '')
          if (incompleteValue) {
            extractedValues.push(incompleteValue)
          }
          break
        }
      } else {
        pos = valueStart + 1
      }
    }

    // 如果提取到了值，使用第一个或合并它们（优先使用较长的值）
    if (extractedValues.length > 0) {
      // 如果只有一个值或所有值都很短，使用最长的那个
      const longestValue = extractedValues.reduce((a, b) => (a.length > b.length ? a : b))
      cleaned = longestValue
    } else {
      // 如果没提取到值，尝试简单清理JSON格式
      cleaned = cleaned
        .replace(/^["{]\s*/, '') // 移除开头的引号或大括号
        .replace(/["}]\s*,?\s*.*$/, '') // 移除结尾的引号、大括号和后续内容
        .replace(/^[^:]+:\s*"/, '') // 移除键和冒号
        .replace(/"\s*,?\s*.*$/, '') // 移除引号和后续内容
        .replace(/\\"/g, '"') // 还原转义的引号
        .trim()
    }
  }

  // 0. 先检查整个内容是否就是一个JSON对象
  // 如果是，尝试提取其中的内容字段（如content、text等）
  try {
    const trimmed = cleaned.trim()
    // 更严格的检查：整个内容就是一个JSON对象（没有其他文本）
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      // 尝试解析为JSON
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // 检查是否所有字段都是空的
        const hasContent = Object.values(parsed).some((val: any) => {
          if (val === null || val === undefined) return false
          if (Array.isArray(val)) return val.length > 0
          if (typeof val === 'string') return val.trim().length > 0
          if (typeof val === 'object') {
            // 如果是对象，检查是否有非空属性
            return (
              Object.keys(val).length > 0 &&
              Object.values(val).some((v: any) => {
                if (Array.isArray(v)) return v.length > 0
                if (typeof v === 'string') return v.trim().length > 0
                return !!v && v !== null && v !== undefined
              })
            )
          }
          return !!val
        })

        // 如果所有字段都为空，说明后端返回了空结果，直接返回空字符串
        if (!hasContent) {
          return ''
        }

        // 如果有内容，尝试提取主要文本内容
        // 优先查找 content, text, body, article 等字段
        const contentFields = ['content', 'text', 'body', 'article', 'message', 'result', 'summary']
        for (const field of contentFields) {
          if (parsed[field] && typeof parsed[field] === 'string' && parsed[field].trim()) {
            // 找到了内容字段，递归处理（因为内容可能还包含JSON代码块）
            return formatParsedContent(parsed[field])
          }
        }

        // 如果没有找到专门的内容字段，但JSON中有内容
        // 说明这个JSON对象本身就是格式化的元数据，不应该被删除
        // 但我们需要将其转换为可读格式
        // 这种情况下，不应该在这里处理，应该继续后续的处理流程
      }
    }
  } catch {
    // 不是纯JSON对象，继续处理
  }

  // 1. 先尝试提取并解析 JSON 代码块中的内容
  const jsonBlocks: Array<{ json: any; start: number; end: number; isCodeBlock: boolean }> = []

  // 匹配 ```json ... ``` 代码块
  const jsonCodeBlockRegex = /```json\s*([\s\S]*?)\s*```/gi
  let match: RegExpExecArray | null
  while ((match = jsonCodeBlockRegex.exec(cleaned)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsonBlocks.push({
          json: parsed,
          start: match.index,
          end: match.index + match[0].length,
          isCodeBlock: true
        })
      }
    } catch {
      // 忽略解析错误
    }
  }

  // 匹配独立的 JSON 对象 {...}（但排除已经是代码块的）
  const jsonObjectRegex = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\})*)*\}))*\}/g
  let jsonMatch: RegExpExecArray | null
  while ((jsonMatch = jsonObjectRegex.exec(cleaned)) !== null) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // 检查是否已经被代码块匹配包含
        const isContained = jsonBlocks.some(
          block => jsonMatch!.index >= block.start && jsonMatch!.index < block.end
        )
        if (!isContained) {
          // 检查这个JSON对象是否在文本中的独立位置（前后都是空白或换行）
          const before = cleaned.slice(Math.max(0, jsonMatch.index - 50), jsonMatch.index)
          const after = cleaned.slice(
            jsonMatch.index + jsonMatch[0].length,
            jsonMatch.index + jsonMatch[0].length + 50
          )
          const isStandalone =
            (jsonMatch.index === 0 || /^\s*$/.test(before)) &&
            (jsonMatch.index + jsonMatch[0].length === cleaned.length || /^\s*$/.test(after))

          // 只有在不是整个内容且是独立JSON对象时才标记为需要移除
          // 如果这个JSON对象就是整个内容（且在前面的检查中已经确认有内容），则保留
          if (
            !isStandalone ||
            jsonMatch.index !== 0 ||
            jsonMatch.index + jsonMatch[0].length !== cleaned.length
          ) {
            jsonBlocks.push({
              json: parsed,
              start: jsonMatch.index,
              end: jsonMatch.index + jsonMatch[0].length,
              isCodeBlock: false
            })
          }
        }
      }
    } catch {
      // 忽略解析错误
    }
  }

  // 2. 移除所有 JSON 代码块（只移除代码块，不移除独立的JSON对象，除非它们确实是格式化的代码）
  const sortedBlocks = jsonBlocks
    .filter(block => block.isCodeBlock) // 只移除代码块
    .sort((a, b) => b.start - a.start) // 从后往前删除，避免索引变化

  for (const block of sortedBlocks) {
    cleaned = cleaned.slice(0, block.start) + cleaned.slice(block.end)
  }

  // 移除剩余的 ```json ... ``` 标记
  cleaned = cleaned.replace(/```json[\s\S]*?```/gi, '')

  // 3. 将 \n 转义字符转换为实际换行
  cleaned = cleaned.replace(/\\n/g, '\n')

  // 4. 清理多余的空白行和前后空白
  cleaned = cleaned
    .replace(/\n{3,}/g, '\n\n') // 将3个以上连续换行压缩为2个
    .replace(/^\s+|\s+$/g, '') // 移除首尾空白

  // 5. 移除格式化的标题行中的 JSON 残留
  // 例如 "标题：{" 这种情况
  cleaned = cleaned.replace(/标题[：:]\s*\{[^}]*\}/g, match => {
    // 尝试提取标题内容
    const contentMatch = match.match(/标题[：:]\s*\{(.+?)\}/)
    if (contentMatch && contentMatch[1]) {
      return `标题：${contentMatch[1].trim()}`
    }
    return match.replace(/\{.*?\}/, '')
  })

  // 6. 移除其他字段中的 JSON 残留
  cleaned = cleaned.replace(/来源[：:]\s*\{[^}]*\}/g, match => {
    const contentMatch = match.match(/来源[：:]\s*\{(.+?)\}/)
    if (contentMatch && contentMatch[1]) {
      return `来源：${contentMatch[1].trim()}`
    }
    return match.replace(/\{.*?\}/, '')
  })

  // 7. 处理混合格式，如 "标题：{来源：xxx / xxx}"
  cleaned = cleaned.replace(
    /(标题|来源|作者|发布时间|摘要)[：:]\s*\{([^}]+)\}/g,
    (match, field, content) => {
      // 检查是否是JSON格式（包含引号、逗号等JSON特征）
      const isJsonLike = content.includes('"') || (content.includes(',') && content.includes(':'))

      // 如果不是JSON格式，直接提取内容
      if (!isJsonLike) {
        // 提取内容中的实际文本（可能包含其他字段，如"来源：xxx"）
        const textContent = content.trim()
        return `${field}：${textContent}`
      }

      // 如果是JSON格式，尝试提取值
      // 例如从 "title": "xxx" 中提取 xxx
      const valueMatch = content.match(/["']([^"']+)["']/)
      if (valueMatch && valueMatch[1]) {
        return `${field}：${valueMatch[1]}`
      }

      // 如果无法提取，至少保留字段名
      return `${field}：`
    }
  )

  // 8. 移除单独的大括号和空对象标记
  cleaned = cleaned.replace(/\{\s*\}/g, '')
  cleaned = cleaned.replace(/^\s*\{\s*$/gm, '')

  // 9. 清理可能残留的不完整JSON结构
  cleaned = cleaned.replace(/\{[^}]*$/g, '') // 移除未闭合的大括号
  cleaned = cleaned.replace(/^[^{]*\}/g, '') // 移除只有闭合大括号的行

  // 10. 清理不完整的JSON键值对（如："title": "xxx", "su 或 "title": "xxx",\n  "su）
  // 移除末尾不完整的键值对
  cleaned = cleaned.replace(/,\s*"[^"]*$/, '') // 移除末尾不完整的键（如 , "su）
  cleaned = cleaned.replace(/,\s*"[^"]*":\s*"[^"]*$/, '') // 移除末尾不完整的键值对
  cleaned = cleaned.replace(/,\s*"[^"]*":\s*$/, '') // 移除末尾只有键没有值的结构

  // 11. 清理每行末尾的不完整JSON结构
  cleaned = cleaned
    .split('\n')
    .map(line => {
      // 如果行以不完整的JSON键值对结尾，移除它
      // 匹配模式：...", "key 或 ...", "key": 或 ...", "key": "
      line = line.replace(/,\s*"[^"]*$/, '') // 移除末尾不完整的键
      line = line.replace(/,\s*"[^"]*":\s*$/, '') // 移除末尾只有键的结构
      line = line.replace(/,\s*"[^"]*":\s*"[^"]*$/, '') // 移除末尾不完整的键值对
      return line
    })
    .join('\n')

  return cleaned.trim()
}

interface ParseHistory {
  id: string
  source_url: string
  parsed_content: string
  note_ids?: string | null
  parsed_title?: string | null
  parsed_summary?: string | null
  parsed_author?: string | null
  parsed_source?: string | null
  parsed_platform?: string | null
  parsed_published_at?: string | null
  parsed_img_urls?: string[] | null
  parsed_note_type?: string | null
  suggested_notebook_id?: string | null
  suggested_notebook_name?: string | null
  suggested_new_notebook?: {
    name: string | null
    description: string | null
    reason: string
  } | null
  assigned_notebook_id?: string | null
  assigned_notebook_name?: string | null
  source_type?: string | null
  status: HistoryStatus
  notes?: string | null
  tags?: string | null
  keywords?: string[] | null
  parsed_at: string
}

type HistoryFilter = 'all' | HistoryStatus

export type ParseHistoryPanelProps = {
  notebooks: NotebookOption[]
  onRequestNotebookRefresh?: () => void
}

export default function ParseHistoryPanel({ notebooks, onRequestNotebookRefresh }: ParseHistoryPanelProps) {
  const navigate = useNavigate()
  const [importHistoryOpen, setImportHistoryOpen] = useState<boolean>(() => loadInitialImportHistoryOpen())
  const [historyList, setHistoryList] = useState<ParseHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [editingHistory, setEditingHistory] = useState<ParseHistory | null>(null)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const [highlightedHistoryId, setHighlightedHistoryId] = useState<string | null>(null)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())
  const [assigningHistoryId, setAssigningHistoryId] = useState<string | null>(null)
  const [rowEditModeHistoryId, setRowEditModeHistoryId] = useState<string | null>(null)
  const [manualMoveHistory, setManualMoveHistory] = useState<ParseHistory | null>(null)
  const [manualMoveNotebookId, setManualMoveNotebookId] = useState<string>('')
  const [manualMoveLoading, setManualMoveLoading] = useState(false)
  const [manualMoveError, setManualMoveError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const { linkPrompt, textPrompt, setLinkPrompt, setTextPrompt } = useAiSummaryPrompts()
  const [historySearchInput, setHistorySearchInput] = useState('')
  const [historySearchQuery, setHistorySearchQuery] = useState('')

  const updateParseSettingsPrompt = useCallback((nextPrompt: string) => {
    setLinkPrompt(nextPrompt)
  }, [setLinkPrompt])

  const updateTextPrompt = useCallback((nextPrompt: string) => {
    setTextPrompt(nextPrompt)
  }, [setTextPrompt])

  const toggleImportHistoryOpen = useCallback(() => {
    setImportHistoryOpen(prev => {
      const next = !prev
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(IMPORT_HISTORY_OPEN_STORAGE_KEY, next ? '1' : '0')
        } catch {
          // ignore
        }
      }
      return next
    })
  }, [])

  const openImportHistory = useCallback(() => {
    setImportHistoryOpen(true)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(IMPORT_HISTORY_OPEN_STORAGE_KEY, '1')
      } catch {
        // ignore
      }
    }
    // 不自动 scrollIntoView：
    // - 从首页“自动开始解析”跳转过来时，scrollIntoView 会把页面强制滚动到历史面板附近，
    //   造成视觉上像“白色遮挡/跳动”，并且让用户错过顶部的输入区与状态。
  }, [])

  const availableNotebooks = useMemo(() => notebooks || [], [notebooks])

  const selectableNotebooks = useMemo(
    () =>
      availableNotebooks.filter(
        (nb): nb is NotebookOption & { notebook_id: string } => !!nb.notebook_id
      ),
    [availableNotebooks]
  )

  // 加载解析/分配历史（与 AINoteImportPage 保持一致）
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    setHistoryLoadError(null)
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const params: any = { limit: 50 }
      if (historyFilter !== 'all') {
        params.status = historyFilter
      }
      if (historySearchQuery.trim()) {
        params.keyword = historySearchQuery.trim()
      }

      const controller = new AbortController()
      timeoutId = setTimeout(() => {
        console.warn('⏰ 解析/分配历史请求超时，取消请求')
        controller.abort()
      }, 60000)

      const response = (await apiClient.get('/api/coze/parse-history', {
        params,
        signal: controller.signal
      })) as any

      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (response?.data?.success) {
        const items = Array.isArray(response.data.data?.items) ? response.data.data.items : []
        const mapped: ParseHistory[] = items.map((item: any) => ({
          ...item,
          status: normalizeHistoryStatus(item.status),
          keywords: Array.isArray(item.keywords) ? item.keywords : parseKeywords(item.tags),
          parsed_note_type: extractNoteTypeFromHistory(item)
        }))
        setHistoryList(mapped)
        setHistoryLoadError(null)

        const totalPages = Math.ceil(mapped.length / itemsPerPage)
        if (totalPages > 0 && currentPage > totalPages) {
          setCurrentPage(totalPages)
        }
      } else {
        setHistoryList([])
        setLoadingHistory(false)
        setHistoryLoadError('加载失败')
      }
    } catch (err: any) {
      console.error('加载历史失败:', err)
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      setHistoryList([])
      setLoadingHistory(false)
      const errorMessage = err.response?.data?.error || err.message || '加载失败'
      setHistoryLoadError(errorMessage)
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      setLoadingHistory(false)
    }
  }, [historyFilter, currentPage, itemsPerPage, historySearchQuery])

  const handleEditHistory = async (historyId: string) => {
    try {
      const response = await apiClient.get(`/api/coze/parse-history/${historyId}`)
      if (response?.data?.success && response.data.data) {
        const historyData = response.data.data
        const mapped: ParseHistory = {
          ...historyData,
          status: normalizeHistoryStatus(historyData.status),
          keywords: Array.isArray(historyData.keywords) ? historyData.keywords : parseKeywords(historyData.tags),
          parsed_img_urls: historyData.parsed_img_urls !== undefined ? historyData.parsed_img_urls : null,
          parsed_note_type: extractNoteTypeFromHistory(historyData)
        }
        setEditingHistory(mapped)
      } else {
        setError('获取历史详情失败')
      }
    } catch (err) {
      console.error('获取历史详情失败:', err)
      setError('获取历史详情失败')
    }
  }

  const handleDeleteHistory = async (historyId: string) => {
    if (!window.confirm('确定要删除这条解析/分配历史吗？')) return
    try {
      await apiClient.delete(`/api/coze/parse-history/${historyId}`)
      const currentPageIndex = (currentPage - 1) * itemsPerPage
      const remainingOnPage = historyList.length - currentPageIndex
      if (remainingOnPage <= 1 && currentPage > 1) {
        setCurrentPage(prev => Math.max(1, prev - 1))
      }
      await loadHistory()
      setSelectedHistoryIds(prev => {
        const next = new Set(prev)
        next.delete(historyId)
        return next
      })
    } catch (err: any) {
      console.error('删除历史失败:', err)
      const errorMessage = err?.response?.data?.error || err?.message || '删除失败'
      setError(errorMessage)
    }
  }

  const handleBatchDeleteHistory = async () => {
    if (selectedHistoryIds.size === 0) return
    if (!window.confirm(`确定要删除选中的 ${selectedHistoryIds.size} 条解析/分配历史吗？`)) return
    try {
      const deletePromises = Array.from(selectedHistoryIds).map(id =>
        apiClient.delete(`/api/coze/parse-history/${id}`)
      )
      const results = await Promise.allSettled(deletePromises)

      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        console.error('部分删除失败:', failed)
        const errorMessages = failed.map(f => {
          const err = f.status === 'rejected' ? f.reason : null
          return err?.response?.data?.error || err?.message || '删除失败'
        })
        setError(`批量删除部分失败: ${errorMessages.join('; ')}`)
      }

      const currentPageIndex = (currentPage - 1) * itemsPerPage
      const remainingOnPage = historyList.length - currentPageIndex
      if (remainingOnPage <= selectedHistoryIds.size && currentPage > 1) {
        setCurrentPage(prev => Math.max(1, prev - 1))
      }

      await loadHistory()
      setSelectedHistoryIds(new Set())
    } catch (err: any) {
      console.error('批量删除历史失败:', err)
      const errorMessage = err?.response?.data?.error || err?.message || '批量删除失败'
      setError(errorMessage)
    }
  }

  const handleAiAssignHistory = async (historyId: string) => {
    setAssigningHistoryId(historyId)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await apiClient.post(`/api/coze/parse-history/${historyId}/ai-assign`, {})
      const payload = response?.data?.data || {}
      const message = payload.message || 'AI分配完成'
      setSuccessMessage(message)
      await loadHistory()
      if (payload.createdNotebookId) {
        onRequestNotebookRefresh?.()
      }
    } catch (err: any) {
      console.error('AI分配笔记失败:', err)
      const errorMessage = err?.response?.data?.error || err?.message || 'AI分配失败'
      setError(errorMessage)
    } finally {
      setAssigningHistoryId(null)
    }
  }

  const handleBatchAssignNotebook = async (notebookId: string, notebookName: string) => {
    if (selectedHistoryIds.size === 0) return
    const count = selectedHistoryIds.size
    try {
      const assignPromises = Array.from(selectedHistoryIds).map(id =>
        apiClient.put(`/api/coze/parse-history/${id}`, {
          assigned_notebook_id: notebookId,
          assigned_notebook_name: notebookName
        })
      )
      await Promise.all(assignPromises)
      await loadHistory()
      setSelectedHistoryIds(new Set())
      setSuccessMessage(`已成功将 ${count} 条记录分配到 ${notebookName}`)
    } catch (err) {
      console.error('批量分配失败:', err)
      setError('批量分配失败')
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const startIndex = (currentPage - 1) * itemsPerPage
      const endIndex = startIndex + itemsPerPage
      const currentPageHistory = historyList.slice(startIndex, endIndex)
      setSelectedHistoryIds(new Set(currentPageHistory.map(h => h.id)))
    } else {
      setSelectedHistoryIds(new Set())
    }
  }

  const openManualMoveDialog = (history: ParseHistory) => {
    setManualMoveHistory(history)
    setManualMoveNotebookId(history.assigned_notebook_id || '')
    setManualMoveError(null)
  }

  const closeManualMoveDialog = () => {
    setManualMoveHistory(null)
    setManualMoveNotebookId('')
    setManualMoveError(null)
  }

  const handleManualMoveSubmit = async () => {
    if (!manualMoveHistory) return
    if (!manualMoveNotebookId) {
      setManualMoveError('请选择要移动到的笔记本')
      return
    }
    const targetNotebook = selectableNotebooks.find(nb => String(nb.notebook_id) === String(manualMoveNotebookId))
    if (!targetNotebook) {
      setManualMoveError('无法找到所选笔记本，请重试')
      return
    }
    setManualMoveLoading(true)
    setManualMoveError(null)
    try {
      await apiClient.put(`/api/coze/parse-history/${manualMoveHistory.id}`, {
        assigned_notebook_id: manualMoveNotebookId,
        assigned_notebook_name: targetNotebook.name
      })
      setSuccessMessage(`已移动到笔记本：${targetNotebook.name}`)
      await loadHistory()
      onRequestNotebookRefresh?.()
      closeManualMoveDialog()
    } catch (err: any) {
      console.error('手动移动笔记失败:', err)
      const errorMessage = err?.response?.data?.error || err?.message || '移动失败，请稍后重试'
      setManualMoveError(errorMessage)
    } finally {
      setManualMoveLoading(false)
    }
  }

  const handleToggleSelect = (historyId: string) => {
    setSelectedHistoryIds(prev => {
      const next = new Set(prev)
      if (next.has(historyId)) {
        next.delete(historyId)
      } else {
        next.add(historyId)
      }
      return next
    })
  }

  const isAllSelected = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentPageHistory = historyList.slice(startIndex, endIndex)
    if (currentPageHistory.length === 0) return false
    return currentPageHistory.every(h => selectedHistoryIds.has(h.id))
  }, [historyList, currentPage, itemsPerPage, selectedHistoryIds])

  const handleHistorySearch = useCallback(() => {
    const trimmed = historySearchInput.trim()
    setCurrentPage(1)
    setHistorySearchQuery(prev => {
      if (prev === trimmed) {
        void loadHistory()
        return prev
      }
      return trimmed
    })
  }, [historySearchInput, loadHistory])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // 外部触发：刷新解析/分配历史（例如工作台存草稿）
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ historyId?: string | null }>
      const historyId = custom?.detail?.historyId ? String(custom.detail.historyId) : null
      setCurrentPage(1)
      void loadHistory()
      if (historyId) {
        setHighlightedHistoryId(historyId)
        setTimeout(() => {
          setHighlightedHistoryId(null)
        }, 3000)
      }
    }
    window.addEventListener(PARSE_HISTORY_EVENTS.refresh, handler as EventListener)
    window.addEventListener(PARSE_HISTORY_EVENTS.created, handler as EventListener)
    window.addEventListener(PARSE_HISTORY_EVENTS.open, openImportHistory as unknown as EventListener)
    return () => {
      window.removeEventListener(PARSE_HISTORY_EVENTS.refresh, handler as EventListener)
      window.removeEventListener(PARSE_HISTORY_EVENTS.created, handler as EventListener)
      window.removeEventListener(PARSE_HISTORY_EVENTS.open, openImportHistory as unknown as EventListener)
    }
  }, [loadHistory, openImportHistory])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedHistoryIds(new Set())
    setRowEditModeHistoryId(null)
  }, [historyFilter])

  useEffect(() => {
    const totalPages = Math.ceil(historyList.length / itemsPerPage)
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [historyList, currentPage, itemsPerPage])

  const renderHistoryContent = () => {
    if (loadingHistory) {
      return <div className="text-center py-8 text-slate-400">加载中...</div>
    }
    if (historyLoadError) {
      return <div className="text-center py-8 text-rose-600">{historyLoadError}</div>
    }
    if (historyList.length === 0) {
      return <div className="text-center py-8 text-slate-400">暂无解析/分配历史</div>
    }

    const totalPages = Math.ceil(historyList.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentPageHistory = historyList.slice(startIndex, endIndex)

    const latestHistory =
      historyList.length > 0
        ? historyList.reduce((latest, current) => {
            const latestTime = new Date(latest.parsed_at).getTime()
            const currentTime = new Date(current.parsed_at).getTime()
            return currentTime > latestTime ? current : latest
          })
        : null

    const statusLabels: Record<HistoryStatus, { label: string; className: string }> = {
      解析中: { label: '解析中', className: 'bg-amber-50 text-amber-700' },
      解析成功: { label: '解析成功', className: 'bg-emerald-50 text-emerald-700' },
      解析失败: { label: '解析失败', className: 'bg-rose-50 text-rose-700' }
    }

    return (
      <>
        <div className="space-y-3">
          {currentPageHistory.map(history => {
            let displayStatus: HistoryStatus = history.status
            if (displayStatus === '解析成功') {
              const allText = [history.parsed_content || '', history.parsed_summary || '', history.parsed_title || '']
                .join(' ')
                .trim()

              if (
                /解析失败[:：]/.test(allText) ||
                /提取失败[:：]/.test(allText) ||
                /处理失败[:：]/.test(allText) ||
                /未成功提取/.test(allText) ||
                /请检查链接是否有效/.test(allText) ||
                /未成功提取文章内容/.test(allText) ||
                /错误[:：]\s*(无法|不能|失败)/.test(allText) ||
                /^(解析|提取|处理)\s*(失败|错误)/.test(allText.trim())
              ) {
                displayStatus = '解析失败'
              }
            }

            const statusInfo = statusLabels[displayStatus] || statusLabels['解析中']
            const normalizedHistoryStatus = normalizeHistoryStatus(history.status)
            const hasAssignedNotebook = !!history.assigned_notebook_id
            const canAiAssign = normalizedHistoryStatus === '解析成功' && !hasAssignedNotebook
            const shouldShowAiAssign = canAiAssign
            const aiAssignDisabledReason =
              normalizedHistoryStatus !== '解析成功'
                ? '解析成功后才能使用AI分配'
                : hasAssignedNotebook
                  ? 'AI 已完成分配，无法再次触发'
                  : ''
            const isAssigningCurrent = assigningHistoryId === history.id
            const aiAssignButtonClass = canAiAssign
              ? 'px-3 py-1.5 text-xs border border-[#b5ece0] text-[#0a917a] rounded bg-white/80 hover:bg-[#eefaf7] transition-colors'
              : 'px-3 py-1.5 text-xs border border-slate-200 text-slate-400 rounded bg-white/50 cursor-not-allowed'
            const aiAssignLabel = isAssigningCurrent ? 'AI分配中…' : 'AI分配'

            const isLatest = latestHistory && history.id === latestHistory.id
            const isHighlighted = highlightedHistoryId === history.id

            const rawSourceType = (history.source_type || '').toLowerCase()
            const normalizedSourceType = rawSourceType
              ? rawSourceType.includes('manual') || rawSourceType.includes('text')
                ? 'manual_text'
                : 'from_url'
              : history.source_url && !history.source_url.startsWith('manual:')
                ? 'from_url'
                : 'manual_text'
            const sourceLabel = normalizedSourceType === 'from_url' ? '链接解析' : '随手记'
            const sourceColor =
              normalizedSourceType === 'from_url'
                ? 'bg-[#d4f3ed] text-[#0a6154]'
                : 'bg-slate-100 text-slate-600'

            const hasSuggestedNotebook = !!history.suggested_notebook_name
            let assignmentStatus: '已分配' | '未分配' | '分配失败' = '未分配'
            let assignmentStatusColor = 'bg-slate-100 text-slate-600'

            if (hasAssignedNotebook) {
              assignmentStatus = '已分配'
              assignmentStatusColor = 'bg-emerald-50 text-emerald-700'
            } else if (hasSuggestedNotebook) {
              assignmentStatus = '分配失败'
              assignmentStatusColor = 'bg-rose-50 text-rose-700'
            }

            const formattedTitle = history.parsed_title ? formatParsedContent(history.parsed_title).trim() : null
            const MAX_HISTORY_TITLE_LENGTH = 40
            const displayHistoryTitle =
              formattedTitle && formattedTitle.length > MAX_HISTORY_TITLE_LENGTH
                ? `${formattedTitle.slice(0, MAX_HISTORY_TITLE_LENGTH)}...`
                : formattedTitle

            const extractFirstNoteId = (noteIds: unknown): string | null => {
              if (!noteIds) return null
              try {
                const parsed = typeof noteIds === 'string' ? JSON.parse(noteIds) : noteIds
                if (Array.isArray(parsed) && parsed.length > 0) {
                  const first = parsed.find(Boolean)
                  return first ? String(first) : null
                }
              } catch {
                // ignore
              }
              return null
            }

            const resolvedNoteId = extractFirstNoteId(history.note_ids)
            const isNavigable = Boolean(
              history.assigned_notebook_id &&
                resolvedNoteId &&
                normalizeHistoryStatus(history.status) === '解析成功'
            )

            return (
              <div
                key={history.id}
                className={`border rounded-lg p-3 transition-all duration-300 ${
                  isHighlighted
                    ? 'border-[#90e2d0] bg-white/90 shadow-sm ring-1 ring-[#b5ece0]'
                    : isLatest
                      ? 'border-slate-200/70 bg-white/90'
                      : selectedHistoryIds.has(history.id)
                        ? 'border-[#90e2d0] bg-white/90'
                        : 'border-slate-200/60 bg-white/70 hover:bg-white/90'
                } ${isNavigable ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={(event) => {
                  if (!isNavigable) return
                  const target = event.target as HTMLElement | null
                  if (!target) return
                  if (target.closest('button, input, select, textarea, a, [role="menuitem"]')) return
                  const notebookId = String(history.assigned_notebook_id || '').trim()
                  if (!notebookId || !resolvedNoteId) return
                  navigate(`/notes/${encodeURIComponent(notebookId)}?highlightNoteId=${encodeURIComponent(resolvedNoteId)}`)
                }}
                title={isNavigable ? '跳转到对应笔记' : undefined}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedHistoryIds.has(history.id)}
                      onChange={() => handleToggleSelect(history.id)}
                      className="mt-1 w-4 h-4 text-[#06c3a8] border-slate-300 rounded focus:ring-[#b5ece0]"
                    />
                    <div className="flex-1 min-w-0">
                      {displayHistoryTitle && (
                        <div className="text-[13px] font-semibold text-slate-900 mb-2">
                          {displayHistoryTitle}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <span className={`px-1.5 py-0.5 text-[11px] rounded whitespace-nowrap ${sourceColor}`}>
                          {sourceLabel}
                        </span>
                        {isLatest && (
                          <span className="px-1.5 py-0.5 text-[11px] rounded whitespace-nowrap bg-[#b5ece0] text-[#084338] font-medium">
                            最新
                          </span>
                        )}
                        <span className={`px-1.5 py-0.5 text-[11px] rounded whitespace-nowrap ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[11px] rounded whitespace-nowrap ${assignmentStatusColor}`}>
                          {assignmentStatus}
                        </span>
                      </div>

                      {(history.parsed_note_type || history.assigned_notebook_name) && (
                        <div className="text-[12px] text-slate-600 mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                          {history.parsed_note_type && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium">AI分类:</span>
                              <span className="text-slate-700">{history.parsed_note_type}</span>
                            </span>
                          )}
                          {history.assigned_notebook_name && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium">已分配到:</span>
                              <span className="text-slate-700">{history.assigned_notebook_name}</span>
                            </span>
                          )}
                        </div>
                      )}

                      <div className="text-[11px] text-slate-500">
                        解析时间：{new Date(history.parsed_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {shouldShowAiAssign && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canAiAssign) void handleAiAssignHistory(history.id)
                        }}
                        className={aiAssignButtonClass}
                        disabled={!canAiAssign || isAssigningCurrent}
                        title={
                          canAiAssign
                            ? 'AI将分配到合适的归属笔记本'
                            : aiAssignDisabledReason || '暂不可用'
                        }
                      >
                        {aiAssignLabel}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openManualMoveDialog(history)
                      }}
                      className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded bg-white/70 hover:bg-white transition-colors"
                      title="手动选择目标笔记本并移动笔记"
                      disabled={!selectableNotebooks.length}
                    >
                      移动
                    </button>
                    {rowEditModeHistoryId === history.id ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRowEditModeHistoryId(null)
                          }}
                          className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded bg-white/70 hover:bg-white transition-colors"
                          title="取消"
                        >
                          取消
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            await handleDeleteHistory(history.id)
                            setRowEditModeHistoryId(null)
                          }}
                          className="px-3 py-1.5 text-xs border border-rose-200 text-rose-600 rounded bg-white/70 hover:bg-rose-50 transition-colors"
                          title="删除"
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleEditHistory(history.id)
                          }}
                          className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded bg-white/70 hover:bg-white transition-colors"
                          title="查看"
                        >
                          查看
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRowEditModeHistoryId(history.id)
                          }}
                          className="px-3 py-1.5 text-xs border border-slate-200 text-slate-600 rounded bg-white/70 hover:bg-white transition-colors"
                          title="编辑"
                        >
                          编辑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {Math.ceil(historyList.length / itemsPerPage) > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <div className="text-sm text-slate-600">
              共 {historyList.length} 条，第 {currentPage} / {Math.ceil(historyList.length / itemsPerPage)} 页
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                  if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-3 py-1.5 text-sm border rounded-lg transition-colors ${
                          currentPage === page
                            ? 'bg-[#06c3a8] text-white border-[#06c3a8] shadow-sm'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  } else if (page === currentPage - 2 || page === currentPage + 2) {
                    return (
                      <span key={page} className="px-2 text-slate-400">
                        ...
                      </span>
                    )
                  }
                  return null
                })}
              </div>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-600">
            {successMessage}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white/70 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200/60">
          <button
            type="button"
            onClick={toggleImportHistoryOpen}
            className="flex items-center gap-2 text-left"
            aria-expanded={importHistoryOpen}
            aria-controls="ai-import-history-panel"
          >
            <h2 className="text-base font-semibold text-slate-800">解析/分配历史</h2>
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/70 text-slate-500 border border-slate-200 transition-transform duration-200 ${
                importHistoryOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {!importHistoryOpen && (
              <span className="text-[12px] text-slate-500">
                {loadingHistory ? '加载中…' : historyList.length ? `共 ${historyList.length} 条` : '暂无解析/分配历史'}
              </span>
            )}
          </button>

          {importHistoryOpen && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 shadow-sm text-xs text-slate-600">
                <input
                  type="text"
                  value={historySearchInput}
                  onChange={e => setHistorySearchInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleHistorySearch()
                    }
                  }}
                  placeholder="搜索解析/分配历史..."
                  className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleHistorySearch}
                  disabled={loadingHistory}
                  className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#06c3a8] text-white shadow hover:brightness-110 disabled:opacity-60"
                  title="搜索解析/分配历史"
                >
                  <SearchHistoryIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              {historyList.length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={e => handleSelectAll(e.target.checked)}
                    className="w-4 h-4 text-[#06c3a8] border-slate-300 rounded focus:ring-[#b5ece0]"
                  />
                  <span className="text-sm text-slate-700">全选</span>
                </label>
              )}
              <select
                value={historyFilter}
                onChange={e => setHistoryFilter(e.target.value as HistoryFilter)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#b5ece0]"
              >
                <option value="all">全部</option>
                <option value="解析中">解析中</option>
                <option value="解析成功">解析成功</option>
                <option value="解析失败">解析失败</option>
              </select>
            </div>
          )}
        </div>

        <div id="ai-import-history-panel" className="p-4 space-y-4">
          {!importHistoryOpen && (
            <div className="text-sm text-slate-500">历史已折叠，点击上方展开查看解析记录与批量操作。</div>
          )}

          {importHistoryOpen && (
            <>
              {historyList.length > 0 && selectedHistoryIds.size > 0 && (
                <div className="flex items-center justify-end p-3 bg-white/60 rounded-lg border border-slate-200/60">
                  <span className="text-sm text-slate-600 mr-3">已选择 {selectedHistoryIds.size} 项</span>
                  <div className="flex items-center gap-2">
                    <select
                      onChange={e => {
                        const value = e.target.value
                        if (value) {
                          const [notebookId, notebookName] = value.split('|')
                          handleBatchAssignNotebook(notebookId, notebookName)
                          e.target.value = ''
                        }
                      }}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 bg-white/70 focus:border-[#43ccb0] focus:outline-none focus:ring-2 focus:ring-[#b5ece0]"
                      defaultValue=""
                    >
                      <option value="">批量分配到...</option>
                      {availableNotebooks
                        .filter(nb => !!nb.notebook_id)
                        .map(nb => (
                          <option key={nb.notebook_id as string} value={`${nb.notebook_id}|${nb.name}`}>
                            {nb.name}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={handleBatchDeleteHistory}
                      className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 bg-white/70 transition-colors hover:bg-rose-50"
                    >
                      批量删除
                    </button>
                  </div>
                </div>
              )}

              <div className="w-full">{renderHistoryContent()}</div>
            </>
          )}
        </div>
      </div>

      {manualMoveHistory && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">手动移动笔记</h3>
            <p className="text-sm text-slate-500 mb-4">请选择一个目标笔记本。</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">当前笔记本</label>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {manualMoveHistory?.assigned_notebook_name || '未分配'}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">目标笔记本</label>
                <select
                  value={manualMoveNotebookId}
                  onChange={e => {
                    setManualMoveNotebookId(e.target.value)
                    if (manualMoveError) setManualMoveError(null)
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#43ccb0] focus:outline-none focus:ring-2 focus:ring-[#b5ece0]"
                  disabled={manualMoveLoading}
                >
                  <option value="">请选择笔记本</option>
                  {selectableNotebooks.map(notebook => (
                    <option key={notebook.notebook_id} value={notebook.notebook_id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
              </div>
              {manualMoveError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  {manualMoveError}
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={closeManualMoveDialog}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                disabled={manualMoveLoading}
              >
                取消
              </button>
              <button
                onClick={handleManualMoveSubmit}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:cursor-not-allowed disabled:bg-indigo-300"
                disabled={manualMoveLoading}
              >
                {manualMoveLoading ? '移动中…' : '确认移动'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ParseHistoryEditModal
        history={editingHistory}
        notebooks={availableNotebooks}
        isOpen={!!editingHistory}
        linkAiPrompt={linkPrompt || DEFAULT_AI_SUMMARY_PROMPT}
        textAiPrompt={textPrompt || DEFAULT_AI_SUMMARY_PROMPT}
        onUpdateLinkPrompt={updateParseSettingsPrompt}
        onUpdateTextPrompt={updateTextPrompt}
        onClose={() => setEditingHistory(null)}
        onSave={() => {
          loadHistory()
          setEditingHistory(null)
        }}
      />
    </>
  )
}
