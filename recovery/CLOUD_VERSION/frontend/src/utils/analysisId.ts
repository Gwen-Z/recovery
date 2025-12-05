/**
 * 分析ID相关的工具函数
 */

/**
 * 获取分析页面的URL路径
 * @param analysisId 分析ID
 * @returns 分析页面的路径
 */
export function getAnalysisUrl(analysisId: string): string {
  return `/analysis/${analysisId}`;
}

/**
 * 获取完整的分析页面URL（包含域名）
 * @param analysisId 分析ID
 * @returns 完整的分析页面URL
 */
export function getFullAnalysisUrl(analysisId: string): string {
  if (typeof window === 'undefined') {
    return getAnalysisUrl(analysisId);
  }
  return `${window.location.origin}${getAnalysisUrl(analysisId)}`;
}

/**
 * 获取短格式的分析ID（用于显示）
 * @param analysisId 完整的分析ID
 * @returns 短格式的分析ID（前8个字符）
 */
export function getShortAnalysisId(analysisId: string): string {
  if (!analysisId) return '';
  return analysisId.length > 8 ? analysisId.substring(0, 8) : analysisId;
}

