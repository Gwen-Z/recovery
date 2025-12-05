import React, { useState, useEffect } from 'react';

export interface FilterOptions {
  dateRange: {
    from: string;
    to: string;
  };
  status: string[];
  tags: string[];
  keywords: string;
  wordCount: {
    min: number;
    max: number;
  };
  sentiment: string[];
  sortBy: 'date' | 'title';
  sortOrder: 'asc' | 'desc';
}

interface AdvancedFiltersProps {
  onFiltersChange: (filters: FilterOptions) => void;
  initialFilters?: Partial<FilterOptions>;
  availableTags?: string[];
  className?: string;
}

const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  onFiltersChange,
  initialFilters = {},
  availableTags = [],
  className = ''
}) => {
  const [filters, setFilters] = useState<FilterOptions>({
    dateRange: {
      from: '',
      to: ''
    },
    status: [],
    tags: [],
    keywords: '',
    wordCount: { min: 0, max: 10000 },
    sentiment: [],
    sortBy: 'date',
    sortOrder: 'desc',
    ...initialFilters
  });

  // 通知父组件筛选器变化
  useEffect(() => {
    onFiltersChange(filters);
  }, [filters, onFiltersChange]);

  const updateFilter = (key: keyof FilterOptions, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const toggleArrayFilter = (key: 'status' | 'tags', value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter(item => item !== value)
        : [...prev[key], value]
    }));
  };

  const statusOptions = [
    { value: 'draft', label: '草稿', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'published', label: '已发布', color: 'bg-green-100 text-green-800' },
    { value: 'archived', label: '已归档', color: 'bg-gray-100 text-gray-800' }
  ];

  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${className}`}>
      <div className="p-6 space-y-6">
        {/* 日期范围 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">日期范围</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <input
                type="date"
                value={filters.dateRange.from}
                onChange={(e) => updateFilter('dateRange', { ...filters.dateRange, from: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-300"
                placeholder="开始日期"
              />
            </div>
            <div>
              <input
                type="date"
                value={filters.dateRange.to}
                onChange={(e) => updateFilter('dateRange', { ...filters.dateRange, to: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-300"
                placeholder="结束日期"
              />
            </div>
          </div>
        </div>

        {/* 状态筛选 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">笔记状态</label>
          <div className="flex flex-wrap gap-2">
            {statusOptions.map(option => (
              <button
                key={option.value}
                onClick={() => toggleArrayFilter('status', option.value)}
                className={`px-3 py-2 text-[10px] rounded-lg border transition-colors ${
                  filters.status.includes(option.value)
                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* 标签筛选 */}
        {availableTags.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">标签</label>
            <div className="flex flex-wrap gap-2">
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleArrayFilter('tags', tag)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    filters.tags.includes(tag)
                      ? 'bg-purple-100 text-purple-800 border-purple-300'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 关键词搜索 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">关键词搜索</label>
          <input
            type="text"
            value={filters.keywords}
            onChange={(e) => updateFilter('keywords', e.target.value)}
            placeholder="搜索笔记标题或内容..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-300"
          />
        </div>

        {/* 排序 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">排序方式</label>
          <div className="flex gap-4">
            <select
              value={filters.sortBy}
              onChange={(e) => updateFilter('sortBy', e.target.value as 'date' | 'title')}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-300"
            >
              <option value="date">按日期</option>
              <option value="title">按标题</option>
            </select>
            <select
              value={filters.sortOrder}
              onChange={(e) => updateFilter('sortOrder', e.target.value as 'asc' | 'desc')}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-0 focus:border-purple-300"
            >
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvancedFilters;

