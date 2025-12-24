export const ANALYSIS_V3_CHART_STRATEGY = {
  default: {
    preferredCandidates: ['trend', 'weekday', 'length'],
    fallbackCandidates: ['trend', 'weekday', 'length']
  },
  finance: {
    preferredCandidates: ['topic_heatmap', 'topic_distribution', 'entity_topn'],
    fallbackCandidates: ['topic_distribution', 'entity_topn', 'trend'],
    candidateRules: {
      topic_heatmap: { minCategories: 1 },
      topic_distribution: { minCategories: 1 },
      entity_topn: { minCategories: 1 }
    }
  },
  ai: {
    preferredCandidates: ['topic_heatmap', 'topic_distribution', 'entity_topn'],
    fallbackCandidates: ['topic_distribution', 'entity_topn', 'trend'],
    candidateRules: {
      topic_heatmap: { minCategories: 1 },
      topic_distribution: { minCategories: 1 },
      entity_topn: { minCategories: 1 }
    }
  },
  mood: {
    preferredCandidates: ['trend', 'weekday', 'mood_event'],
    fallbackCandidates: ['trend', 'weekday', 'length'],
    candidateRules: {
      mood_event: { minCategories: 2 }
    }
  },
  life: {
    preferredCandidates: ['trend', 'weekday', 'length'],
    fallbackCandidates: ['trend', 'weekday', 'length']
  },
  study: {
    preferredCandidates: ['trend', 'weekday', 'length'],
    fallbackCandidates: ['trend', 'weekday', 'length']
  },
  work: {
    preferredCandidates: ['trend', 'weekday', 'length'],
    fallbackCandidates: ['trend', 'weekday', 'length']
  }
};
