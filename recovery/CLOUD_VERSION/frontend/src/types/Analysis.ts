export type NotebookType = 'mood' | 'life' | 'study' | 'work' | 'finance' | 'ai' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export interface SelectedNotes {
  notebookId: string;
  noteIds: string[];
  dateRange: DateRange;
}

export interface Notebook {
  notebook_id: string;
  name: string;
  description?: string | null;
  note_count: number;
  created_at: string;
  updated_at: string;
  type?: NotebookType;
}

export interface Note {
  note_id: string;
  notebook_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface InsightCard {
  id: string;
  title: string;
  summary?: string;
  category?: string;
  type?: 'positive' | 'negative' | 'neutral' | 'suggestion' | 'trend' | 'pattern' | string;
  description?: string;
  details?: string;
  suggestions?: Array<string>;
  relatedData?: unknown;
}

export interface NotebookAnalysisConfig {
  notebook_id: string;
  chart_configs?: any[];
  ai_config?: any;
}

export interface AnalysisResult {
  id: string;
  mode: 'ai' | 'custom';
  notebookType?: NotebookType;
  selectedAnalysisComponents?: string[];
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
    dataSource?: {
      notebookId?: string;
      noteIds?: string[];
      dateRange?: {
        from: string;
        to: string;
      };
    };
  };
  analysisData?: any;
  componentConfigs?: any;
  aiRecommendation?: any;
  notebookId?: string;
  [key: string]: any;
}

export type AnalysisV3Preset = '7d' | '30d' | '90d' | 'custom';

export interface AnalysisV3Request {
  notebookId: string;
  timeRange: {
    preset: AnalysisV3Preset;
    from?: string;
    to?: string;
  };
  noteIds?: string[];
  withDebug?: boolean;
}

export interface AnalysisV3Insight {
  key: 'state' | 'change' | 'pattern';
  what: string;
  canDo?: string;
  whatElse?: string;
  coverage?: number;
  confidence?: number;
}

export interface AnalysisV3ChartData {
  xKey?: string;
  yKey?: string;
  categoryKey?: string;
  valueKey?: string;
  rows?: Array<Record<string, any>>;
  granularity?: string;
}

export interface AnalysisV3ChartItem {
  key: string;
  question: string;
  type: 'line' | 'bar' | 'pie' | 'heatmap';
  data: AnalysisV3ChartData;
  coverage?: number;
  confidence?: number;
}

export interface AnalysisV3Response {
  analysisId: string;
  meta: {
    recordCount: number;
    startAt: number | null;
    endAt: number | null;
  };
  notebookType?: NotebookType;
  noteType?: {
    value: 'monitoring' | 'developmental' | 'archive';
    confidence?: number;
  };
  insights: AnalysisV3Insight[];
  insightsByChartKey?: Record<string, AnalysisV3Insight[]>;
  charts: {
    defaultKey: string;
    items: AnalysisV3ChartItem[];
  };
  cache?: {
    hit: boolean;
    ttlSec: number;
  };
  debug?: {
    fields?: Array<{
      name: string;
      role: 'dimension' | 'metric';
      dataType: 'date' | 'number' | 'text' | 'category';
      source: string;
      missingRate?: number;
      sample?: string;
    }>;
    axisSuggestions?: {
      xCandidates?: string[];
      yCandidates?: string[];
      dim2Candidates?: string[];
    };
    downgradeReasons?: Record<string, string>;
  };
}
