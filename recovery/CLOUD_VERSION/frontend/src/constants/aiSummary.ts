export const DEFAULT_AI_SUMMARY_PROMPT =
  '请将内容整理为不超过5条的要点，突出文章核心信息，使用简洁的中文有序列表输出。';

export const PARSE_SETTINGS_STORAGE_KEY = 'ai_parse_settings_v1';
export const TEXT_PROMPT_STORAGE_KEY = 'ai_parse_text_prompt_v1';

export type ParseSettingsStorage = {
  aiSummaryEnabled?: boolean;
  linkAiSummaryEnabled?: boolean;
  textAiSummaryEnabled?: boolean;
  aiSummaryPrompt?: string;
  syncToNotebookTemplate?: boolean;
  [key: string]: unknown;
};

export const readParseSettingsStorage = (): ParseSettingsStorage => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = window.localStorage.getItem(PARSE_SETTINGS_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === 'object' ? (parsed as ParseSettingsStorage) : {};
  } catch {
    return {};
  }
};

export const readLinkPrompt = (): string => {
  const parsed = readParseSettingsStorage();
  const prompt =
    typeof parsed?.aiSummaryPrompt === 'string' && parsed.aiSummaryPrompt.trim()
      ? parsed.aiSummaryPrompt.trim()
      : DEFAULT_AI_SUMMARY_PROMPT;
  return prompt;
};

export const writeLinkPrompt = (nextPrompt: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = (nextPrompt || '').trim() || DEFAULT_AI_SUMMARY_PROMPT;
  try {
    const current = readParseSettingsStorage();
    window.localStorage.setItem(
      PARSE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...current,
        aiSummaryPrompt: trimmed
      })
    );
  } catch {
    // ignore
  }
};

export const readTextPrompt = (): string => {
  if (typeof window === 'undefined') return DEFAULT_AI_SUMMARY_PROMPT;
  try {
    const stored = window.localStorage.getItem(TEXT_PROMPT_STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : DEFAULT_AI_SUMMARY_PROMPT;
  } catch {
    return DEFAULT_AI_SUMMARY_PROMPT;
  }
};

export const writeTextPrompt = (nextPrompt: string) => {
  if (typeof window === 'undefined') return;
  const trimmed = (nextPrompt || '').trim() || DEFAULT_AI_SUMMARY_PROMPT;
  try {
    window.localStorage.setItem(TEXT_PROMPT_STORAGE_KEY, trimmed);
  } catch {
    // ignore
  }
};

