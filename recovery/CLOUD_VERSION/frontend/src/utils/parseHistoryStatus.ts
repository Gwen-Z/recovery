/**
 * 解析历史状态类型和工具函数
 */

export type HistoryStatus = '解析中' | '解析成功' | '解析失败';

/**
 * 规范化解析历史状态
 * @param status - 原始状态
 * @returns 规范化后的状态
 */
export function normalizeHistoryStatus(status: string | null | undefined): HistoryStatus {
  if (!status) return '解析中';
  
  const normalized = status.trim();
  
  // 状态映射表
  const statusMap: Record<string, HistoryStatus> = {
    'completed': '解析成功',
    'processing': '解析中',
    'failed': '解析失败',
    'pending': '解析中',
    'assigned': '解析成功',
    '解析完成': '解析成功',
    '解析成功': '解析成功',
    '解析失败': '解析失败',
    '解析中': '解析中',
    '解析处理中': '解析中',
    'created': '解析中',
    'waiting': '解析中',
    'success': '解析成功',
    'error': '解析失败'
  };
  
  // 直接匹配
  if (statusMap[normalized]) {
    return statusMap[normalized];
  }
  
  // 不区分大小写匹配
  const lowerNormalized = normalized.toLowerCase();
  for (const [key, value] of Object.entries(statusMap)) {
    if (key.toLowerCase() === lowerNormalized) {
      return value;
    }
  }
  
  // 默认返回解析中
  return '解析中';
}

/**
 * 获取解析历史状态的所有变体（用于查询）
 * @param status - 状态
 * @returns 状态变体数组
 */
export function getParseHistoryStatusVariants(status: string | null | undefined): string[] {
  if (!status) return [];
  
  const normalized = normalizeHistoryStatus(status);
  
  const STATUS_VARIANTS_MAP: Record<HistoryStatus, string[]> = {
    '解析中': ['解析中', 'processing', 'pending', '解析处理中', 'created', 'waiting'],
    '解析成功': ['解析成功', '解析完成', 'completed', 'assigned', 'success'],
    '解析失败': ['解析失败', 'failed', 'error']
  };
  
  const variants = STATUS_VARIANTS_MAP[normalized];
  if (!variants) {
    return [status, normalized].filter(Boolean);
  }
  
  return Array.from(new Set([normalized, ...variants]));
}

