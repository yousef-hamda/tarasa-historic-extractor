/**
 * Input validation utilities for API routes
 */

export const parsePositiveInt = (value: unknown, defaultValue: number, max?: number): number => {
  const parsed = Number(value);
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  const result = Math.floor(parsed);
  if (max !== undefined) {
    return Math.min(result, max);
  }
  return result;
};

export const parseNonNegativeInt = (value: unknown, defaultValue: number): number => {
  const parsed = Number(value);
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  return Math.floor(parsed);
};

const VALID_LOG_TYPES = ['scrape', 'classify', 'message', 'auth', 'error'] as const;
export type LogType = typeof VALID_LOG_TYPES[number];

export const isValidLogType = (type: unknown): type is LogType => {
  return typeof type === 'string' && VALID_LOG_TYPES.includes(type as LogType);
};

export const sanitizeLogType = (type: unknown): LogType | undefined => {
  if (!type) return undefined;
  if (isValidLogType(type)) return type;
  return undefined;
};
