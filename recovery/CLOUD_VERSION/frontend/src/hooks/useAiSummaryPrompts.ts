import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_AI_SUMMARY_PROMPT,
  PARSE_SETTINGS_STORAGE_KEY,
  TEXT_PROMPT_STORAGE_KEY,
  readLinkPrompt,
  readTextPrompt,
  writeLinkPrompt,
  writeTextPrompt
} from '../constants/aiSummary';
import { AI_SUMMARY_PROMPTS_UPDATED_EVENT } from '../constants/events';

type PromptKind = 'link' | 'text';

const buildDetail = (kind?: PromptKind) => ({ kind } as const);

export function useAiSummaryPrompts() {
  const [linkPrompt, setLinkPromptState] = useState<string>(() => readLinkPrompt());
  const [textPrompt, setTextPromptState] = useState<string>(() => readTextPrompt());

  const syncFromStorage = useCallback(() => {
    setLinkPromptState(readLinkPrompt());
    setTextPromptState(readTextPrompt());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key === PARSE_SETTINGS_STORAGE_KEY || event.key === TEXT_PROMPT_STORAGE_KEY) {
        syncFromStorage();
      }
    };
    const handleCustom = () => {
      syncFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(AI_SUMMARY_PROMPTS_UPDATED_EVENT, handleCustom as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(AI_SUMMARY_PROMPTS_UPDATED_EVENT, handleCustom as EventListener);
    };
  }, [syncFromStorage]);

  const setLinkPrompt = useCallback((nextPrompt: string) => {
    const trimmed = (nextPrompt || '').trim() || DEFAULT_AI_SUMMARY_PROMPT;
    writeLinkPrompt(trimmed);
    setLinkPromptState(trimmed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AI_SUMMARY_PROMPTS_UPDATED_EVENT, { detail: buildDetail('link') }));
    }
  }, []);

  const setTextPrompt = useCallback((nextPrompt: string) => {
    const trimmed = (nextPrompt || '').trim() || DEFAULT_AI_SUMMARY_PROMPT;
    writeTextPrompt(trimmed);
    setTextPromptState(trimmed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AI_SUMMARY_PROMPTS_UPDATED_EVENT, { detail: buildDetail('text') }));
    }
  }, []);

  return { linkPrompt, textPrompt, setLinkPrompt, setTextPrompt };
}
