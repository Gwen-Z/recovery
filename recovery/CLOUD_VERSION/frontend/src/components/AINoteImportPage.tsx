import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import apiClient from '../apiClient'
import ParseHistoryEditModal from './ParseHistoryEditModal'
import ImageViewer from './ImageViewer'
import { HistoryStatus, normalizeHistoryStatus } from '../utils/parseHistoryStatus'

type NotebookOption = {
  notebook_id: string | null
  name: string
  description?: string | null
  note_count?: number
  created_at?: string | null
  updated_at?: string | null
}

type DraftStatus = 'pending' | 'saving' | 'saved' | 'error'

type DraftState = {
  id: string
  title: string
  summary: string
  content: string
  topics: string[]
  confidence: number
  suggestedNotebookId: string | null
  suggestedNotebookName: string | null
  suggestedNewNotebook: {
    name: string | null;
    description: string | null;
    reason: string;
  } | null
  explanation: string | null
  targetNotebookId: string | null
  status: DraftStatus
  errorMessage: string | null
  structuredFields: Record<string, any>
  historyId: string | null
  sourceUrl: string | null
}

type ImportMetadata = {
  usedFallback?: boolean
  reason?: string
  rawResult?: any
}

type ParseSettings = {
  linkAiSummaryEnabled: boolean
  textAiSummaryEnabled: boolean
  aiSummaryPrompt: string
  syncToNotebookTemplate: boolean
}

const PARSE_SETTINGS_STORAGE_KEY = 'ai_parse_settings_v1'
const TEXT_PROMPT_STORAGE_KEY = 'ai_parse_text_prompt_v1'
const DEFAULT_AI_SUMMARY_PROMPT =
  '请将内容整理为不超过5条的要点，突出文章核心信息，使用简洁的中文有序列表输出。'

const loadInitialParseSettings = (): ParseSettings => {
  const fallback: ParseSettings = {
    linkAiSummaryEnabled: true,
    textAiSummaryEnabled: true,
    aiSummaryPrompt: DEFAULT_AI_SUMMARY_PROMPT,
    syncToNotebookTemplate: true
  }
  if (typeof window === 'undefined') return fallback
  try {
    const stored = window.localStorage.getItem(PARSE_SETTINGS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        linkAiSummaryEnabled: (() => {
          const legacy = parsed?.aiSummaryEnabled
          const value =
            parsed?.linkAiSummaryEnabled === undefined ? legacy : parsed.linkAiSummaryEnabled
          return value === undefined ? true : !!value
        })(),
        textAiSummaryEnabled: (() => {
          const legacy = parsed?.aiSummaryEnabled
          const value =
            parsed?.textAiSummaryEnabled === undefined ? legacy : parsed.textAiSummaryEnabled
          return value === undefined ? true : !!value
        })(),
        aiSummaryPrompt:
          typeof parsed?.aiSummaryPrompt === 'string' && parsed.aiSummaryPrompt.trim()
            ? parsed.aiSummaryPrompt
            : DEFAULT_AI_SUMMARY_PROMPT,
        syncToNotebookTemplate:
          parsed?.syncToNotebookTemplate === undefined
            ? true
            : !!parsed.syncToNotebookTemplate
      }
    }
  } catch (error) {
    console.warn('无法加载解析设置，使用默认值', error)
  }
  return fallback
}

interface AINoteImportPageProps {
  notebooks: NotebookOption[]
  onNotebookListChange?: (list: NotebookOption[]) => void
  onRequestNotebookRefresh?: () => void
}

const confidenceLabel = (value: number) => {
  if (value >= 0.85) return '高'
  if (value >= 0.55) return '中'
  return '低'
}

const deriveTitleFromContent = (text: string) => {
  if (!text) return '未命名草稿'
  const firstLine = text.split('\n').map(line => line.trim()).find(line => line.length > 0)
  return firstLine ? firstLine.slice(0, 60) : '未命名草稿'
}

const parseKeywords = (tags?: string | null) => {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    if (Array.isArray(parsed)) {
      return parsed.map(item => (typeof item === 'string' ? item.trim() : String(item))).filter(Boolean)
    }
  } catch {
    /* ignore parse error */
  }
  return []
}

// 格式化解析的内容，清理JSON格式和转义字符
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
            const value = cleaned.substring(valueStart + 1, valueEnd)
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
          const incompleteValue = cleaned.substring(valueStart + 1)
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
      const longestValue = extractedValues.reduce((a, b) => a.length > b.length ? a : b)
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
            return Object.keys(val).length > 0 && Object.values(val).some((v: any) => {
              if (Array.isArray(v)) return v.length > 0
              if (typeof v === 'string') return v.trim().length > 0
              return !!v && v !== null && v !== undefined
            })
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
        const isContained = jsonBlocks.some(block => 
          jsonMatch!.index >= block.start && jsonMatch!.index < block.end
        )
        if (!isContained) {
          // 检查这个JSON对象是否在文本中的独立位置（前后都是空白或换行）
          const before = cleaned.slice(Math.max(0, jsonMatch.index - 50), jsonMatch.index)
          const after = cleaned.slice(jsonMatch.index + jsonMatch[0].length, jsonMatch.index + jsonMatch[0].length + 50)
          const isStandalone = (jsonMatch.index === 0 || /^\s*$/.test(before)) && 
                                (jsonMatch.index + jsonMatch[0].length === cleaned.length || /^\s*$/.test(after))
          
          // 只有在不是整个内容且是独立JSON对象时才标记为需要移除
          // 如果这个JSON对象就是整个内容（且在前面的检查中已经确认有内容），则保留
          if (!isStandalone || jsonMatch.index !== 0 || jsonMatch.index + jsonMatch[0].length !== cleaned.length) {
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
  cleaned = cleaned.replace(/标题[：:]\s*\{[^}]*\}/g, (match) => {
    // 尝试提取标题内容
    const contentMatch = match.match(/标题[：:]\s*\{(.+?)\}/)
    if (contentMatch && contentMatch[1]) {
      return `标题：${contentMatch[1].trim()}`
    }
    return match.replace(/\{.*?\}/, '')
  })
  
  // 6. 移除其他字段中的 JSON 残留
  cleaned = cleaned.replace(/来源[：:]\s*\{[^}]*\}/g, (match) => {
    const contentMatch = match.match(/来源[：:]\s*\{(.+?)\}/)
    if (contentMatch && contentMatch[1]) {
      return `来源：${contentMatch[1].trim()}`
    }
    return match.replace(/\{.*?\}/, '')
  })
  
  // 7. 处理混合格式，如 "标题：{来源：xxx / xxx}"
  cleaned = cleaned.replace(/(标题|来源|作者|发布时间|摘要)[：:]\s*\{([^}]+)\}/g, (match, field, content) => {
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
  })
  
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
  cleaned = cleaned.split('\n').map(line => {
    // 如果行以不完整的JSON键值对结尾，移除它
    // 匹配模式：...", "key 或 ...", "key": 或 ...", "key": "
    line = line.replace(/,\s*"[^"]*$/, '') // 移除末尾不完整的键
    line = line.replace(/,\s*"[^"]*":\s*$/, '') // 移除末尾只有键的结构
    line = line.replace(/,\s*"[^"]*":\s*"[^"]*$/, '') // 移除末尾不完整的键值对
    return line
  }).join('\n')
  
  return cleaned.trim()
}

interface ParseHistory {
  id: string;
  source_url: string;
  parsed_content: string;
  parsed_title?: string | null;
  parsed_summary?: string | null;
  parsed_author?: string | null;
  parsed_source?: string | null;
  parsed_platform?: string | null;
  parsed_published_at?: string | null;
  parsed_img_urls?: string[] | null;
  parsed_note_type?: string | null;
  suggested_notebook_id?: string | null;
  suggested_notebook_name?: string | null;
  suggested_new_notebook?: {
    name: string | null;
    description: string | null;
    reason: string;
  } | null;
  assigned_notebook_id?: string | null;
  assigned_notebook_name?: string | null;
  source_type?: string | null;
  status: HistoryStatus;
  notes?: string | null;
  tags?: string | null;
  keywords?: string[] | null;
  parsed_at: string;
}

type HistoryFilter = 'all' | HistoryStatus;

// 按北京时间格式化时间字符串为 YYYY-MM-DD HH:mm
const formatBeijingDateTime = (value: string | null | undefined) => {
  if (!value) return '';

  // 先尝试用 Date 解析（支持带 T 的 ISO 字符串）
  try {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hour = pad(date.getHours());
      const minute = pad(date.getMinutes());
      return `${year}-${month}-${day} ${hour}:${minute}`;
    }
  } catch {
    // ignore and fallback
  }

  // 如果无法解析，就做一个简单的兜底：把 T 替换成空格
  return String(value).replace('T', ' ');
};

const formatHistoryContent = (history: ParseHistory) => {
  const lines: string[] = []
  
  // 对标题进行格式化处理，清理可能的 JSON 格式
  let formattedTitle = history.parsed_title
  if (formattedTitle) {
    formattedTitle = formatParsedContent(formattedTitle).trim()
    if (formattedTitle) {
      lines.push(`标题：${formattedTitle}`)
    }
  }
  
  if (history.parsed_platform) lines.push(`来源平台：${history.parsed_platform}`)
  if (history.parsed_author) lines.push(`作者：${history.parsed_author}`)
  if (history.parsed_published_at) {
    const formatted = formatBeijingDateTime(history.parsed_published_at);
    lines.push(`创建时间：${formatted}`)
  }
  if (history.parsed_note_type) lines.push(`笔记类型：${history.parsed_note_type}`)
  if (history.parsed_img_urls && Array.isArray(history.parsed_img_urls) && history.parsed_img_urls.length > 0) {
    lines.push(`图片URLs：${history.parsed_img_urls.join('、')}`)
  }
  const keywords = history.keywords && history.keywords.length ? history.keywords : parseKeywords(history.tags)
  if (keywords.length) lines.push(`关键词：${keywords.join('、')}`)
  
  // 对摘要进行格式化处理，清理可能的 JSON 格式
  let formattedSummary = history.parsed_summary
  if (formattedSummary) {
    formattedSummary = formatParsedContent(formattedSummary).trim()
    if (formattedSummary) {
      lines.push(`摘要：${formattedSummary}`)
    }
  }
  
  if (lines.length) lines.push('')
  
  // 格式化内容，清理JSON格式和转义字符
  let rawContent = history.parsed_content || '';
  // 过滤掉占位符文本
  if (rawContent === '解析中或解析失败，请稍后查看结果') {
    rawContent = '';
  }
  const formattedContent = formatParsedContent(rawContent);
  lines.push(formattedContent)
  
  return lines.join('\n')
}

export default function AINoteImportPage({
  notebooks,
  onNotebookListChange,
  onRequestNotebookRefresh
}: AINoteImportPageProps) {
  const [parseSettings, setParseSettings] = useState<ParseSettings>(() => loadInitialParseSettings())
  // 从 localStorage 恢复文本框内容（如果存在草稿）
  const [sourceText, setSourceText] = useState(() => {
    try {
      const draft = localStorage.getItem('note_textarea_draft')
      return draft || ''
    } catch {
      return ''
    }
  })
  const [articleUrl, setArticleUrl] = useState('')
  const [checkingUrl, setCheckingUrl] = useState(false)
  const [checkingTarget, setCheckingTarget] = useState<'input' | 'parseOnly' | 'parseAssign' | null>(null)
  const [parseOnlyLoading, setParseOnlyLoading] = useState(false)
  const [parseAssignLoading, setParseAssignLoading] = useState(false)
  const [urlExists, setUrlExists] = useState(false)
  const [existingHistoryId, setExistingHistoryId] = useState<string | null>(null)
  const [availableNotebooks, setAvailableNotebooks] = useState<NotebookOption[]>(notebooks)
  const [drafts, setDrafts] = useState<DraftState[]>([])
  const [loading, setLoading] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [pastedImages, setPastedImages] = useState<string[]>([])
  const [imageViewerOpen, setImageViewerOpen] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [metadata, setMetadata] = useState<ImportMetadata | null>(null)
  const [historyList, setHistoryList] = useState<ParseHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null)
  const [editingHistory, setEditingHistory] = useState<ParseHistory | null>(null)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const [parsedContext, setParsedContext] = useState<{
    fields: Record<string, any>
    historyId: string | null
    sourceUrl: string | null
  } | null>(null)
  const [highlightedHistoryId, setHighlightedHistoryId] = useState<string | null>(null)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set())
  const [assigningHistoryId, setAssigningHistoryId] = useState<string | null>(null)
  const [manualMoveHistory, setManualMoveHistory] = useState<ParseHistory | null>(null)
  const [manualMoveNotebookId, setManualMoveNotebookId] = useState<string>('')
  const [manualMoveLoading, setManualMoveLoading] = useState(false)
  const [manualMoveError, setManualMoveError] = useState<string | null>(null)
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [showLinkPromptDetails, setShowLinkPromptDetails] = useState(false)
  const [showTextPromptDetails, setShowTextPromptDetails] = useState(false)
  const [isEditingLinkPrompt, setIsEditingLinkPrompt] = useState(false)
  const [isEditingTextPrompt, setIsEditingTextPrompt] = useState(false)
  const [textPrompt, setTextPrompt] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_AI_SUMMARY_PROMPT
    try {
      const stored = window.localStorage.getItem(TEXT_PROMPT_STORAGE_KEY)
      return stored && stored.trim() ? stored : DEFAULT_AI_SUMMARY_PROMPT
    } catch {
      return DEFAULT_AI_SUMMARY_PROMPT
    }
  })
  const [linkPromptDraft, setLinkPromptDraft] = useState(parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT)
  const [textPromptDraft, setTextPromptDraft] = useState(textPrompt)

  const updateParseSettings = useCallback((updates: Partial<ParseSettings>) => {
    setParseSettings(prev => {
      const next = { ...prev, ...updates }
      try {
        window.localStorage.setItem(PARSE_SETTINGS_STORAGE_KEY, JSON.stringify(next))
      } catch (error) {
        console.warn('无法保存解析设置', error)
      }
      return next
    })
  }, [])

  const buildLinkAiSummaryPayload = useCallback(() => ({
    enabled: parseSettings.linkAiSummaryEnabled,
    prompt: parseSettings.aiSummaryPrompt.trim() || DEFAULT_AI_SUMMARY_PROMPT,
    syncToNotebookTemplate: parseSettings.syncToNotebookTemplate
  }), [parseSettings])

  const buildTextAiSummaryPayload = useCallback(() => ({
    enabled: parseSettings.textAiSummaryEnabled,
    prompt: textPrompt.trim() || DEFAULT_AI_SUMMARY_PROMPT,
    syncToNotebookTemplate: parseSettings.syncToNotebookTemplate
  }), [parseSettings, textPrompt])

  useEffect(() => {
    if (!isEditingLinkPrompt) {
      setLinkPromptDraft(parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT)
    }
  }, [parseSettings.aiSummaryPrompt, isEditingLinkPrompt])

  useEffect(() => {
    if (!isEditingTextPrompt) {
      setTextPromptDraft(textPrompt)
    }
  }, [textPrompt, isEditingTextPrompt])

  const extractImageUrlsFromHtml = useCallback((html: string) => {
    if (!html) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const imgs = Array.from(doc.querySelectorAll('img'))
    return imgs
      .map(img => (img.getAttribute('src') || '').trim())
      .filter(Boolean)
  }, [])

  // 辅助函数：将 File 对象转换为 base64 data URL（持久化保存）
  const fileToDataURL = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }, [])

  const handlePasteImages = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || [])
    const files = Array.from(event.clipboardData?.files || [])

    const imageFiles: File[] = []
    const processedFiles = new Set<string>() // 用于去重：存储已处理的文件名+大小组合

    // 先获取当前文本框的值，确保不会丢失已有内容
    const textarea = sourceTextareaRef.current
    // 直接从 DOM 获取当前值，这是最准确的
    const currentTextValue = textarea?.value || ''
    
    console.log('📋 [粘贴事件] 当前文本框内容长度:', currentTextValue.length, '字符')

    // 1) 优先从 items 中提取图片（更准确）
    items.forEach(item => {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          const fileKey = `${file.name}_${file.size}_${file.type}`
          if (!processedFiles.has(fileKey)) {
            processedFiles.add(fileKey)
            imageFiles.push(file)
          }
        }
      }
    })
    
    // 2) 从 files 中提取图片，但要去重（避免与 items 重复）
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const fileKey = `${file.name}_${file.size}_${file.type}`
        if (!processedFiles.has(fileKey)) {
          processedFiles.add(fileKey)
          imageFiles.push(file)
        }
      }
    })

    // 3) 来自 HTML 里的 <img src="...">
    const html = event.clipboardData?.getData('text/html') || ''
    const htmlImgUrls = extractImageUrlsFromHtml(html)

    // 4) 纯文本（保留到文本框）
    const text = event.clipboardData?.getData('text/plain') || ''
    const hasText = text.trim().length > 0
    const hasImages = imageFiles.length > 0 || htmlImgUrls.length > 0

    // 如果同时有文本和图片，或者只有文本，需要处理文本插入
    if (hasText) {
      event.preventDefault() // 阻止默认粘贴行为，手动处理文本插入
      
      if (textarea) {
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        // 使用当前文本框的值，确保保留已有内容
        const currentValue = textarea.value
        const newValue = currentValue.slice(0, start) + text + currentValue.slice(end)
        setSourceText(newValue)
        
        // 恢复光标位置到插入文本的末尾
        requestAnimationFrame(() => {
          if (textarea) {
            textarea.focus()
            const newCursorPos = start + text.length
            textarea.setSelectionRange(newCursorPos, newCursorPos)
          }
        })
      } else {
        // 如果没有 ref，使用函数式更新确保保留已有内容
        setSourceText(prev => {
          const prefix = prev && !prev.endsWith('\n') ? `${prev}\n` : prev
          return `${prefix || ''}${text}`
        })
      }
    } else if (hasImages) {
      // 只有图片，没有文本：阻止默认行为，但保留文本框的现有内容
      console.log('📋 [粘贴事件] 检测到图片，当前文本框内容:', currentTextValue.length, '字符')
      event.preventDefault()
      // 确保文本框的当前内容被保存到 state（防止内容丢失）
      if (textarea) {
        // 从 DOM 直接读取当前值，确保获取最新内容
        // 使用函数式更新，避免闭包问题
        const domValue = textarea.value || ''
        console.log('📋 [粘贴事件] DOM 中的文本框内容长度:', domValue.length, '字符')
        
        setSourceText(prev => {
          // 如果 DOM 值不同于 state，使用 DOM 值（DOM 值是最新的）
          const newValue = domValue !== prev ? domValue : prev
          if (newValue !== prev) {
            console.log('📋 [粘贴事件] 更新文本框 state，新长度:', newValue.length, '字符')
          }
          return newValue
        })
      }
    }

    // 处理图片添加：将 File 对象转换为 base64 data URL（持久化保存）
    if (hasImages) {
      const imageUrls: string[] = []
      
      // 转换本地图片文件为 base64 data URL
      if (imageFiles.length > 0) {
        console.log('📋 [粘贴事件] 开始转换图片为 base64，数量:', imageFiles.length)
        try {
          const dataUrls = await Promise.all(imageFiles.map(file => fileToDataURL(file)))
          imageUrls.push(...dataUrls)
          console.log('📋 [粘贴事件] 图片转换完成，base64 URL 数量:', dataUrls.length)
        } catch (error) {
          console.error('📋 [粘贴事件] 图片转换失败:', error)
        }
      }
      
      // 添加 HTML 中的图片 URL（这些可能是外部 URL，保持不变）
      if (htmlImgUrls.length > 0) {
        imageUrls.push(...htmlImgUrls)
        console.log('📋 [粘贴事件] 从 HTML 提取图片 URL:', htmlImgUrls.length, '张')
      }
      
      // 去重后追加
      if (imageUrls.length > 0) {
        setPastedImages(prev => {
          const existing = new Set(prev)
          const toAdd = imageUrls.filter(url => !existing.has(url))
          if (toAdd.length > 0) {
            console.log('📋 [粘贴事件] 添加新图片:', toAdd.length, '张（base64 data URL，可持久化保存）')
          }
          return [...prev, ...toAdd]
        })
      }
    }

    // 如果既没有文本也没有图片，不阻止默认行为，让浏览器正常处理
    if (!hasText && !hasImages) {
      console.log('📋 [粘贴事件] 无文本无图片，不阻止默认行为')
      return
    }
  }, [extractImageUrlsFromHtml, fileToDataURL])

  const handleRemovePastedImage = useCallback((index: number) => {
    setPastedImages(prev => {
      const next = prev.filter((_, i) => i !== index)
      // 注意：base64 data URL 不需要手动清理，浏览器会自动处理
      // 如果之前有 blob URL，可以在这里清理（但现在都使用 base64 了）
      const removed = prev[index]
      if (removed && removed.startsWith('blob:')) {
        URL.revokeObjectURL(removed)
      }
      return next
    })
  }, [])

  // 自动保存文本框内容到 localStorage，防止意外丢失
  useEffect(() => {
    try {
      if (sourceText.trim()) {
        localStorage.setItem('note_textarea_draft', sourceText)
      } else {
        // 如果文本框为空，清除草稿
        localStorage.removeItem('note_textarea_draft')
      }
    } catch (error) {
      console.warn('保存文本框草稿失败:', error)
    }
  }, [sourceText])

  // 自动保存粘贴的图片到 localStorage
  useEffect(() => {
    try {
      if (pastedImages.length > 0) {
        // 将 blob URLs 转换为 data URLs 以便持久化存储
        // 注意：这里只保存数量，实际图片数据在内存中
        localStorage.setItem('note_pasted_images_count', pastedImages.length.toString())
      } else {
        localStorage.removeItem('note_pasted_images_count')
      }
    } catch (error) {
      console.warn('保存图片草稿失败:', error)
    }
  }, [pastedImages])

  useEffect(() => {
    setAvailableNotebooks(notebooks)
  }, [notebooks])

  const totalChars = useMemo(() => sourceText.trim().length, [sourceText])
  const canGenerate = useMemo(() => totalChars > 0 && !loading, [totalChars, loading])

  const updateDraft = (draftId: string, updater: (draft: DraftState) => DraftState) => {
    setDrafts(prev =>
      prev.map(draft => {
        if (draft.id !== draftId) return draft
        const next = updater(draft)
        if (draft.status === 'saved' && next.status === draft.status) {
          return { ...next, status: 'pending' }
        }
        return next
      })
    )
  }

  const generateDraftsFromSource = async () => {
    if (!canGenerate) {
      return { drafts: [] as DraftState[], defaultNotebookId: null as string | null }
    }
    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const response = await apiClient.post('/api/ai/import-notes', { text: sourceText.trim() })
      const payload = response?.data?.data || {}
      const draftsFromApi = Array.isArray(payload.drafts) ? payload.drafts : []
      const notebooksFromApi = Array.isArray(payload.notebooks) ? payload.notebooks : []

      setMetadata(payload.metadata || null)
      const nextNotebooks = notebooksFromApi.length ? notebooksFromApi : notebooks
      setAvailableNotebooks(nextNotebooks)
      onNotebookListChange?.(nextNotebooks)

      const defaultNotebookId =
        (draftsFromApi[0]?.suggestedNotebookId && String(draftsFromApi[0].suggestedNotebookId)) ||
        (nextNotebooks[0]?.notebook_id ?? availableNotebooks[0]?.notebook_id ?? null)

      const normalizedDrafts: DraftState[] = draftsFromApi.map((draft: any, index: number) => {
        const suggestedId = draft?.suggestedNotebookId ? String(draft.suggestedNotebookId) : null
        const fallbackNotebookId = suggestedId || defaultNotebookId || null
        const topics = Array.isArray(draft?.topics)
          ? draft.topics.map((tag: any) => String(tag || '').trim()).filter(Boolean)
          : []

        const confidence = typeof draft?.confidence === 'number' ? draft.confidence : 0.6

        const rawContent = String(draft?.content || draft?.body || draft?.text || '').trim()
        const summaryText = String(draft?.summary || '').trim()
        const contentText = rawContent || summaryText || sourceText.trim()
        const providedTitle = String(draft?.title || '').trim()
        const titleText = providedTitle || deriveTitleFromContent(contentText)
        const explanationText = draft?.explanation ? String(draft.explanation).trim() : null
        const suggestedName =
          draft?.suggestedNotebookName ||
          draft?.notebookName ||
          (suggestedId && nextNotebooks.find((nb: NotebookOption) => nb.notebook_id === suggestedId)?.name) ||
          null

        // 提取新建笔记本建议
        const suggestedNewNotebook = draft?.suggestedNewNotebook || 
                                     draft?.suggested_new_notebook || 
                                     (parsedContext && 'suggestedNewNotebook' in parsedContext ? (parsedContext as any).suggestedNewNotebook : null) || 
          null

        return {
          id: String(draft?.id || `draft_${Date.now()}_${index}`),
          title: titleText,
          summary: summaryText,
          content: contentText,
          topics,
          confidence: confidence > 1 ? Math.min(1, confidence / 100) : Math.max(0, Math.min(1, confidence)),
          suggestedNotebookId: fallbackNotebookId,
          suggestedNotebookName: suggestedName,
          suggestedNewNotebook: suggestedNewNotebook,
          explanation: explanationText,
          targetNotebookId: fallbackNotebookId,
          status: 'pending',
          errorMessage: null,
          structuredFields: parsedContext?.fields ? { ...parsedContext.fields } : {},
          historyId: parsedContext?.historyId || null,
          sourceUrl: parsedContext?.sourceUrl || null
        }
      })

      return { drafts: normalizedDrafts, defaultNotebookId }
    } catch (err: any) {
      console.error('生成AI草稿失败:', err)
      setError(err?.response?.data?.message || err?.message || '生成草稿失败')
      return { drafts: [], defaultNotebookId: null }
    } finally {
      setLoading(false)
    }

    return { drafts: [], defaultNotebookId: null }
  }

  const handleGenerateDrafts = async () => {
    if (!canGenerate) return
    const { drafts, defaultNotebookId } = await generateDraftsFromSource()
    if (!drafts.length) return

    const fallbackNotebookId =
      defaultNotebookId ||
      availableNotebooks[0]?.notebook_id ||
      null

    const preparedDrafts = drafts.map(draft => ({
      ...draft,
      targetNotebookId: draft.targetNotebookId || draft.suggestedNotebookId || fallbackNotebookId
    }))

    setDrafts(preparedDrafts)
    setSuccessMessage(`已生成 ${preparedDrafts.length} 个草稿，请确认后保存。`)
  }

  const handleSaveRawDraft = () => {
    if (!sourceText.trim()) {
      setError('请先输入或解析内容，再保存草稿')
      setSuccessMessage(null)
      return
    }
    setError(null)
    const fallbackNotebookId = availableNotebooks[0]?.notebook_id || null
    const manualDraft: DraftState = {
      id: `manual_${Date.now()}`,
      title: deriveTitleFromContent(sourceText),
      summary: '',
      content: sourceText.trim(),
      topics: [],
      confidence: 0.5,
      suggestedNotebookId: fallbackNotebookId,
      suggestedNotebookName: availableNotebooks.find((nb: NotebookOption) => nb.notebook_id === fallbackNotebookId)?.name || null,
      suggestedNewNotebook: null,
      explanation: '手动保存原始草稿',
      targetNotebookId: fallbackNotebookId,
      status: 'pending',
      errorMessage: null,
      structuredFields: parsedContext?.fields ? { ...parsedContext.fields } : {},
      historyId: parsedContext?.historyId || null,
      sourceUrl: parsedContext?.sourceUrl || null
    }
    setDrafts(prev => [manualDraft, ...prev])
    setSuccessMessage('已保存当前内容为草稿，可继续编辑或选择目标笔记本后保存。')
  }

  const handleGenerateAndSave = async () => {
    if (!canGenerate) return
    setSuccessMessage(null)
    setError(null)
    const { drafts, defaultNotebookId } = await generateDraftsFromSource()
    if (!drafts.length) return

    const fallbackNotebookId =
      defaultNotebookId ||
      availableNotebooks[0]?.notebook_id ||
      null

    const preparedDrafts = drafts.map(draft => ({
      ...draft,
      targetNotebookId: draft.targetNotebookId || draft.suggestedNotebookId || fallbackNotebookId
    }))

    setDrafts(preparedDrafts)
    await new Promise(resolve => setTimeout(resolve, 0))

    setSavingAll(true)
    let successCount = 0
    for (let i = 0; i < preparedDrafts.length; i += 1) {
      const draft = preparedDrafts[i]
      if (!draft.targetNotebookId) {
        updateDraft(draft.id, prev => ({ ...prev, status: 'error', errorMessage: '需要选择笔记本' }))
        continue
      }
      await handleSaveDraft(draft.id, { skipRefresh: true })
      successCount += 1
    }
    setSavingAll(false)
    if (successCount > 0) {
      setSuccessMessage(`已自动保存 ${successCount} 条笔记。`)
      onRequestNotebookRefresh?.()
    } else {
      setError('未能保存任何笔记，请检查草稿的目标笔记本。')
    }
  }

  const handleNotebookChange = (draftId: string, notebookId: string) => {
    updateDraft(draftId, draft => ({
      ...draft,
      targetNotebookId: notebookId || null,
      status: draft.status === 'saved' ? 'pending' : draft.status
    }))
  }

  const persistDraft = async (draft: DraftState) => {
    if (!draft.targetNotebookId) {
      throw new Error('请选择要保存的笔记本')
    }
    if (!draft.content.trim()) {
      throw new Error('笔记内容不能为空')
    }

    const structuredFields = draft.structuredFields || {}
    const componentData = {
      ai_note_import: {
        type: 'ai_note_import',
        value: {
          summary: draft.summary,
          topics: draft.topics,
          confidence: draft.confidence,
          explanation: draft.explanation,
          suggestedNotebookId: draft.suggestedNotebookId,
          suggestedNotebookName: draft.suggestedNotebookName,
          sourceSegment: draft.content,
          importSessionText: sourceText.trim().slice(0, 2000)
        }
      }
    }

    const payload: Record<string, any> = {
      notebook_id: draft.targetNotebookId,
      title: draft.title.trim() || structuredFields.title || '未命名笔记',
      content_text: draft.content,
      component_data: componentData
    }

    if (Object.keys(structuredFields).length > 0) {
      payload.structured_fields = structuredFields
    }
    const preferredSourceUrl =
      draft.sourceUrl ||
      structuredFields.source_url ||
      structuredFields.link ||
      ''
    if (preferredSourceUrl) {
      payload.source_url = preferredSourceUrl
      payload.original_url = preferredSourceUrl
    }
    if (structuredFields.author && !payload.author) {
      payload.author = structuredFields.author
    }
    if (structuredFields.published_at && !payload.upload_time) {
      payload.upload_time = structuredFields.published_at
    }
    if (Array.isArray(structuredFields.img_urls) && structuredFields.img_urls.length > 0) {
      payload.images = structuredFields.img_urls
    }
    if (draft.historyId) {
      payload.history_id = draft.historyId
    }

    await apiClient.post('/api/notes', payload)
  }

  const handleSaveDraft = async (draftId: string, options: { skipRefresh?: boolean } = {}) => {
    const currentDraft = drafts.find(draft => draft.id === draftId)
    if (!currentDraft) return

    updateDraft(draftId, draft => ({ ...draft, status: 'saving', errorMessage: null }))
    try {
      await persistDraft({ ...currentDraft, status: 'saving' })
      updateDraft(draftId, draft => ({ ...draft, status: 'saved', errorMessage: null }))
      if (!options.skipRefresh) {
        onRequestNotebookRefresh?.()
      }
    } catch (err: any) {
      console.error('保存笔记失败:', err)
      const message = err?.response?.data?.message || err?.message || '保存失败'
      updateDraft(draftId, draft => ({ ...draft, status: 'error', errorMessage: message }))
    }
  }

  const handleSaveAll = async () => {
    setSavingAll(true)
    for (const draft of drafts) {
      // eslint-disable-next-line no-await-in-loop
      await handleSaveDraft(draft.id, { skipRefresh: true })
    }
    onRequestNotebookRefresh?.()
    setSavingAll(false)
  }

  const handleRemoveDraft = (draftId: string) => {
    setDrafts(prev => prev.filter(draft => draft.id !== draftId))
  }

  // 检查链接是否已存在
  const checkArticleExists = async (
    url: string,
    target: 'input' | 'parseOnly' | 'parseAssign' | null = 'input'
  ) => {
    if (!url.trim()) {
      setUrlExists(false)
      setExistingHistoryId(null)
      return false
    }

    // 简单的URL验证
    try {
      new URL(url.trim())
    } catch {
      setUrlExists(false)
      setExistingHistoryId(null)
      return false
    }

    setCheckingUrl(true)
    setCheckingTarget(target)
    try {
      const response = await apiClient.post('/api/coze/check-article-exists', {
        articleUrl: url.trim()
      })
      
      if (response.data.exists) {
        setUrlExists(true)
        setExistingHistoryId(response.data.existingHistoryId || null)
        setError('解析已存在，请在历史记录中查看。')
        return true
      } else {
        setUrlExists(false)
        setExistingHistoryId(null)
        setError(null)
        return false
      }
    } catch (err: any) {
      console.error('检查链接失败:', err)
      // 检查失败不影响继续解析
      setUrlExists(false)
      setExistingHistoryId(null)
      return false
    } finally {
      setCheckingUrl(false)
      setCheckingTarget(null)
    }
  }

  // 从链接解析文章（仅解析）
  const handleParseFromUrl = async () => {
    if (!articleUrl.trim()) {
      setError('请输入文章链接')
      return
    }

    // 简单的URL验证
    try {
      new URL(articleUrl.trim())
    } catch {
      setError('请输入有效的URL地址')
      return
    }

    // 先检查是否已存在
    const exists = await checkArticleExists(articleUrl.trim(), 'parseAssign')
    if (exists) {
      // 如果已存在，不继续解析
      return
    }

    setError(null)
    setSuccessMessage(null)

    try {
      setParseAssignLoading(true)
      // 设置超时时间为600秒（10分钟，给后端足够的时间完成流式响应和重试，特别是微信公众号等复杂链接）
      // 后端最多可能需要：360秒流式响应 + 30秒等待 + 100秒重试 = 490秒
      const timeoutPromise = new Promise((_, reject) => {
        const isWeChat = articleUrl.includes('mp.weixin.qq.com');
        const timeoutMsg = isWeChat 
          ? '微信公众号文章解析可能需要更长时间。系统仍在后台处理，请稍后在"解析历史"中查看结果。'
          : '请求超时，解析可能需要较长时间。请稍后在"解析历史"中查看结果。';
        setTimeout(() => reject(new Error(timeoutMsg)), 600000)
      })

      // 使用Promise.race来处理超时，而不是通过axios的timeout配置
      const apiPromise = apiClient.post('/api/coze/parse-article', {
        articleUrl: articleUrl.trim(),
        query: '请提取并整理这篇文章的主要内容，保留关键信息和结构。同时根据文章主题推荐一个合适的笔记本分类（如果有）。'
      })

      const response = await Promise.race([apiPromise, timeoutPromise]) as any

      // 修改判断逻辑：只要有 success 和 historyId，就处理（即使 content 为空）
      // 因为即使内容为空，parsedFields 中也可能有数据，或者需要打开编辑弹窗查看状态
      if (response.data.success && response.data.data?.historyId) {
        // 优先使用后端返回的 parsedFields（包含所有动态解析的字段）
        const parsedFields = response.data.data.parsedFields || {};
        
        // 将解析的内容填充到文本框中
        let parsedContent = response.data.data.content || ''
        // 优先使用 parsedFields 中的字段，如果没有则使用旧的固定字段（向后兼容）
        let parsedTitle = parsedFields.title || response.data.data.title as string | undefined
        let parsedSummary = parsedFields.summary || response.data.data.summary as string | undefined
        const parsedSource = parsedFields.source || response.data.data.source as string | undefined
        const parsedPlatform = parsedFields.platform || response.data.data.platform as string | undefined
        const parsedAuthor = parsedFields.author || response.data.data.author as string | undefined
        const parsedPublishedAt = parsedFields.published_at || parsedFields.publishedAt || response.data.data.publishedAt as string | undefined
        const parsedKeywords = Array.isArray(parsedFields.keywords) ? parsedFields.keywords : 
                              (Array.isArray(parsedFields.tags) ? parsedFields.tags : 
                              (Array.isArray(response.data.data.keywords) ? response.data.data.keywords : []))
        
        // 检查内容是否包含处理中的提示（即使 content 为空，也要检查 parsedFields 中是否有数据）
        const hasProcessingHint = parsedContent && (
          parsedContent.includes('处理超时') || 
          parsedContent.includes('处理中') || 
          parsedContent.includes('Chat ID') ||
          parsedContent.includes('解析中或解析失败')
        );
        
        // 检查 parsedFields 中是否有有效数据
        const hasParsedFields = parsedFields && typeof parsedFields === 'object' && Object.keys(parsedFields).length > 0;
        const hasValidData = hasParsedFields && (
          parsedFields.title || 
          parsedFields.content || 
          parsedFields.summary ||
          (Array.isArray(parsedFields.keywords) && parsedFields.keywords.length > 0)
        );
        
        if (hasProcessingHint && !hasValidData) {
          // 这是超时提示且没有有效数据，只显示警告，但仍打开编辑弹窗让用户查看状态
          setError('解析超时，请稍后在"解析历史"中查看完整结果，或稍后重试。')
          setParsedContext(null)
        } else {
          // 格式化解析的内容，清理JSON格式和转义字符
          if (parsedContent) {
          parsedContent = formatParsedContent(parsedContent)
          }
          
          // 对 title 和 summary 也进行格式化处理，清理可能的 JSON 格式
          if (parsedTitle) {
            parsedTitle = formatParsedContent(parsedTitle).trim()
            // 如果格式化后为空，说明是空的 JSON，设置为 undefined
            if (!parsedTitle) parsedTitle = undefined
          }
          if (parsedSummary) {
            parsedSummary = formatParsedContent(parsedSummary).trim()
            // 如果格式化后为空，说明是空的 JSON，设置为 undefined
            if (!parsedSummary) parsedSummary = undefined
          }
          
          // 解析结果不再回填到文本框，只保存到历史记录
          const snapshotFields =
            Object.keys(parsedFields).length > 0
              ? { ...parsedFields }
              : {
                  ...(parsedTitle ? { title: parsedTitle } : {}),
                  ...(parsedContent ? { content: parsedContent } : {}),
                  ...(parsedSummary ? { summary: parsedSummary } : {}),
                  ...(response.data.data.sourceUrl ? { source_url: response.data.data.sourceUrl } : {}),
                  ...(parsedSource ? { source: parsedSource } : {}),
                  ...(parsedPlatform ? { source_platform: parsedPlatform } : {}),
                  ...(parsedAuthor ? { author: parsedAuthor } : {}),
                  ...(parsedPublishedAt ? { published_at: parsedPublishedAt } : {}),
                  ...(parsedKeywords.length ? { keywords: parsedKeywords } : {})
                }

          setParsedContext({
            fields: snapshotFields,
            historyId: response.data.data.historyId || null,
            sourceUrl: response.data.data.sourceUrl || articleUrl.trim()
          })

          // 根据是否有有效数据来决定提示信息
          if (hasValidData || parsedContent) {
            setSuccessMessage('解析完成，内容已保存到解析历史。')
          } else {
            setSuccessMessage('解析请求已提交，请稍后在"解析历史"中查看结果。')
          }
          
          // 短暂高亮最新条目
          const historyId = response.data.data.historyId
          if (historyId) {
            setHighlightedHistoryId(historyId)
            setTimeout(() => {
              setHighlightedHistoryId(null)
            }, 3000) // 3秒后取消高亮
            
            // 刷新解析历史后，自动打开编辑弹窗
            setCurrentPage(1)
            await loadHistory()
            
            // 打开编辑弹窗，自动填充解析结果（即使内容为空，也打开让用户查看状态）
            await handleEditHistory(historyId)
          } else {
            // 如果没有 historyId，只刷新历史列表
            setCurrentPage(1)
            await loadHistory()
          }
        }

        // 可选：如果有推荐的笔记本，可以在这里提示用户
        if (response.data.data.suggestedNotebookName) {
          console.log('📚 推荐的笔记本:', response.data.data.suggestedNotebookName)
        }
        
        // 清空URL输入框和检查状态
        setArticleUrl('')
        setUrlExists(false)
        setExistingHistoryId(null)
      } else {
        // 详细记录失败原因
        const errorMsg = response.data.error || '解析失败，请稍后再试';
        console.error('❌ 解析失败 - 响应数据:', {
          success: response.data.success,
          error: response.data.error,
          message: response.data.message,
          details: response.data.details,
          existingHistoryId: response.data.existingHistoryId,
          hasHistoryId: !!response.data.data?.historyId,
          hasContent: !!response.data.data?.content
        });
        setError(errorMsg)
        setParsedContext(null)
        await loadHistory()
      }
    } catch (err: any) {
      console.error('❌ 解析文章链接失败:', err)
      console.error('❌ 错误详情:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status,
        config: {
          url: err.config?.url,
          method: err.config?.method,
          baseURL: err.config?.baseURL
        }
      });
      const errorMessage = err.response?.data?.error || err.message || '解析失败，请检查链接是否可访问'
      
      // 如果是超时错误，提供更友好的提示
      if (err.message?.includes('超时') || err.message?.includes('timeout')) {
        const isWeChat = articleUrl.includes('mp.weixin.qq.com');
        const timeoutMsg = isWeChat
          ? '微信公众号文章解析可能需要更长时间。系统仍在后台处理，请稍后在"解析历史"中查看结果，或稍后重试。'
          : '解析超时，可能需要更长时间。请稍后在"解析历史"中查看结果，或稍后重试。';
        setError(timeoutMsg)
      } else {
        setError(errorMessage)
      }
      await loadHistory()
    } finally {
      setParseAssignLoading(false)
    }
  }

  // 仅解析文章（不分配，填充到文本框）
  const handleParseOnly = async () => {
    if (!articleUrl.trim()) {
      setError('请输入文章链接')
      return
    }

    // 简单的URL验证
    try {
      new URL(articleUrl.trim())
    } catch {
      setError('请输入有效的URL地址')
      return
    }

    // 先检查是否已存在
    const exists = await checkArticleExists(articleUrl.trim(), 'parseOnly')
    if (exists) {
      // 如果已存在，不继续解析
      return
    }

    setError(null)
    setSuccessMessage(null)

    try {
      setParseOnlyLoading(true)
      // 设置超时时间为600秒（10分钟，给后端足够的时间完成流式响应和重试）
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('请求超时，解析可能需要较长时间。请稍后在"解析历史"中查看结果。')), 600000)
      })

      // 调用解析接口（不分配）
      const apiPromise = apiClient.post('/api/coze/parse-article', {
        articleUrl: articleUrl.trim(),
        query: '请提取并整理这篇文章的主要内容，保留关键信息和结构。',
        aiSummaryConfig: buildLinkAiSummaryPayload()
      })

      const response = await Promise.race([apiPromise, timeoutPromise]) as any

      // 修改判断逻辑：只要有 success 和 historyId，就处理（即使 content 为空）
      if (response.data.success && response.data.data?.historyId) {
        const parsedContent = response.data.data.content || ''
        const parsedFields = response.data.data.parsedFields || {};
        
        // 检查 parsedFields 中是否有有效数据
        const hasParsedFields = parsedFields && typeof parsedFields === 'object' && Object.keys(parsedFields).length > 0;
        const hasValidData = hasParsedFields && (
          parsedFields.title || 
          parsedFields.content || 
          parsedFields.summary ||
          (Array.isArray(parsedFields.keywords) && parsedFields.keywords.length > 0)
        );
        
        // 检查是否是超时或处理中的提示
        const hasProcessingHint = parsedContent && (
          parsedContent.includes('处理超时') || 
          parsedContent.includes('处理中') || 
          parsedContent.includes('Chat ID') ||
          parsedContent.includes('解析中或解析失败')
        );
        
        if (hasProcessingHint && !hasValidData) {
          // 这是超时提示且没有有效数据，只显示警告，但仍打开编辑弹窗让用户查看状态
          setError('解析超时，请稍后在"解析历史"中查看完整结果，或稍后重试。')
        } else {
          // 根据是否有有效数据来决定提示信息
          if (hasValidData || parsedContent) {
            setSuccessMessage('解析完成，已生成解析历史，可在编辑弹窗中查看和编辑。')
          } else {
            setSuccessMessage('解析请求已提交，请稍后在"解析历史"中查看结果。')
          }
        }
        
        // 解析成功，获取历史ID并打开编辑弹窗（即使内容为空，也打开让用户查看状态）
        const historyId = response.data.data.historyId
        
        if (historyId) {
        // 刷新解析历史
        await loadHistory()
          
          // 打开编辑弹窗
          await handleEditHistory(historyId)
          
          // 短暂高亮最新条目
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000) // 3秒后取消高亮
      } else {
          setError('解析成功但未生成历史记录，请稍后再试')
        }

        // 清空URL输入框和检查状态
        setArticleUrl('')
        setUrlExists(false)
        setExistingHistoryId(null)

        // 跳转到第一页显示最新记录
        setCurrentPage(1)
      } else {
        // 详细记录失败原因
        const errorMsg = response.data.error || '解析失败，请稍后再试';
        console.error('❌ 仅解析失败 - 响应数据:', {
          success: response.data.success,
          error: response.data.error,
          message: response.data.message,
          details: response.data.details,
          hasHistoryId: !!response.data.data?.historyId,
          hasContent: !!response.data.data?.content
        });
        setError(errorMsg)
        await loadHistory()
      }
    } catch (err: any) {
      console.error('❌ 仅解析失败:', err)
      console.error('❌ 错误详情:', {
        message: err.message,
        response: err.response?.data,
        status: err.response?.status
      });
      const errorMessage = err.response?.data?.error || err.message || '解析失败，请检查链接是否可访问'
      
      if (err.message?.includes('超时') || err.message?.includes('timeout')) {
        setError('解析超时，可能需要更长时间。请稍后在"解析历史"中查看结果，或稍后重试。')
      } else {
        setError(errorMessage)
      }
      await loadHistory()
    } finally {
      setParseOnlyLoading(false)
    }
  }

  // 解析并分配笔记（自动分配）
  const handleParseAndAssign = async () => {
    if (!articleUrl.trim()) {
      setError('请输入文章链接')
      return
    }

    // 简单的URL验证
    try {
      new URL(articleUrl.trim())
    } catch {
      setError('请输入有效的URL地址')
      return
    }

    // 先检查是否已存在
    const exists = await checkArticleExists(articleUrl.trim(), 'parseAssign')
    if (exists) {
      // 如果已存在，不继续解析
      return
    }

    setError(null)
    setSuccessMessage(null)

    try {
      setParseAssignLoading(true)
      // 设置超时时间为600秒（10分钟，给后端足够的时间完成流式响应和重试）
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('请求超时，解析可能需要较长时间。请稍后在"解析历史"中查看结果。')), 600000)
      })

      // 调用解析并分配接口
      const apiPromise = apiClient.post('/api/coze/parse-and-assign', {
        articleUrl: articleUrl.trim(),
        query: '请提取并整理这篇文章的主要内容，保留关键信息和结构。同时根据文章主题推荐一个合适的笔记本分类（如果有）。',
        aiSummaryConfig: buildLinkAiSummaryPayload()
      })

      const response = await Promise.race([apiPromise, timeoutPromise]) as any

      if (response.data.success) {
        const { historyId, assigned, message, metadata: responseMeta } = response.data.data || {}
        setMetadata(responseMeta || null)
        
        if (assigned) {
          setSuccessMessage(message || '解析成功并已自动分配到笔记本')
        } else {
          setSuccessMessage(message || '解析成功，但未找到推荐的笔记本')
        }

        // 清空URL输入框和检查状态
        setArticleUrl('')
        setUrlExists(false)
        setExistingHistoryId(null)

        // 刷新解析历史，并跳转到第一页显示最新记录
        setCurrentPage(1)
        await loadHistory()
        
        // 短暂高亮最新条目
        if (historyId) {
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000) // 3秒后取消高亮
          
          // 自动打开编辑弹窗，填充解析结果
          await handleEditHistory(historyId)
        }
      } else {
        setError(response.data.error || '解析并分配失败，请稍后再试')
        await loadHistory()
      }
    } catch (err: any) {
      console.error('解析并分配失败:', err)
      const errorMessage = err.response?.data?.error || err.message || '解析并分配失败，请检查链接是否可访问'
      
      if (err.message?.includes('超时') || err.message?.includes('timeout')) {
        setError('解析超时，可能需要更长时间。请稍后在"解析历史"中查看结果，或稍后重试。')
      } else {
        setError(errorMessage)
      }
      await loadHistory()
    } finally {
      setParseAssignLoading(false)
    }
  }

  // 手动笔记：解析并分配（从文本框）
  const handleSaveManualToHistoryFromText = async () => {
    if (!sourceText.trim()) {
      setError('笔记内容不能为空')
      return
    }

    try {
      setMetadata(null)
      setLoading(true)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('请求超时，解析可能需要较长时间。请稍后在"解析历史"中查看结果。')), 600000)
      })

      const apiPromise = apiClient.post('/api/parse-and-assign-text', {
        content: sourceText.trim(),
        img_urls: pastedImages,
        aiSummaryConfig: buildTextAiSummaryPayload()
      })

      const response = await Promise.race([apiPromise, timeoutPromise]) as any

      if (response.data.success) {
        const { historyId, assigned, message } = response.data.data || {}

        if (assigned) {
          setSuccessMessage(message || '解析成功并已自动分配到笔记本')
        } else {
          setSuccessMessage(message || '解析成功，但未找到推荐的笔记本')
        }
        // 清空文本框
        setSourceText('')
        setPastedImages([])
        // 刷新历史记录，并跳转到第一页显示最新记录
        setCurrentPage(1)
        await loadHistory()
        // 短暂高亮最新条目并打开编辑弹窗
        if (historyId) {
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000)
          await handleEditHistory(historyId)
        }
      } else {
        setError(response.data.error || '解析并分配失败')
        await loadHistory()
      }
    } catch (err: any) {
      console.error('解析并分配失败:', err)
      const errorMessage = err.response?.data?.error || err.message || '解析并分配失败，请重试'
      if (err.message?.includes('超时') || err.message?.includes('timeout')) {
        setError('解析超时，可能需要更长时间。请稍后在"解析历史"中查看结果，或稍后重试。')
      } else {
        setError(errorMessage)
      }
      await loadHistory()
    } finally {
      setLoading(false)
    }
  }

  // 手动笔记：AI分配并保存（从文本框）
  const handleAIAssignAndSaveFromText = async () => {
    if (!sourceText.trim()) {
      setError('笔记内容不能为空')
      return
    }

    try {
      setMetadata(null)
      setLoading(true)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('请求超时，解析可能需要较长时间。请稍后在"解析历史"中查看结果。')), 600000)
      })

      const apiPromise = apiClient.post('/api/parse-text', {
        content: sourceText.trim(),
        img_urls: pastedImages,
        aiSummaryConfig: buildTextAiSummaryPayload()
      })

      const response = await Promise.race([apiPromise, timeoutPromise]) as any

      if (response.data.success) {
        const { historyId, parsedFields, content, metadata: responseMeta } = response.data.data || {}
        setMetadata(responseMeta || null)

        if (parsedFields || content) {
          setSuccessMessage('解析完成，已生成解析历史，可在编辑弹窗中查看和编辑。')
        } else {
          setSuccessMessage('解析请求已提交，请稍后在"解析历史"中查看结果。')
        }
        // 清空文本框
        setSourceText('')
        setPastedImages([])
        // 刷新历史记录，并跳转到第一页显示最新记录
        setCurrentPage(1)
        await loadHistory()
        // 短暂高亮最新条目并打开编辑弹窗
        if (historyId) {
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000)
          await handleEditHistory(historyId)
        }
      } else {
        setError(response.data.error || '解析失败')
        await loadHistory()
      }
    } catch (err: any) {
      console.error('解析失败:', err)
      const errorMessage = err.response?.data?.error || err.message || '解析失败，请重试'
      if (err.message?.includes('超时') || err.message?.includes('timeout')) {
        setError('解析超时，可能需要更长时间。请稍后在"解析历史"中查看结果，或稍后重试。')
      } else {
        setError(errorMessage)
      }
      await loadHistory()
    } finally {
      setLoading(false)
    }
  }

  // 手动笔记：仅保存到历史（从草稿）
  const handleSaveManualToHistory = async (draft: DraftState) => {
    if (!draft.content.trim()) {
      setError('笔记内容不能为空')
      return
    }

    try {
      const response = await apiClient.post('/api/parse-text', {
        title: draft.title || deriveTitleFromContent(draft.content),
        content: draft.content.trim(),
        summary: draft.summary || null,
        keywords: draft.topics.length > 0 ? draft.topics : null,
        structuredFields: Object.keys(draft.structuredFields).length > 0 ? draft.structuredFields : null,
        aiSummaryConfig: buildTextAiSummaryPayload()
      })

      if (response.data.success) {
        const historyId = response.data.data?.historyId
        setSuccessMessage('已保存到解析历史')
        // 移除该草稿
        handleRemoveDraft(draft.id)
        // 刷新历史记录
        await loadHistory()
        // 短暂高亮最新条目
        if (historyId) {
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000) // 3秒后取消高亮
        }
      } else {
        setError(response.data.error || '保存失败')
      }
    } catch (err: any) {
      console.error('保存到历史失败:', err)
      setError(err.response?.data?.error || err.message || '保存失败')
    }
  }

  // 手动笔记：AI分配并保存（从草稿）
  const handleAIAssignAndSave = async (draft: DraftState) => {
    if (!draft.content.trim()) {
      setError('笔记内容不能为空')
      return
    }

    try {
      const response = await apiClient.post('/api/parse-and-assign-text', {
        title: draft.title || deriveTitleFromContent(draft.content),
        content: draft.content.trim(),
        summary: draft.summary || null,
        keywords: draft.topics.length > 0 ? draft.topics : null,
        structuredFields: Object.keys(draft.structuredFields).length > 0 ? draft.structuredFields : null,
        aiSummaryConfig: buildTextAiSummaryPayload()
      })

      if (response.data.success) {
        const { historyId, assigned, message, suggestedNotebookName } = response.data.data || {}
        if (assigned) {
          setSuccessMessage(message || `已保存并自动分配到笔记本：${suggestedNotebookName || '未知'}`)
        } else {
          setSuccessMessage(message || '已保存到历史，但未找到推荐的笔记本')
        }
        // 移除该草稿
        handleRemoveDraft(draft.id)
        // 刷新历史记录
        await loadHistory()
        // 短暂高亮最新条目
        if (historyId) {
          setHighlightedHistoryId(historyId)
          setTimeout(() => {
            setHighlightedHistoryId(null)
          }, 3000)
        }
      } else {
        setError(response.data.error || 'AI分配失败')
      }
    } catch (err: any) {
      console.error('AI分配并保存失败:', err)
      setError(err.response?.data?.error || err.message || '操作失败')
    }
  }

  const renderedNotebooks = useMemo(
    () => (availableNotebooks || []).filter(nb => nb && (nb.name || nb.notebook_id)),
    [availableNotebooks]
  )

  // 加载解析历史
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    setHistoryLoadError(null) // 清除之前的错误
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const params: any = { limit: 50 }
      if (historyFilter !== 'all') {
        params.status = historyFilter
      }
      
      // 使用 AbortController 实现真正的超时取消（60秒，给足够时间）
      const controller = new AbortController()
      timeoutId = setTimeout(() => {
        console.warn('⏰ 解析历史请求超时，取消请求');
        controller.abort();
      }, 60000)

      console.log('🔄 开始加载解析历史，参数:', params);
      const response = await apiClient.get('/api/coze/parse-history', { 
        params,
        signal: controller.signal 
      }) as any
      console.log('✅ 解析历史响应:', response);

      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (response?.data?.success) {
        const items = Array.isArray(response.data.data?.items) ? response.data.data.items : []
        const mapped: ParseHistory[] = items.map((item: any) => ({
          ...item,
          status: normalizeHistoryStatus(item.status),
          keywords: Array.isArray(item.keywords)
            ? item.keywords
            : parseKeywords(item.tags)
        }))
        setHistoryList(mapped)
        setHistoryLoadError(null) // 成功时清除错误
        
        // 调整页码：如果当前页超出范围，调整到最后一页
        const totalPages = Math.ceil(mapped.length / itemsPerPage)
        if (totalPages > 0 && currentPage > totalPages) {
          setCurrentPage(totalPages)
        }
      } else {
        // 如果 API 返回失败，清空列表并显示错误
        setHistoryList([])
        setLoadingHistory(false) // 清除加载状态
        setHistoryLoadError('加载失败') // 使用简短的错误消息
      }
    } catch (err: any) {
      console.error('加载历史失败:', err)
      console.error('错误详情:', err.response?.data || err.message || err)
      
      // 清理超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      
      setHistoryList([]) // 确保清空列表，避免一直显示加载中
      setLoadingHistory(false) // 立即清除加载状态，避免与错误消息同时显示
      // 提供更详细的错误信息
      const errorMessage = err.response?.data?.error || err.message || '加载失败'
      setHistoryLoadError(errorMessage) // 使用更详细的错误消息
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      setLoadingHistory(false)
    }
  }, [historyFilter, currentPage, itemsPerPage])

  // 打开编辑弹窗（从详情API获取完整数据）
  const handleEditHistory = async (historyId: string) => {
    try {
      const response = await apiClient.get(`/api/coze/parse-history/${historyId}`)
      if (response?.data?.success && response.data.data) {
        const historyData = response.data.data
        console.log('🔍 获取到的历史详情数据:', historyData)
        console.log('🔍 parsed_img_urls:', historyData.parsed_img_urls)
        console.log('🔍 parsed_note_type:', historyData.parsed_note_type)
        console.log('🔍 parsed_fields:', historyData.parsed_fields)
        
        const mapped: ParseHistory = {
          ...historyData,
          status: normalizeHistoryStatus(historyData.status),
          keywords: Array.isArray(historyData.keywords)
            ? historyData.keywords
            : parseKeywords(historyData.tags),
          // 确保这些字段被正确保留（使用 !== undefined 来保留 null 和空值）
          parsed_img_urls: historyData.parsed_img_urls !== undefined 
            ? historyData.parsed_img_urls 
            : null,
          parsed_note_type: historyData.parsed_note_type !== undefined 
            ? historyData.parsed_note_type 
            : null
        }
        console.log('🔍 映射后的数据:', mapped)
        console.log('🔍 映射后的 parsed_img_urls:', mapped.parsed_img_urls)
        console.log('🔍 映射后的 parsed_note_type:', mapped.parsed_note_type)
        setEditingHistory(mapped)
      } else {
        setError('获取历史详情失败')
      }
    } catch (err: any) {
      console.error('获取历史详情失败:', err)
      setError('获取历史详情失败')
    }
  }

  // 删除历史记录
  const handleDeleteHistory = async (historyId: string) => {
    if (!window.confirm('确定要删除这条解析历史吗？')) return

    try {
      const response = await apiClient.delete(`/api/coze/parse-history/${historyId}`)
      // 删除后，如果当前页没有记录了，调整到上一页
      const currentPageIndex = (currentPage - 1) * itemsPerPage
      const remainingOnPage = historyList.length - currentPageIndex
      if (remainingOnPage <= 1 && currentPage > 1) {
        setCurrentPage(prev => Math.max(1, prev - 1))
      }
      await loadHistory()
      // 清除选中状态
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

  // 批量删除历史记录
  const handleBatchDeleteHistory = async () => {
    if (selectedHistoryIds.size === 0) return
    if (!window.confirm(`确定要删除选中的 ${selectedHistoryIds.size} 条解析历史吗？`)) return

    try {
      const deletePromises = Array.from(selectedHistoryIds).map(id =>
        apiClient.delete(`/api/coze/parse-history/${id}`)
      )
      const results = await Promise.allSettled(deletePromises)
      
      // 检查是否有失败的删除
      const failed = results.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        console.error('部分删除失败:', failed)
        const errorMessages = failed.map(f => {
          const err = f.status === 'rejected' ? f.reason : null
          return err?.response?.data?.error || err?.message || '删除失败'
        })
        setError(`批量删除部分失败: ${errorMessages.join('; ')}`)
      }
      
      // 删除后，如果当前页没有记录了，调整到上一页
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

  // AI 分配历史记录
  const handleAiAssignHistory = async (historyId: string, forceRedistribute = false) => {
    setAssigningHistoryId(historyId)
    setError(null)
    setSuccessMessage(null)
    try {
      const response = await apiClient.post(`/api/coze/parse-history/${historyId}/ai-assign`, {
        forceRedistribute
      })
      const payload = response?.data?.data || {}
      const message = payload.message || (forceRedistribute ? 'AI重新分配完成' : 'AI分配完成')
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

  // 批量分配到笔记本
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
    } catch (err: any) {
      console.error('批量分配失败:', err)
      setError('批量分配失败')
    }
  }

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const totalPages = Math.ceil(historyList.length / itemsPerPage)
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
    const targetNotebook = selectableNotebooks.find(
      (nb) => String(nb.notebook_id) === String(manualMoveNotebookId)
    )
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

  // 切换单项选中状态
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

  // 计算当前页是否全选
  const isAllSelected = useMemo(() => {
    const totalPages = Math.ceil(historyList.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentPageHistory = historyList.slice(startIndex, endIndex)
    if (currentPageHistory.length === 0) return false
    return currentPageHistory.every(h => selectedHistoryIds.has(h.id))
  }, [historyList, currentPage, itemsPerPage, selectedHistoryIds])

  // 页面加载时自动加载历史记录
  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // 当筛选条件改变时，重置到第一页并清除选中状态
  useEffect(() => {
    setCurrentPage(1)
    setSelectedHistoryIds(new Set())
  }, [historyFilter])

  const infoMessage = useMemo(() => {
    if (!metadata) return null
    if (metadata.usedFallback) {
      return `⚠️ 当前使用本地规则生成草稿：${metadata.reason || '模型不可用'}`
    }
    return null
  }, [metadata])

  const selectableNotebooks = useMemo(
    () =>
      availableNotebooks.filter(
        (nb): nb is NotebookOption & { notebook_id: string } => !!nb.notebook_id
      ),
    [availableNotebooks]
  )
  const isAnyParsing = parseOnlyLoading || parseAssignLoading
  const isCheckingParseOnly = checkingUrl && checkingTarget === 'parseOnly'
  const isCheckingParseAssign = checkingUrl && checkingTarget === 'parseAssign'

  const renderHistoryContent = () => {
    if (loadingHistory) {
      return <div className="text-center py-8 text-slate-400">加载中...</div>
    }
    if (historyLoadError) {
      return <div className="text-center py-8 text-rose-600">{historyLoadError}</div>
    }
    if (historyList.length === 0) {
      return <div className="text-center py-8 text-slate-400">暂无解析历史</div>
    }

    const totalPages = Math.ceil(historyList.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const currentPageHistory = historyList.slice(startIndex, endIndex)

    const latestHistory = historyList.length > 0
      ? historyList.reduce((latest, current) => {
          const latestTime = new Date(latest.parsed_at).getTime()
          const currentTime = new Date(current.parsed_at).getTime()
          return currentTime > latestTime ? current : latest
        })
      : null

                const statusLabels: Record<HistoryStatus, { label: string; className: string }> = {
                  '解析中': { label: '解析中', className: 'bg-yellow-100 text-yellow-700' },
                  '解析成功': { label: '解析成功', className: 'bg-green-100 text-green-700' },
                  '解析失败': { label: '解析失败', className: 'bg-rose-100 text-rose-700' }
                }

                return (
      <>
        <div className="space-y-3">
          {currentPageHistory.map(history => {
            let displayStatus: HistoryStatus = history.status
            if (displayStatus === '解析成功') {
              const allText = [
                history.parsed_content || '',
                history.parsed_summary || '',
                history.parsed_title || ''
              ].join(' ').trim()

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
            const canAiAssign = normalizedHistoryStatus === '解析成功'
            const shouldShowAiAssign = normalizedHistoryStatus === '解析成功'
            const aiAssignDisabledReason =
              normalizedHistoryStatus !== '解析成功' ? '解析成功后才能使用AI分配' : ''
            const isAssigningCurrent = assigningHistoryId === history.id
            const aiAssignButtonClass = canAiAssign
              ? 'px-3 py-1.5 text-xs border border-purple-200 text-purple-600 rounded hover:bg-purple-50 transition-colors'
              : 'px-3 py-1.5 text-xs border border-slate-200 text-slate-400 rounded bg-slate-50 cursor-not-allowed'
            const aiAssignLabel = isAssigningCurrent
              ? history.assigned_notebook_id
                ? 'AI重新分配中…'
                : 'AI分配中…'
              : history.assigned_notebook_id
                ? 'AI重新分配'
                : 'AI分配'
            const keywords = Array.isArray(history.keywords) ? history.keywords : []

            const isLatest = latestHistory && history.id === latestHistory.id
            const isHighlighted = highlightedHistoryId === history.id

            const rawSourceType = (history.source_type || '').toLowerCase()
            const normalizedSourceType = rawSourceType
              ? (rawSourceType.includes('manual') || rawSourceType.includes('text') ? 'manual_text' : 'from_url')
              : (history.source_url && !history.source_url.startsWith('manual:') ? 'from_url' : 'manual_text')
            const sourceLabel = normalizedSourceType === 'from_url' ? '链接解析' : '文本解析'
            const sourceColor = normalizedSourceType === 'from_url' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'

            const hasAssignedNotebook = !!history.assigned_notebook_id
            const hasSuggestedNotebook = !!history.suggested_notebook_name
            let assignmentStatus: '已分配' | '未分配' | '分配失败' = '未分配'
            let assignmentStatusColor = 'bg-gray-100 text-gray-700'

            if (hasAssignedNotebook) {
              assignmentStatus = '已分配'
              assignmentStatusColor = 'bg-green-100 text-green-700'
            } else if (hasSuggestedNotebook) {
              assignmentStatus = '分配失败'
              assignmentStatusColor = 'bg-red-100 text-red-700'
            }

            const formattedTitle = history.parsed_title ? formatParsedContent(history.parsed_title).trim() : null

            return (
              <div
                key={history.id}
                className={`border rounded-lg p-4 transition-all duration-300 ${
                  isHighlighted
                    ? 'border-purple-400 bg-white shadow-sm ring-1 ring-purple-200'
                    : isLatest
                      ? 'border-purple-300 bg-white/90'
                      : selectedHistoryIds.has(history.id)
                        ? 'border-purple-300 bg-white'
                        : 'border-[#e0d7fb] bg-white/80 hover:bg-white'
                }`}
              >
                    <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedHistoryIds.has(history.id)}
                      onChange={() => handleToggleSelect(history.id)}
                      className="mt-1 w-4 h-4 text-green-600 border-slate-300 rounded focus:ring-green-500"
                    />
                      <div className="flex-1 min-w-0">
                        {/* 标签行 */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`px-2 py-1 text-xs rounded whitespace-nowrap ${sourceColor}`}>
                            {sourceLabel}
                          </span>
                          {isLatest && (
                            <span className="px-2 py-1 text-xs rounded whitespace-nowrap bg-purple-200 text-purple-800 font-medium">
                              最新
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded whitespace-nowrap ${statusInfo.className}`}>
                            {statusInfo.label}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded whitespace-nowrap ${assignmentStatusColor}`}>
                            {assignmentStatus}
                          </span>
                        </div>

                        {/* 标题 */}
                        {formattedTitle && (
                          <div className="text-sm font-semibold text-slate-900 mb-2">
                            {formattedTitle}
                          </div>
                        )}

                        {/* 已分配到 */}
                        {history.assigned_notebook_name && (
                          <div className="text-sm text-slate-600 mb-1">
                            <span className="font-medium">已分配到:</span>{' '}
                            <span className="text-indigo-600">{history.assigned_notebook_name}</span>
                          </div>
                        )}

                        {/* 解析时间 */}
                        <div className="text-xs text-slate-500">
                          解析时间：{new Date(history.parsed_at).toLocaleString('zh-CN')}
                        </div>
                    </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                    {shouldShowAiAssign && (
                        <button
                        onClick={() =>
                          canAiAssign &&
                          handleAiAssignHistory(history.id, !!history.assigned_notebook_id)
                        }
                        className={aiAssignButtonClass}
                        disabled={!canAiAssign || isAssigningCurrent}
                        title={
                          canAiAssign
                            ? '根据解析内容自动匹配合适的笔记本'
                            : aiAssignDisabledReason || '暂不可用'
                        }
                      >
                        {aiAssignLabel}
                        </button>
                    )}
                        <button
                      onClick={() => openManualMoveDialog(history)}
                      className="px-3 py-1.5 text-xs border border-indigo-200 text-indigo-600 rounded hover:bg-indigo-50 transition-colors"
                      title="手动选择目标笔记本并移动笔记"
                      disabled={!selectableNotebooks.length}
                    >
                      手动移动
                        </button>
                        <button
                      onClick={() => handleEditHistory(history.id)}
                          className="px-3 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                          title="编辑"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteHistory(history.id)}
                          className="px-3 py-1.5 text-xs border border-rose-200 text-rose-600 rounded hover:bg-rose-50 transition-colors"
                          title="删除"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <div className="text-sm text-slate-600">
              共 {historyList.length} 条，第 {currentPage} / {totalPages} 页
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
                  if (
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1)
                  ) {
                    return (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-3 py-1.5 text-sm border rounded-lg transition-colors ${
                          currentPage === page
                            ? 'bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30 border-purple-600'
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
    <div className="flex flex-col gap-6 bg-purple-50 min-h-screen px-4 pb-8">
      <div className="space-y-4">
        {/* 文章链接输入区域 */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
            <span className="text-sm">🔗</span>
            <span>方式一 · 解析链接</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="url"
              value={articleUrl}
              onChange={e => {
                setArticleUrl(e.target.value)
                if (urlExists) {
                  setUrlExists(false)
                  setExistingHistoryId(null)
                  setError(null)
                }
              }}
              onBlur={e => {
                if (e.target.value.trim()) {
                  checkArticleExists(e.target.value.trim(), 'input')
                }
              }}
              placeholder="粘贴文章链接，如：https://example.com/article"
              className={`flex-1 rounded-lg border px-4 py-2 text-sm focus:outline-none focus:ring-2 ${
                urlExists
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-200 focus:border-purple-500 focus:ring-purple-200'
              } bg-white`}
              disabled={isAnyParsing || loading}
              onKeyPress={e => {
                if (e.key === 'Enter' && !parseAssignLoading && articleUrl.trim() && !urlExists) {
                  handleParseAndAssign()
                }
              }}
            />
            <button
              onClick={handleParseOnly}
              disabled={
                !articleUrl.trim() ||
                parseOnlyLoading ||
                loading ||
                urlExists ||
                isCheckingParseOnly
              }
              className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 disabled:cursor-not-allowed disabled:bg-purple-300"
              title="仅解析文章内容，生成解析历史并在编辑弹窗中打开，不自动分配"
            >
              {isCheckingParseOnly
                ? '检查中…'
                : parseOnlyLoading
                  ? '解析中…'
                  : urlExists
                    ? '链接已存在'
                    : '仅解析'}
            </button>
            <button
              onClick={handleParseAndAssign}
              disabled={
                !articleUrl.trim() ||
                parseAssignLoading ||
                loading ||
                urlExists ||
                isCheckingParseAssign
              }
              className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 disabled:cursor-not-allowed disabled:bg-purple-300"
              title="解析文章内容并自动分配到推荐的笔记本"
            >
              {isCheckingParseAssign
                ? '检查中…'
                : parseAssignLoading
                  ? '解析中…'
                  : urlExists
                    ? '链接已存在'
                    : '解析并分配'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            支持微信公众号/长桥/知乎等链接，点击“仅解析”生成历史，或点击“解析并分配”自动归类推荐笔记本。
          </p>
          {urlExists && existingHistoryId && (
            <p className="mt-1 text-xs text-red-500">
              该链接已解析过，历史ID: {existingHistoryId}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 pt-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                  checked={parseSettings.linkAiSummaryEnabled}
                  onChange={(e) => updateParseSettings({ linkAiSummaryEnabled: e.target.checked })}
                />
              生成 AI 笔记总结
            </label>
            <button
              type="button"
              onClick={() => setShowLinkPromptDetails((prev) => !prev)}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>AI 提示词</span>
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8E0FF] text-slate-700 transition-transform duration-200 ${
                  showLinkPromptDetails ? 'rotate-180' : ''
                }`}
              >
                <svg
                  className="h-3.5 w-3.5 text-slate-700"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
          {showLinkPromptDetails && (
            <div className="text-xs leading-relaxed text-slate-600 space-y-2">
              {isEditingLinkPrompt ? (
                <>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-slate-200"
                    rows={3}
                    value={linkPromptDraft}
                    onChange={(e) => setLinkPromptDraft(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
                      onClick={() => {
                        const nextPrompt = linkPromptDraft.trim() || DEFAULT_AI_SUMMARY_PROMPT
                        updateParseSettings({ aiSummaryPrompt: nextPrompt })
                        setIsEditingLinkPrompt(false)
                      }}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                      onClick={() => {
                        setLinkPromptDraft(parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT)
                        setIsEditingLinkPrompt(false)
                      }}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="whitespace-pre-line">{parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT}</div>
                  <button
                    type="button"
                    className="rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors"
                    onClick={() => {
                      setLinkPromptDraft(parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT)
                      setIsEditingLinkPrompt(true)
                    }}
                  >
                    编辑提示词
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-xl bg-[#1a1a1a] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
            <span className="text-sm">✏️</span>
            <span>方式二 · 键入笔记</span>
          </div>
          <textarea
            ref={sourceTextareaRef}
            className="w-full h-52 resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
            placeholder="将原始笔记、会议记录或碎片化想法粘贴在这里..."
            value={sourceText}
            onChange={e => {
              const newValue = e.target.value
              setSourceText(newValue)
              // 实时保存到 localStorage，防止内容丢失
              try {
                if (newValue.trim()) {
                  localStorage.setItem('note_textarea_draft', newValue)
                } else {
                  localStorage.removeItem('note_textarea_draft')
                }
              } catch (error) {
                console.warn('保存文本框草稿失败:', error)
              }
            }}
            onPaste={handlePasteImages}
          />
          {pastedImages.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {pastedImages.map((img, idx) => (
                <div key={idx} className="relative w-24 h-24 rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm group cursor-pointer">
                  <img
                    src={img}
                    alt={`pasted-${idx}`}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-110"
                    onClick={() => {
                      setCurrentImageIndex(idx);
                      setImageViewerOpen(true);
                    }}
                  />
                  <button
                    type="button"
                    className="absolute top-1 right-1 rounded-full bg-white/80 px-2 text-xs text-slate-600 shadow-sm hover:bg-white z-10"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePastedImage(idx);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                checked={parseSettings.textAiSummaryEnabled}
                onChange={(e) => updateParseSettings({ textAiSummaryEnabled: e.target.checked })}
              />
              生成 AI 笔记总结
            </label>
            <button
              type="button"
              onClick={() => setShowTextPromptDetails((prev) => !prev)}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>AI 提示词</span>
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8E0FF] text-slate-700 transition-transform duration-200 ${
                  showTextPromptDetails ? 'rotate-180' : ''
                }`}
              >
                <svg
                  className="h-3.5 w-3.5 text-slate-700"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
          {showTextPromptDetails && (
            <div className="text-xs leading-relaxed text-slate-600 space-y-2">
              {isEditingTextPrompt ? (
                <>
                  <textarea
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                    rows={3}
                    value={textPromptDraft}
                    onChange={(e) => setTextPromptDraft(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
                      onClick={() => {
                        const nextPrompt = textPromptDraft.trim() || DEFAULT_AI_SUMMARY_PROMPT
                        setTextPrompt(nextPrompt)
                        try {
                          window.localStorage.setItem(TEXT_PROMPT_STORAGE_KEY, nextPrompt)
                        } catch (err) {
                          console.warn('无法保存文本解析提示词', err)
                        }
                        setIsEditingTextPrompt(false)
                      }}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                      onClick={() => {
                        setTextPromptDraft(textPrompt)
                        setIsEditingTextPrompt(false)
                      }}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="whitespace-pre-line">{textPrompt || DEFAULT_AI_SUMMARY_PROMPT}</div>
                  <button
                    type="button"
                    className="rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors"
                    onClick={() => {
                      setTextPromptDraft(textPrompt || DEFAULT_AI_SUMMARY_PROMPT)
                      setIsEditingTextPrompt(true)
                    }}
                  >
                    编辑提示词
                  </button>
                </>
              )}
            </div>
          )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={handleAIAssignAndSaveFromText}
                disabled={!sourceText.trim() || loading}
                className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 disabled:cursor-not-allowed disabled:bg-purple-300"
              >
                {loading ? '处理中…' : '仅解析'}
              </button>
              <button
                onClick={handleSaveManualToHistoryFromText}
                disabled={!sourceText.trim() || loading}
                className="rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 disabled:cursor-not-allowed disabled:bg-purple-300"
              >
                {loading ? '保存中…' : '解析并分配'}
              </button>
            </div>
        </div>

        <div className="space-y-2">
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">{error}</div>}
          {successMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-600">{successMessage}</div>}
          {infoMessage && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-600">{infoMessage}</div>}
        </div>
      </div>

      {/* 解析历史区域 */}
      <div className="space-y-4">
        {/* 解析历史标题框 */}
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#1a1a1a] text-white shadow-lg shadow-purple-500/30">
          <h2 className="text-base font-semibold">
            解析历史
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => loadHistory()}
              disabled={loadingHistory}
              className="rounded-lg border border-transparent px-3 py-1.5 text-xs text-slate-800 bg-white hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-green-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="刷新解析历史"
            >
              {loadingHistory ? '刷新中...' : '🔄 刷新'}
            </button>
            {historyList.length > 0 && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-4 h-4 text-green-600 border-green-300 rounded focus:ring-green-500"
                />
                <span className="text-sm text-white">全选</span>
              </label>
            )}
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
              className="rounded-lg border border-transparent px-3 py-1.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              <option value="all">全部</option>
              <option value="解析中">解析中</option>
              <option value="解析成功">解析成功</option>
              <option value="解析失败">解析失败</option>
            </select>
          </div>
        </div>

        {/* 批量操作栏 */}
        {historyList.length > 0 && selectedHistoryIds.size > 0 && (
          <div className="flex items-center justify-end p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-sm text-slate-600 mr-3">
              已选择 {selectedHistoryIds.size} 项
            </span>
            <div className="flex items-center gap-2">
              <select
                onChange={(e) => {
                  const value = e.target.value
                  if (value) {
                    const [notebookId, notebookName] = value.split('|')
                    handleBatchAssignNotebook(notebookId, notebookName)
                    e.target.value = ''
                  }
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                defaultValue=""
              >
                <option value="">批量分配到...</option>
                {availableNotebooks.map(nb => (
                  <option key={nb.notebook_id} value={`${nb.notebook_id}|${nb.name}`}>
                    {nb.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBatchDeleteHistory}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 transition-colors hover:bg-rose-50"
              >
                批量删除
              </button>
            </div>
          </div>
        )}

        <div className="w-full">
          {renderHistoryContent()}
        </div>
      </div>

      {/* 手动移动笔记弹窗 */}
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
                  onChange={(e) => {
                    setManualMoveNotebookId(e.target.value)
                    if (manualMoveError) setManualMoveError(null)
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  disabled={manualMoveLoading}
                >
                  <option value="">请选择笔记本</option>
                  {selectableNotebooks.map((notebook) => (
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

      {/* 编辑历史记录弹窗 */}
      <ParseHistoryEditModal
        history={editingHistory}
        notebooks={availableNotebooks}
        isOpen={!!editingHistory}
        linkAiPrompt={parseSettings.aiSummaryPrompt || DEFAULT_AI_SUMMARY_PROMPT}
        textAiPrompt={textPrompt || DEFAULT_AI_SUMMARY_PROMPT}
        onUpdateLinkPrompt={(next) => {
          const trimmed = next.trim() || DEFAULT_AI_SUMMARY_PROMPT
          updateParseSettings({ aiSummaryPrompt: trimmed })
        }}
        onUpdateTextPrompt={(next) => {
          const trimmed = next.trim() || DEFAULT_AI_SUMMARY_PROMPT
          setTextPrompt(trimmed)
          // 同步保存到 localStorage，保持与 AI 导入页行为一致
          try {
            if (trimmed) {
              window.localStorage.setItem(TEXT_PROMPT_STORAGE_KEY, trimmed)
            } else {
              window.localStorage.removeItem(TEXT_PROMPT_STORAGE_KEY)
            }
          } catch {
            // 忽略本地存储错误
          }
        }}
        onClose={() => setEditingHistory(null)}
        onSave={() => {
          loadHistory()
          setEditingHistory(null)
        }}
      />

      {drafts.length > 0 && (
        <div className="flex flex-col gap-4" data-drafts-section>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">AI 草稿 ({drafts.length})</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onRequestNotebookRefresh?.()}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50"
              >
                刷新笔记本
              </button>
              <button
                onClick={handleSaveAll}
                disabled={drafts.length === 0 || savingAll}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {savingAll ? '保存中…' : '全部保存'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {drafts.map(draft => {
              const notebookSelected = renderedNotebooks.find(nb => nb.notebook_id === draft.targetNotebookId)
              const confidencePercent = `${Math.round(draft.confidence * 100)}%`
              return (
                <div key={draft.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs text-purple-700">
                        置信度 {confidencePercent}（{confidenceLabel(draft.confidence)}）
                      </span>
                      {draft.explanation && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                          {draft.explanation}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {draft.status === 'saved' && <span className="text-sm text-emerald-600">已保存</span>}
                      {draft.status === 'error' && (
                        <span className="text-sm text-rose-600">保存失败：{draft.errorMessage}</span>
                      )}
                      {/* 手动笔记的特殊按钮 */}
                      {draft.id.startsWith('manual_') ? (
                        <>
                          <button
                            onClick={() => handleSaveManualToHistory(draft)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-50"
                            title="仅保存到解析历史，不分配笔记本"
                          >
                            仅保存到历史
                          </button>
                          <button
                            onClick={() => handleAIAssignAndSave(draft)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white bg-[#1a1a1a] hover:bg-[#2b2b2b] shadow-lg shadow-purple-500/30 transition-colors"
                            title="保存到历史并让AI自动分配笔记本"
                          >
                            AI分配并保存
                          </button>
                        </>
                      ) : (
                        <>
                      <button
                        onClick={() => handleRemoveDraft(draft.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        移除
                      </button>
                      <button
                        onClick={() => handleSaveDraft(draft.id)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        disabled={draft.status === 'saving'}
                      >
                        {draft.status === 'saving' ? '保存中…' : '保存'}
                      </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-slate-500">标题</label>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={e => updateDraft(draft.id, d => ({ ...d, title: e.target.value }))}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        placeholder="AI 生成的标题，可自行修改"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-slate-500">保存到笔记本</label>
                      <select
                        value={draft.targetNotebookId || ''}
                        onChange={e => handleNotebookChange(draft.id, e.target.value)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                      >
                        <option value="">请选择笔记本</option>
                        {renderedNotebooks.map(notebook => (
                          <option key={notebook.notebook_id || `nb_${notebook.name}`} value={notebook.notebook_id || ''}>
                            {notebook.name}
                            {typeof notebook.note_count === 'number' ? `（${notebook.note_count}）` : ''}
                          </option>
                        ))}
                      </select>
                      {draft.suggestedNotebookName && (
                        <span className="text-xs text-slate-400">
                          AI 推荐笔记本：{draft.suggestedNotebookName}
                          {draft.suggestedNotebookId ? `（ID: ${draft.suggestedNotebookId}）` : ''}
                        </span>
                      )}
                      {draft.suggestedNewNotebook?.name && (
                        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
                          <div className="font-medium text-amber-800 mb-1">
                            💡 AI建议新建笔记本:
                          </div>
                          <div className="text-amber-700 font-semibold">
                            {draft.suggestedNewNotebook.name}
                          </div>
                          {draft.suggestedNewNotebook.description && (
                            <div className="text-amber-600 mt-1">
                              {draft.suggestedNewNotebook.description}
                            </div>
                          )}
                          {draft.suggestedNewNotebook.reason && (
                            <div className="text-amber-500 mt-1 italic">
                              理由: {draft.suggestedNewNotebook.reason}
                            </div>
                          )}
                        </div>
                      )}
                      {!notebookSelected && (
                        <span className="text-xs text-amber-500">请选择一个笔记本以保存该草稿</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-slate-500">摘要（可选）</label>
                      <textarea
                        value={draft.summary}
                        onChange={e => updateDraft(draft.id, d => ({ ...d, summary: e.target.value }))}
                        rows={3}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        placeholder="一句话总结可用于后续检索"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-slate-500">关键词</label>
                      {draft.topics.length > 0 ? (
                        <div className="flex flex-wrap gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-2">
                          {draft.topics.map(topic => (
                            <span key={topic} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                              {topic}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                          未提取到关键词
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <label className="text-xs font-medium text-slate-500">正文</label>
                    <textarea
                      value={draft.content}
                      onChange={e => updateDraft(draft.id, d => ({ ...d, content: e.target.value }))}
                      rows={8}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 图片查看器 */}
      <ImageViewer
        images={pastedImages}
        currentIndex={currentImageIndex}
        isOpen={imageViewerOpen}
        onClose={() => setImageViewerOpen(false)}
        onNavigate={(newIndex) => setCurrentImageIndex(newIndex)}
      />
    </div>
  )
}
