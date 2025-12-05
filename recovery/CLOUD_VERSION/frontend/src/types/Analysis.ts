export type NotebookType = 'mood' | 'life' | 'study' | 'work' | 'custom';

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

