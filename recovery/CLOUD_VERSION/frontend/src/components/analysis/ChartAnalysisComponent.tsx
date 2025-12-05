import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../apiClient';

interface ChartAnalysisComponentProps {
  analysisData?: {
    chartConfigs?: any[];
    fieldMappings?: any[];
    processedData?: {
      notes?: any[];
      metadata?: {
        noteIds?: Array<string | number>;
        [key: string]: any;
      };
      [key: string]: any;
    };
    metadata?: {
      dataSource?: {
        noteIds?: Array<string | number>;
        [key: string]: any;
      };
      [key: string]: any;
    };
  };
  onAIClick?: () => void;
  fromAnalysis?: boolean;
  analysisResult?: any;
  filterDateRange?: { from?: string; to?: string };
}

/**
 * 图表分析结果组件
 * 专门用于显示分析结果中的图表数据
 */
function ChartAnalysisComponent({ 
  analysisData, 
  onAIClick, 
  fromAnalysis = false, 
  analysisResult,
  filterDateRange
}: ChartAnalysisComponentProps) {
  const [notesData, setNotesData] = useState<any[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // 获取笔记数据
  useEffect(() => {
    const processedData = analysisData?.processedData;
    const componentMetadata = analysisData?.metadata;
    const analysisMetadata = analysisResult?.metadata;
    const rawNotes = Array.isArray(processedData?.notes)
      ? (processedData?.notes as any[])
      : [];
    const processedMetaIds = Array.isArray(processedData?.metadata?.noteIds)
      ? [...(processedData?.metadata?.noteIds as Array<string | number>)]
      : [];
    const componentMetaIds = Array.isArray(componentMetadata?.dataSource?.noteIds)
      ? [...(componentMetadata?.dataSource?.noteIds as Array<string | number>)]
      : [];
    const analysisMetaIds = Array.isArray(analysisMetadata?.dataSource?.noteIds)
      ? [...(analysisMetadata?.dataSource?.noteIds as Array<string | number>)]
      : [];

    const noteInputs: any[] = [
      ...rawNotes,
      ...processedMetaIds,
      ...componentMetaIds,
      ...analysisMetaIds
    ];

    let canceled = false;

    if (noteInputs.length === 0) {
      setNotesData([]);
      setLoadingNotes(false);
      return () => {
        canceled = true;
      };
    }

    const fetchNotesData = async () => {
      setLoadingNotes(true);
      try {
        const noteMap = new Map<string, any>();
        const idsToFetch = new Set<string>();
        const orderedIds: string[] = [];

        noteInputs.forEach((candidate) => {
          if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            const id = candidate.note_id || candidate.id || '';
            if (id) {
              if (!orderedIds.includes(String(id))) {
                orderedIds.push(String(id));
              }
              if (candidate.content || candidate.content_text || candidate.component_data) {
                noteMap.set(String(id), candidate);
              } else {
                idsToFetch.add(String(id));
              }
            }
          } else if (candidate !== null && candidate !== undefined) {
            const id = String(candidate);
            if (id && !orderedIds.includes(id)) {
              orderedIds.push(id);
            }
            if (!noteMap.has(id)) {
              idsToFetch.add(id);
            }
          }
        });

        const remainingIds = Array.from(idsToFetch).filter((id) => !noteMap.has(id));
        if (remainingIds.length > 0) {
          const fetchedNotes = (await Promise.all(
            remainingIds.map(async (noteId) => {
              try {
                const response = await apiClient.get(`/api/notes/${noteId}`);
                const note = response.data?.note;
                if (note) {
                  return note;
                }
              } catch (error) {
                console.error(`获取笔记 ${noteId} 失败:`, error);
              }
              return null;
            })
          )).filter(Boolean) as any[];

          fetchedNotes.forEach((note) => {
            const id = note.note_id || note.id || '';
            if (id) {
              noteMap.set(String(id), note);
            }
          });
        }

        const orderedNotes: any[] = [];
        const seen = new Set<string>();
        orderedIds.forEach((id) => {
          if (!id) return;
          const note = noteMap.get(id);
          if (note && !seen.has(id)) {
            orderedNotes.push(note);
            seen.add(id);
          }
        });
        noteMap.forEach((note, id) => {
          if (!seen.has(id)) {
            orderedNotes.push(note);
          }
        });

        if (!canceled) {
          setNotesData(orderedNotes);
        }
      } catch (error) {
        console.error('获取笔记数据失败:', error);
      } finally {
        if (!canceled) {
          setLoadingNotes(false);
        }
      }
    };

    fetchNotesData();

    return () => {
      canceled = true;
    };
  }, [
    analysisData?.processedData?.notes,
    analysisData?.processedData?.metadata?.noteIds,
    analysisData?.metadata?.dataSource?.noteIds,
    analysisResult?.metadata?.dataSource?.noteIds
  ]);
  
  // 如果没有图表配置，显示提示信息
  if (!analysisData?.chartConfigs || analysisData.chartConfigs.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-600 mb-2">📊 图表分析</div>
        <div className="text-sm text-gray-500">暂无图表数据</div>
      </div>
    );
  }

  // 如果正在加载笔记数据，显示加载状态
  if (loadingNotes) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
        <div className="text-gray-600 mb-2">📊 正在加载笔记数据...</div>
        <div className="text-sm text-gray-500">准备生成图表数据</div>
      </div>
    );
  }

  const chartConfigs = analysisData?.chartConfigs || [];

  return (
    <div className="space-y-4">
      {chartConfigs.map((chart, index) => {
        // 处理不同的数据结构格式
        const chartType = chart.type || chart.chartType || 'line';
        const chartId = chart.id || `chart_${index}`;
        let chartData = chart.data || [];
        let chartConfig: any = chart.config || {};

        // 可选：按日期范围过滤
        if (filterDateRange && (filterDateRange.from || filterDateRange.to)) {
          const xKey = (chartConfig?.xField)
            || (Array.isArray(chartConfig?.xAxis) ? chartConfig.xAxis[0] : chartConfig?.xAxis)
            || 'x';
          const fromStr = filterDateRange.from || '0000-01-01';
          const toStr = filterDateRange.to || '9999-12-31';
          chartData = (chartData || []).filter((pt: any) => {
            const v = pt?.[xKey] ?? pt?.x ?? pt?.date;
            if (!v) return false;
            const s = typeof v === 'string' ? (v.length >= 10 ? v.slice(0, 10) : v) : new Date(v).toISOString().slice(0, 10);
            return s >= fromStr && s <= toStr;
          });
        }

        const chartTitle = (() => {
          const rawTitle = (chartConfig.title || '').trim();
          const typeLabel = getChartTypeLabel(chartType);
          if (
            rawTitle === '' ||
            rawTitle === '智能分析图表' ||
            /^图表\s*\d+$/u.test(rawTitle)
          ) {
            return typeLabel || `图表 ${index + 1}`;
          }
          return rawTitle;
        })();

        const displayXAxisName = (() => {
          const xAxis = chartConfig.xAxis || chartConfig.xField;
          if (Array.isArray(xAxis)) return xAxis.filter(Boolean).join('、');
          return xAxis ? String(xAxis) : '—';
        })();

        const displayYAxisName = (() => {
          const yAxis = chartConfig.yAxis || chartConfig.yField;
          if (Array.isArray(yAxis)) return yAxis.filter(Boolean).join('、');
          return yAxis ? String(yAxis) : '—';
        })();

        const displayDataCount = chartData.filter((item: any) => !item?.__syntheticPoint).length;

        return (
          <div key={chartId} className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-semibold text-slate-900">{chartTitle}</h4>
              <div className="text-xs text-slate-400 text-right leading-5">
                <div>X 轴：({displayXAxisName})</div>
                <div>Y 轴：({displayYAxisName})</div>
                {displayDataCount > 0 && (
                  <div className="text-slate-500 mt-1">数据点：{displayDataCount}</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-gray-200 p-4">
              <div className="w-full">
                {/* 这里应该使用 ChartRenderer 组件来渲染图表 */}
                {/* 由于 ChartRenderer 组件不存在，暂时显示数据表格 */}
                {chartData.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          {Object.keys(chartData[0]).filter(key => !key.startsWith('__')).map((key) => (
                            <th key={key} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {chartData.slice(0, 10).map((row: any, idx: number) => (
                          <tr key={idx}>
                            {Object.keys(chartData[0]).filter(key => !key.startsWith('__')).map((key) => (
                              <td key={key} className="px-4 py-2 text-sm text-gray-900">
                                {row[key] !== null && row[key] !== undefined ? String(row[key]) : '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {chartData.length > 10 && (
                      <div className="text-center py-2 text-xs text-gray-500">
                        显示前 10 条，共 {chartData.length} 条数据
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    暂无图表数据
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 获取图表类型的中文标签
 */
function getChartTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'bar': '柱状图',
    'line': '折线图',
    'pie': '饼图',
    'scatter': '散点图',
    'area': '面积图',
    'radar': '雷达图'
  };
  return labels[type] || type;
}

export default ChartAnalysisComponent;

