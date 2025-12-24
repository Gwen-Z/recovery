export const PARSE_HISTORY_EVENTS = {
  refresh: 'parse-history:refresh',
  created: 'parse-history:created',
  open: 'parse-history:open'
} as const;

export type ParseHistoryEventName = (typeof PARSE_HISTORY_EVENTS)[keyof typeof PARSE_HISTORY_EVENTS];

export const AI_SUMMARY_PROMPTS_UPDATED_EVENT = 'ai-summary-prompts:updated' as const;

