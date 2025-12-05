import React, { useState, useEffect } from 'react';
import apiClient from '../apiClient';
import { HistoryStatus, normalizeHistoryStatus } from '../utils/parseHistoryStatus';

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
  assigned_notebook_id?: string | null;
  assigned_notebook_name?: string | null;
  status: HistoryStatus;
  notes?: string | null;
  tags?: string | null;
  keywords?: string[] | null;
  parsed_fields?: string | null; // JSON string
  coze_response_data?: string | null; // JSON string
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
  
  // 处理不完整的JSON字符串
  if ((cleaned.startsWith('"') || cleaned.startsWith('{')) && cleaned.includes('":')) {
    const extractedValues: string[] = []
    let pos = 0
    while (pos < cleaned.length) {
      const keyStart = cleaned.indexOf('"', pos)
      if (keyStart === -1) break
      
      let keyEnd = keyStart + 1
      while (keyEnd < cleaned.length) {
        if (cleaned[keyEnd] === '"' && cleaned[keyEnd - 1] !== '\\') {
          break
        }
        keyEnd++
      }
      
      const colonIndex = cleaned.indexOf(':', keyEnd)
      if (colonIndex === -1) break
      
      const valueStart = cleaned.indexOf('"', colonIndex)
      if (valueStart === -1) break
      
      let valueEnd = valueStart + 1
      while (valueEnd < cleaned.length) {
        if (cleaned[valueEnd] === '"' && cleaned[valueEnd - 1] !== '\\') {
          break
        }
        valueEnd++
      }
      
      if (valueEnd > valueStart + 1) {
        const extracted = cleaned.substring(valueStart + 1, valueEnd)
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
        if (extracted.trim()) {
          extractedValues.push(extracted.trim())
        }
      }
      
      pos = valueEnd + 1
    }
    
    if (extractedValues.length > 0) {
      return extractedValues.join('\n\n')
    }
  }
  
  // 处理完整的JSON对象
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned)
      if (typeof parsed === 'object' && parsed !== null) {
        const values = Object.values(parsed).filter(v => v && typeof v === 'string' && v.trim())
        if (values.length > 0) {
          return values.join('\n\n')
        }
      }
    } catch {
      // 如果解析失败，继续后续处理
    }
  }
  
  // 处理转义字符
  cleaned = cleaned
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
  
  // 移除多余的引号
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1)
  }
  
  return cleaned.trim()
}

interface NotebookOption {
  notebook_id: string | null;
  name: string;
  description?: string | null;
}

interface ParseHistoryEditModalProps {
  history: ParseHistory | null;
  notebooks: NotebookOption[];
  isOpen: boolean;
  linkAiPrompt?: string;
  textAiPrompt?: string;
  onClose: () => void;
  onSave: () => void;
  onUpdateLinkPrompt?: (next: string) => void;
  onUpdateTextPrompt?: (next: string) => void;
}

// 按北京时间格式化为字符串：YYYY-MM-DD HH:mm
const formatBeijingDateTime = (date: Date) => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hour = pad(now.getHours());
  const minute = pad(now.getMinutes());

  return `${year}-${month}-${day} ${hour}:${minute}`;
};

// 获取当前北京时间字符串：YYYY-MM-DD HH:mm
const getBeijingNowString = () => formatBeijingDateTime(new Date());

// 将任意时间字符串转换为用于展示的北京时间字符串：YYYY-MM-DD HH:mm
const toBeijingDisplayValue = (value: string) => {
  if (!value) return getBeijingNowString();

  // 如果本身已经是类似 "2025-12-04 11:03" 的格式，直接返回
  if (value.includes(' ') && !value.includes('T')) {
    return value;
  }

  // 如果是 ISO / 带 T 的格式，解析后再格式化
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return getBeijingNowString();
    return formatBeijingDateTime(date);
  } catch {
    return getBeijingNowString();
  }
};

const ParseHistoryEditModal: React.FC<ParseHistoryEditModalProps> = ({
  history,
  notebooks,
  isOpen,
  onClose,
  onSave,
  linkAiPrompt,
  textAiPrompt,
  onUpdateLinkPrompt,
  onUpdateTextPrompt
}) => {
  const [assignedNotebookId, setAssignedNotebookId] = useState<string>('');
  const [status, setStatus] = useState<HistoryStatus>('解析中');
  const [notes, setNotes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 可编辑字段状态
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [publishedAt, setPublishedAt] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [link, setLink] = useState<string>('');
  const [imgUrls, setImgUrls] = useState<string[]>([]);
  const [sourcePlatform, setSourcePlatform] = useState<string>('');
  const [noteType, setNoteType] = useState<string>('');
  const [keywords, setKeywords] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  // AI 摘要提示词（与 AI 导入页同步）
  const [linkPromptValue, setLinkPromptValue] = useState<string>(linkAiPrompt || '');
  const [textPromptValue, setTextPromptValue] = useState<string>(textAiPrompt || '');

  // 当外部提示词变化时，同步到弹窗本地状态
  useEffect(() => {
    setLinkPromptValue(linkAiPrompt || '');
  }, [linkAiPrompt]);

  useEffect(() => {
    setTextPromptValue(textAiPrompt || '');
  }, [textAiPrompt]);

  useEffect(() => {
    if (history) {
      console.log('🔍 ParseHistoryEditModal 接收到的 history 数据:', history);
      console.log('🔍 parsed_fields (原始):', history.parsed_fields);
      console.log('🔍 parsed_img_urls:', history.parsed_img_urls);
      console.log('🔍 parsed_note_type:', history.parsed_note_type);
      
      setAssignedNotebookId(history.assigned_notebook_id || '');
      setStatus(normalizeHistoryStatus(history.status));
      setNotes(history.notes || '');
      
      // 解析 parsed_fields
      let parsedFields: Record<string, any> = {};
      if (history.parsed_fields) {
        try {
          parsedFields = typeof history.parsed_fields === 'string' 
            ? JSON.parse(history.parsed_fields) 
            : history.parsed_fields;
          console.log('🔍 解析后的 parsedFields:', parsedFields);
          console.log('🔍 parsedFields 的所有键:', Object.keys(parsedFields));
          // 详细输出每个字段的值（只输出前200字符，避免日志过长）
          Object.keys(parsedFields).forEach(key => {
            const value = parsedFields[key];
            if (typeof value === 'string') {
              console.log(`  - ${key}:`, value.length > 200 ? value.substring(0, 200) + '...' : value);
            } else {
              console.log(`  - ${key}:`, value);
            }
          });
        } catch (e) {
          console.error('❌ 解析 parsed_fields 失败:', e, history.parsed_fields);
        }
      } else {
        console.warn('⚠️ parsed_fields 为空或未定义');
      }
      
      // 输出 parsed_content 的详细信息
      console.log('🔍 history.parsed_content 详情:');
      console.log('  - 是否存在:', !!history.parsed_content);
      console.log('  - 类型:', typeof history.parsed_content);
      console.log('  - 长度:', history.parsed_content?.length || 0);
      if (history.parsed_content) {
        console.log('  - 内容预览:', history.parsed_content.substring(0, 200));
      }
      
      // 尝试从 coze_response_data 中提取数据
      if (history.coze_response_data) {
        console.log('🔍 尝试从 coze_response_data 中提取数据:');
        try {
          const cozeData = typeof history.coze_response_data === 'string' 
            ? JSON.parse(history.coze_response_data) 
            : history.coze_response_data;
          
          console.log('  - coze_response_data 类型:', typeof cozeData);
          console.log('  - coze_response_data 键:', Object.keys(cozeData || {}));
          
          // 首先检查 coze_response_data 顶层是否直接包含结构化数据（如用户提供的格式）
          // 如果顶层直接包含 title、content 等字段，说明数据是直接返回的，不是嵌套的
          const hasTopLevelFields = cozeData && typeof cozeData === 'object' && (
            (cozeData.title && typeof cozeData.title === 'string') ||
            (cozeData.content && typeof cozeData.content === 'string') ||
            (cozeData.summary && typeof cozeData.summary === 'string')
          );
          
          if (hasTopLevelFields && !cozeData.structured_article && !cozeData.structured_ai_analysis) {
            console.log('  - 检测到顶层直接包含结构化数据，尝试提取');
            console.log('    - title:', cozeData.title);
            console.log('    - content 长度:', cozeData.content?.length || 0);
            console.log('    - summary:', cozeData.summary);
            console.log('    - author:', cozeData.author);
            console.log('    - published_at:', cozeData.published_at);
            console.log('    - keywords:', cozeData.keywords);
            console.log('    - img_urls:', cozeData.img_urls);
            console.log('    - source_platform:', cozeData.source_platform);
            console.log('    - note_type:', cozeData.note_type);
            
            // 从顶层直接提取所有字段
            if (!parsedFields.title && cozeData.title) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 title:', cozeData.title);
              parsedFields.title = cozeData.title;
            }
            if (!parsedFields.content && cozeData.content && typeof cozeData.content === 'string' && cozeData.content.trim()) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 content，长度:', cozeData.content.length);
              parsedFields.content = cozeData.content;
            }
            if (!parsedFields.summary && cozeData.summary) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 summary:', cozeData.summary);
              parsedFields.summary = cozeData.summary;
            }
            if (!parsedFields.author && cozeData.author) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 author:', cozeData.author);
              parsedFields.author = cozeData.author;
            }
            if (!parsedFields.published_at && cozeData.published_at) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 published_at:', cozeData.published_at);
              parsedFields.published_at = cozeData.published_at;
            }
            if (!parsedFields.keywords && Array.isArray(cozeData.keywords) && cozeData.keywords.length > 0) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 keywords:', cozeData.keywords);
              parsedFields.keywords = cozeData.keywords;
            }
            if (!parsedFields.img_urls && Array.isArray(cozeData.img_urls) && cozeData.img_urls.length > 0) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 img_urls:', cozeData.img_urls);
              parsedFields.img_urls = cozeData.img_urls;
            }
            if (!parsedFields.source_platform && cozeData.source_platform) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 source_platform:', cozeData.source_platform);
              parsedFields.source_platform = cozeData.source_platform;
            }
            if (!parsedFields.note_type && cozeData.note_type) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 note_type:', cozeData.note_type);
              parsedFields.note_type = cozeData.note_type;
            }
            if (!parsedFields.link && cozeData.link) {
              console.log('  ✅ 从 coze_response_data 顶层提取到 link:', cozeData.link);
              parsedFields.link = cozeData.link;
            }
          }
          
          // 检查 coze_response_data.content（直接的内容字段）
          if (cozeData.content) {
            console.log('  - coze_response_data.content 存在');
            console.log('    - content 类型:', typeof cozeData.content);
            console.log('    - content 是否为数组:', Array.isArray(cozeData.content));
            console.log('    - content 值:', cozeData.content);
            
            // 如果 content 是数组，尝试从数组中提取文本内容
            if (Array.isArray(cozeData.content)) {
              console.log('    - content 是数组，长度:', cozeData.content.length);
              // 尝试从数组中提取文本内容
              const textParts: string[] = [];
              cozeData.content.forEach((item: any, index: number) => {
                if (typeof item === 'string') {
                  textParts.push(item);
                } else if (item && typeof item === 'object') {
                  // 如果是对象，尝试提取 text 或 content 字段
                  if (item.text) textParts.push(item.text);
                  if (item.content) textParts.push(item.content);
                  if (item.body) textParts.push(item.body);
                  // 如果是事件对象，尝试提取 data.content
                  if (item.data && item.data.content) {
                    if (typeof item.data.content === 'string') {
                      textParts.push(item.data.content);
                    } else if (typeof item.data.content === 'object') {
                      // 尝试解析 JSON
                      try {
                        const parsed = typeof item.data.content === 'string' 
                          ? JSON.parse(item.data.content) 
                          : item.data.content;
                        if (parsed && typeof parsed === 'object') {
                          if (parsed.content) textParts.push(parsed.content);
                          if (parsed.body) textParts.push(parsed.body);
                          if (parsed.text) textParts.push(parsed.text);
                        }
                      } catch (e) {
                        // 忽略解析错误
                      }
                    }
                  }
                }
              });
              const combinedContent = textParts.join('\n').trim();
              if (combinedContent && !parsedFields.content) {
                console.log('  ✅ 从 coze_response_data.content 数组中提取到 content，长度:', combinedContent.length);
                parsedFields.content = combinedContent;
              }
            }
            // 如果 content 是字符串，直接使用
            else if (typeof cozeData.content === 'string' && cozeData.content.trim()) {
              if (!parsedFields.content) {
                console.log('  ✅ 从 coze_response_data.content 中提取到 content，长度:', cozeData.content.length);
                parsedFields.content = cozeData.content;
              }
            }
            // 如果 content 是对象，尝试提取其中的字段
            else if (typeof cozeData.content === 'object' && cozeData.content !== null) {
              console.log('    - content 对象键:', Object.keys(cozeData.content));
              const contentObj = cozeData.content;
              if (!parsedFields.title && contentObj.title) {
                console.log('  ✅ 从 coze_response_data.content 中提取到 title:', contentObj.title);
                parsedFields.title = contentObj.title;
              }
              if (!parsedFields.content && contentObj.content) {
                console.log('  ✅ 从 coze_response_data.content 中提取到 content，长度:', contentObj.content.length);
                parsedFields.content = contentObj.content;
              }
              if (!parsedFields.content && contentObj.body) {
                console.log('  ✅ 从 coze_response_data.content 中提取到 body，长度:', contentObj.body.length);
                parsedFields.content = contentObj.body;
              }
              if (!parsedFields.summary && contentObj.summary) {
                console.log('  ✅ 从 coze_response_data.content 中提取到 summary:', contentObj.summary);
                parsedFields.summary = contentObj.summary;
              }
            }
          }
          
          // 检查 structured_ai_analysis
          if (cozeData.structured_ai_analysis) {
            console.log('  - structured_ai_analysis 存在');
            console.log('    - structured_ai_analysis 类型:', typeof cozeData.structured_ai_analysis);
            if (typeof cozeData.structured_ai_analysis === 'object' && cozeData.structured_ai_analysis !== null) {
              const analysis = cozeData.structured_ai_analysis;
              console.log('    - structured_ai_analysis 键:', Object.keys(analysis));
              
              if (!parsedFields.title && analysis.title) {
                console.log('  ✅ 从 structured_ai_analysis 中提取到 title:', analysis.title);
                parsedFields.title = analysis.title;
              }
              if (!parsedFields.content && analysis.content) {
                console.log('  ✅ 从 structured_ai_analysis 中提取到 content，长度:', analysis.content.length);
                parsedFields.content = analysis.content;
              }
              if (!parsedFields.content && analysis.body) {
                console.log('  ✅ 从 structured_ai_analysis 中提取到 body，长度:', analysis.body.length);
                parsedFields.content = analysis.body;
              }
              if (!parsedFields.summary && analysis.summary) {
                console.log('  ✅ 从 structured_ai_analysis 中提取到 summary:', analysis.summary);
                parsedFields.summary = analysis.summary;
              }
            }
          }
          
          // 检查 structured_article
          if (cozeData.structured_article) {
            console.log('  - structured_article 存在:', Object.keys(cozeData.structured_article));
            const sa = cozeData.structured_article;
            console.log('    - title:', sa.title);
            console.log('    - content 长度:', sa.content?.length || 0);
            console.log('    - summary:', sa.summary);
            console.log('    - link:', sa.link);
            console.log('    - source_url:', sa.source_url);
            
            // 如果 parsedFields 中的字段都是空的，尝试从 structured_article 中提取
            if (!parsedFields.title && sa.title) {
              console.log('  ✅ 从 structured_article 中提取到 title:', sa.title);
              parsedFields.title = sa.title;
            }
            if (!parsedFields.content && sa.content && sa.content.trim()) {
              console.log('  ✅ 从 structured_article 中提取到 content，长度:', sa.content.length);
              parsedFields.content = sa.content;
            }
            if (!parsedFields.summary && sa.summary) {
              console.log('  ✅ 从 structured_article 中提取到 summary:', sa.summary);
              parsedFields.summary = sa.summary;
            }
          }
          
          // 检查 events 数组（直接的事件数组）
          if (cozeData.events && Array.isArray(cozeData.events)) {
            console.log('  - 检查 coze_response_data.events，数量:', cozeData.events.length);
            cozeData.events.forEach((event: any, index: number) => {
              if (event && typeof event === 'object') {
                // 检查 event.data.content
                if (event.data && event.data.content) {
                  console.log(`  - 找到事件 #${index} 的 data.content:`, typeof event.data.content);
                  try {
                    let answerContent = event.data.content;
                    // 如果是字符串，尝试解析为 JSON
                    if (typeof answerContent === 'string') {
                      try {
                        answerContent = JSON.parse(answerContent);
                      } catch (e) {
                        // 不是 JSON，直接使用字符串
                        if (!parsedFields.content && answerContent.trim()) {
                          console.log('  ✅ 从 events[].data.content 中提取到 content（字符串），长度:', answerContent.length);
                          parsedFields.content = answerContent;
                        }
                        return;
                      }
                    }
                    
                    if (answerContent && typeof answerContent === 'object') {
                      console.log('    - answerContent 键:', Object.keys(answerContent));
                      console.log('    - answerContent.title:', answerContent.title);
                      console.log('    - answerContent.content 长度:', answerContent.content?.length || 0);
                      
                      // 如果 parsedFields 中的字段都是空的，尝试从 answerContent 中提取
                      if (!parsedFields.title && answerContent.title) {
                        console.log('  ✅ 从 events[].data.content 中提取到 title:', answerContent.title);
                        parsedFields.title = answerContent.title;
                      }
                      if (!parsedFields.content && answerContent.content) {
                        const content = Array.isArray(answerContent.content) 
                          ? answerContent.content.join('\n') 
                          : answerContent.content;
                        if (typeof content === 'string' && content.trim()) {
                          console.log('  ✅ 从 events[].data.content 中提取到 content，长度:', content.length);
                          parsedFields.content = content;
                        }
                      }
                      if (!parsedFields.summary && answerContent.summary) {
                        console.log('  ✅ 从 events[].data.content 中提取到 summary:', answerContent.summary);
                        parsedFields.summary = answerContent.summary;
                      }
                    }
                  } catch (e) {
                    console.log('    - 解析 events[].data.content 失败:', e);
                  }
                }
                // 检查 event.content（直接的内容字段）
                if (event.content && !parsedFields.content) {
                  const eventContent = typeof event.content === 'string' 
                    ? event.content 
                    : (Array.isArray(event.content) ? event.content.join('\n') : String(event.content));
                  if (eventContent.trim()) {
                    console.log(`  ✅ 从 events[${index}].content 中提取到 content，长度:`, eventContent.length);
                    parsedFields.content = eventContent;
                  }
                }
              }
            });
          }
          
          // 检查 raw.entries（后端提取的条目）
          if (cozeData.raw && cozeData.raw.entries && Array.isArray(cozeData.raw.entries)) {
            console.log('  - 检查 raw.entries，数量:', cozeData.raw.entries.length);
            cozeData.raw.entries.forEach((entry: any, index: number) => {
              if (entry && entry.parsed) {
                const parsed = entry.parsed;
                console.log(`  - 找到 entry #${index} 的 parsed:`, typeof parsed);
                if (typeof parsed === 'object' && parsed !== null) {
                  if (!parsedFields.title && parsed.title) {
                    console.log('  ✅ 从 raw.entries[].parsed 中提取到 title:', parsed.title);
                    parsedFields.title = parsed.title;
                  }
                  if (!parsedFields.content && parsed.content) {
                    const content = Array.isArray(parsed.content) 
                      ? parsed.content.join('\n') 
                      : parsed.content;
                    if (typeof content === 'string' && content.trim()) {
                      console.log('  ✅ 从 raw.entries[].parsed 中提取到 content，长度:', content.length);
                      parsedFields.content = content;
                    }
                  }
                  if (!parsedFields.summary && parsed.summary) {
                    console.log('  ✅ 从 raw.entries[].parsed 中提取到 summary:', parsed.summary);
                    parsedFields.summary = parsed.summary;
                  }
                } else if (typeof parsed === 'string' && parsed.trim() && !parsedFields.content) {
                  console.log('  ✅ 从 raw.entries[].parsed 中提取到 content（字符串），长度:', parsed.length);
                  parsedFields.content = parsed;
                }
              }
            });
          }
          
          // 检查 combinedText（后端合并的文本）
          if (cozeData.raw && cozeData.raw.combinedText && !parsedFields.content) {
            const combinedText = cozeData.raw.combinedText;
            if (typeof combinedText === 'string' && combinedText.trim()) {
              console.log('  ✅ 从 raw.combinedText 中提取到 content，长度:', combinedText.length);
              parsedFields.content = combinedText;
            }
          }
          
          // 检查 primaryAnswer（可能在顶层）
          if (cozeData.primaryAnswer && typeof cozeData.primaryAnswer === 'object' && !parsedFields.content) {
            console.log('  - 检查 primaryAnswer（顶层）');
            const primary = cozeData.primaryAnswer;
            if (!parsedFields.title && primary.title) {
              console.log('  ✅ 从 primaryAnswer 中提取到 title:', primary.title);
              parsedFields.title = primary.title;
            }
            if (!parsedFields.content && primary.content) {
              const content = Array.isArray(primary.content) 
                ? primary.content.join('\n') 
                : primary.content;
              if (typeof content === 'string' && content.trim()) {
                console.log('  ✅ 从 primaryAnswer 中提取到 content，长度:', content.length);
                parsedFields.content = content;
              }
            }
            if (!parsedFields.summary && primary.summary) {
              console.log('  ✅ 从 primaryAnswer 中提取到 summary:', primary.summary);
              parsedFields.summary = primary.summary;
            }
          }
          
          // 检查 primaryAnswer（可能在 entries 中）
          if (cozeData.raw && cozeData.raw.events) {
            console.log('  - 检查 raw.events，数量:', cozeData.raw.events.length);
            cozeData.raw.events.forEach((event: any, index: number) => {
              if (event.data && event.data.type === 'answer' && event.data.content) {
                console.log(`  - 找到 answer 事件 #${index}:`, typeof event.data.content);
                try {
                  const answerContent = typeof event.data.content === 'string' 
                    ? JSON.parse(event.data.content) 
                    : event.data.content;
                  if (answerContent && typeof answerContent === 'object') {
                    console.log('    - answerContent 键:', Object.keys(answerContent));
                    console.log('    - answerContent.title:', answerContent.title);
                    console.log('    - answerContent.content 长度:', answerContent.content?.length || 0);
                    
                    // 如果 parsedFields 中的字段都是空的，尝试从 answerContent 中提取
                    if (!parsedFields.title && answerContent.title) {
                      console.log('  ✅ 从 answerContent 中提取到 title:', answerContent.title);
                      parsedFields.title = answerContent.title;
                    }
                    if (!parsedFields.content && answerContent.content) {
                      const content = Array.isArray(answerContent.content) 
                        ? answerContent.content.join('\n') 
                        : answerContent.content;
                      if (typeof content === 'string' && content.trim()) {
                        console.log('  ✅ 从 answerContent 中提取到 content，长度:', content.length);
                        parsedFields.content = content;
                      }
                    }
                    if (!parsedFields.summary && answerContent.summary) {
                      console.log('  ✅ 从 answerContent 中提取到 summary:', answerContent.summary);
                      parsedFields.summary = answerContent.summary;
                    }
                  }
                } catch (e) {
                  console.log('    - 解析 answerContent 失败:', e);
                }
              }
            });
          }
        } catch (e) {
          console.error('❌ 解析 coze_response_data 失败:', e);
        }
      } else {
        console.warn('⚠️ coze_response_data 为空或未定义');
      }
      
      // 按照用户要求的字段映射填充各个字段（优先使用 parsed_fields）
      // Title - 短文本组件
      const titleValue = parsedFields.title || history.parsed_title || '';
      console.log('🔍 提取 title:', titleValue);
      setTitle(titleValue);
      
      // content - 长文本组件
      // 尝试多种可能的字段名来获取内容
      const rawContentValue = 
        parsedFields.content || 
        parsedFields.body || 
        parsedFields.text || 
        parsedFields.article_content ||
        parsedFields.articleContent ||
        parsedFields.main_content ||
        parsedFields.mainContent ||
        history.parsed_content || 
        '';
      
      console.log('🔍 尝试提取 content:');
      console.log('  - parsedFields.content:', parsedFields.content);
      console.log('  - parsedFields.body:', parsedFields.body);
      console.log('  - parsedFields.text:', parsedFields.text);
      console.log('  - history.parsed_content:', history.parsed_content);
      console.log('  - 最终 rawContentValue 长度:', rawContentValue?.length || 0);
      
      // 过滤掉占位符文本
      const placeholderTexts = [
        '解析中或解析失败，请稍后查看结果',
        '解析失败',
        '解析中',
        '对话仍在处理中',
        '未成功提取',
        '请检查链接是否有效'
      ];
      
      let contentValue = rawContentValue || '';
      if (contentValue && placeholderTexts.some(placeholder => contentValue.includes(placeholder))) {
        console.log('⚠️ 检测到占位符文本，清空内容');
        contentValue = '';
      }
      
      console.log('🔍 最终 content 长度:', contentValue.length);
      console.log('🔍 最终 content 预览:', contentValue.substring(0, 100));
      setContent(contentValue);
      
      // summary - 长文本组件
      const summaryValue = parsedFields.summary || history.parsed_summary || '';
      console.log('🔍 提取 summary:', summaryValue);
      setSummary(summaryValue);
      
      // published_at / 创建时间 - 日期组件（统一展示为北京时间字符串）
      const publishedAtValue = parsedFields.published_at || history.parsed_published_at || '';
      console.log('🔍 提取 published_at:', publishedAtValue);
      // 转换为 YYYY-MM-DD HH:mm 格式；如果没有时间，则默认使用当前北京时间
      setPublishedAt(toBeijingDisplayValue(publishedAtValue || ''));
      
      // author - 短文本组件
      const authorValue = parsedFields.author || history.parsed_author || '';
      console.log('🔍 提取 author:', authorValue);
      setAuthor(authorValue);
      
      // link - 短文本组件
      const linkValue = parsedFields.link || parsedFields.source_url || history.source_url || '';
      console.log('🔍 提取 link:', linkValue);
      setLink(linkValue);
      
      // img_urls - 图片组件
      let imgUrlsValue: string[] = [];
      if (Array.isArray(parsedFields.img_urls)) {
        imgUrlsValue = parsedFields.img_urls.filter(url => url && typeof url === 'string' && url.trim());
      } else if (Array.isArray(history.parsed_img_urls) && history.parsed_img_urls.length > 0) {
        imgUrlsValue = history.parsed_img_urls;
      }
      console.log('🔍 提取 img_urls:', imgUrlsValue);
      setImgUrls(imgUrlsValue);
      
      // source_platform - 短文本组件
      const sourcePlatformValue = parsedFields.source_platform || parsedFields.platform || history.parsed_platform || '';
      console.log('🔍 提取 source_platform:', sourcePlatformValue);
      setSourcePlatform(sourcePlatformValue);
      
      // note_type - 短文本组件
      const noteTypeValue = parsedFields.note_type || history.parsed_note_type || '';
      console.log('🔍 提取 note_type:', noteTypeValue);
      setNoteType(noteTypeValue);
      
      // keywords - 短文本组件
      let keywordsValue = '';
      if (Array.isArray(parsedFields.keywords) && parsedFields.keywords.length > 0) {
        keywordsValue = parsedFields.keywords.map(k => String(k).trim()).filter(Boolean).join(', ');
      } else if (history.keywords && Array.isArray(history.keywords) && history.keywords.length > 0) {
        keywordsValue = history.keywords.map(k => String(k).trim()).filter(Boolean).join(', ');
      } else if (history.tags) {
        const parsedTags = parseKeywords(history.tags);
        if (parsedTags.length > 0) {
          keywordsValue = parsedTags.join(', ');
        }
      }
      console.log('🔍 提取 keywords:', keywordsValue);
      setKeywords(keywordsValue);
    }
  }, [history]);

  if (!isOpen || !history) return null;

  const normalizedSourcePlatform = sourcePlatform.trim();

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const selectedNotebook = notebooks.find(nb => nb.notebook_id === assignedNotebookId);
      
      // 构建 parsed_fields 对象，包含所有字段
      const parsedFields = {
        title: title.trim() || null,
        content: content.trim() || null,
        summary: summary.trim() || null,
        published_at: publishedAt.trim() || null,
        author: author.trim() || null,
        link: link.trim() || null,
        img_urls: imgUrls.filter(url => url.trim()),
        source_platform: normalizedSourcePlatform || null,
        note_type: noteType.trim() || null,
        keywords: keywords.split(',').map(k => k.trim()).filter(Boolean)
      };
      
      await apiClient.put(`/api/coze/parse-history/${history.id}`, {
        assigned_notebook_id: assignedNotebookId || null,
        assigned_notebook_name: selectedNotebook?.name || null,
        status: status,
        notes: notes || null,
        parsed_content: content || null,
        parsed_fields: JSON.stringify(parsedFields),
        // 同时更新单独的字段（向后兼容）
        parsed_title: title || null,
        parsed_summary: summary || null,
        parsed_author: author || null,
        parsed_published_at: publishedAt || null,
        parsed_img_urls: imgUrls.filter(url => url.trim()),
        parsed_note_type: noteType || null,
        parsed_platform: normalizedSourcePlatform || null
      });

      onSave();
      onClose();
    } catch (err: any) {
      console.error('更新历史记录失败:', err);
      setError(err.response?.data?.error || err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">编辑解析历史</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 源URL */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">文章链接</label>
            <a
              href={history.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline break-all"
            >
              {history.source_url}
            </a>
          </div>

          {/* 标题 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入标题..."
            />
                </div>

          {/* 链接 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">链接</label>
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入链接..."
            />
              </div>

          {/* 来源平台 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">来源平台</label>
            <input
              type="text"
              value={sourcePlatform}
              onChange={(e) => setSourcePlatform(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入来源平台..."
            />
          </div>

          {/* 作者 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">作者</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入作者..."
            />
            </div>

          {/* 创建时间 */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">创建时间（北京时间）</label>
            <input
              type="text"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value ? e.target.value : '')}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
            />
            <p className="mt-1 text-xs text-slate-400">格式示例：2025-12-04 11:03（北京时间）</p>
            </div>

          {/* 笔记类型 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">笔记类型</label>
            <input
              type="text"
              value={noteType}
              onChange={(e) => setNoteType(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入笔记类型..."
            />
          </div>

          {/* 图片URLs */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">图片URLs</label>
            <div className="space-y-2">
              {imgUrls.map((url, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const newUrls = [...imgUrls];
                        newUrls[index] = e.target.value;
                        setImgUrls(newUrls);
                      }}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                      placeholder="输入图片URL..."
                    />
                    <button
                      onClick={() => setImgUrls(imgUrls.filter((_, i) => i !== index))}
                      className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                  {url && (
                    <div className="w-full h-32 bg-slate-100 rounded-lg overflow-hidden">
                      <img
                        src={url}
                        alt={`预览 ${index + 1}`}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              <button
                onClick={() => setImgUrls([...imgUrls, ''])}
                className="w-full px-3 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg border border-purple-200 transition-colors"
              >
                + 添加图片URL
              </button>
            </div>
          </div>

          {/* 关键词 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">关键词</label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="输入关键词，用逗号分隔..."
            />
            {keywords && (
              <div className="mt-2 flex flex-wrap gap-2">
                {keywords.split(',').map((kw, i) => kw.trim() && (
                  <span key={i} className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                    {kw.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 摘要 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">摘要</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-y"
              placeholder="输入摘要..."
            />
          </div>

          {/* AI 摘要提示词（与 AI 导入页同步） */}
          <div className="pt-1">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              AI 摘要提示词（与「AI 导入笔记」中的设置同步）
            </label>
            <textarea
              value={linkPromptValue}
              onChange={(e) => setLinkPromptValue(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-y"
              placeholder="编辑用于生成 AI 摘要的提示词，例如：请根据文章内容生成不超过 5 条的要点摘要……"
            />
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              <button
                type="button"
                className="inline-flex items-center rounded-lg bg-[#1a1a1a] px-3 py-1.5 font-medium text-white shadow-sm shadow-purple-500/30 hover:bg-black"
                onClick={() => {
                  const next = linkPromptValue.trim();
                  if (next) {
                    // 同步到外部：链接解析提示词
                    onUpdateLinkPrompt?.(next);
                    // 也同步到文本模式，保证两种 AI 摘要保持一致
                    onUpdateTextPrompt?.(next);
                  }
                }}
              >
                同步到 AI 导入设置
              </button>
              <span>修改后，下次在「AI 导入笔记」或重新生成摘要时，会使用新的提示词。</span>
            </div>
          </div>

          {/* AI推荐笔记本 */}
          {history.suggested_notebook_name && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">AI推荐笔记本</label>
              <div className="text-sm text-slate-600 bg-purple-50 px-3 py-2 rounded-lg">
                {history.suggested_notebook_name}
                {history.suggested_notebook_id && ` (ID: ${history.suggested_notebook_id})`}
              </div>
            </div>
          )}

          {/* 分配笔记本 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">分配到笔记本</label>
            <select
              value={assignedNotebookId}
              onChange={(e) => setAssignedNotebookId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
            >
              <option value="">未分配</option>
              {notebooks.map(nb => (
                <option key={nb.notebook_id || `nb_${nb.name}`} value={nb.notebook_id || ''}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          {/* 状态 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(normalizeHistoryStatus(e.target.value))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
            >
              <option value="解析中">解析中</option>
              <option value="解析成功">解析成功</option>
              <option value="解析失败">解析失败</option>
            </select>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">备注</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
              placeholder="添加备注信息..."
            />
          </div>

          {/* 解析内容 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              内容
              {history.assigned_notebook_id && (
                <span className="ml-2 text-xs text-purple-600 font-normal">
                  (编辑后保存将同步到分配的笔记本)
                </span>
              )}
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={Math.min(30, Math.max(8, Math.ceil((content || '').length / 80)))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-y"
              style={{ minHeight: '200px' }}
              placeholder="输入内容..."
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParseHistoryEditModal;
