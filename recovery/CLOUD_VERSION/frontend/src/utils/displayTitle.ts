export interface NoteLike {
  title?: string;
  content?: string;
  content_text?: string;
  component_instances?: Array<{ id: string; type: string; title?: string; content?: string }>;
  component_data?: Record<string, any>;
}

function extractFirstSentence(text: string): string {
  if (!text) return '';
  const separators = /[。！？.!?\n]/;
  const first = text.split(separators)[0] || '';
  return first.trim();
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}

export function getDisplayTitle(note: NoteLike, maxLen: number = 20): string {
  if (!note) return '';
  
  // 优先查找标题组件
  const titleInstance = (note.component_instances || []).find(ci => {
    const title = (ci.title || '').toLowerCase();
    const id = (ci.id || '').toLowerCase();
    const dataMapping = (ci as any).dataMapping || {};
    const source = ((dataMapping.source || '') + '').toLowerCase();
    return title.includes('标题') || id.includes('title') || source === 'title';
  });
  
  if (titleInstance) {
    const dataEntry = note.component_data ? note.component_data[titleInstance.id] : undefined;
    const value = typeof dataEntry?.value === 'string' ? dataEntry.value : (titleInstance.content || '');
    if (value && value.trim()) {
      return truncate(value.trim(), maxLen);
    }
  }
  
  // 如果没有找到标题组件，再找第一个 text-short 组件（但排除关键词等特定组件）
  const shortInstance = (note.component_instances || []).find(ci => {
    if (ci.type !== 'text-short') return false;
    const title = (ci.title || '').toLowerCase();
    const id = (ci.id || '').toLowerCase();
    // 排除关键词、笔记类型等组件
    if (title.includes('关键词') || title.includes('keywords') || 
        title.includes('笔记类型') || title.includes('note_type')) {
      return false;
    }
    return true;
  });
  
  if (shortInstance) {
    const dataEntry = note.component_data ? note.component_data[shortInstance.id] : undefined;
    const value = typeof dataEntry?.value === 'string' ? dataEntry.value : (shortInstance.content || '');
    if (value && value.trim()) {
      const sentence = extractFirstSentence(value);
      if (sentence) return truncate(sentence, maxLen);
    }
  }

  // If component_instances are not present (e.g., notes list), try to find a text-short entry directly in component_data
  if (!shortInstance && note.component_data) {
    for (const key of Object.keys(note.component_data)) {
      const entry = note.component_data[key];
      const entryType = typeof entry?.type === 'string' ? entry.type : '';
      const entryValue = typeof entry?.value === 'string' ? entry.value : '';
      if (entryType === 'text-short' && entryValue) {
        const sentence = extractFirstSentence(entryValue);
        if (sentence) return truncate(sentence, maxLen);
      }
    }
  }

  const fromContentText = extractFirstSentence(note.content_text || '');
  if (fromContentText) return truncate(fromContentText, maxLen);

  const fromContent = extractFirstSentence(note.content || '');
  if (fromContent) return truncate(fromContent, maxLen);

  return truncate(note.title || '', maxLen);
}

