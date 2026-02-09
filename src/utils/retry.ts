import logger from './logger';
import { delay } from './delays';

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  factor?: number;
  onRetry?: (error: Error, attempt: number) => void;
  operationName?: string;
}

/**
 * Small helper to retry an async operation with exponential backoff.
 */
export const withRetries = async <T>(
  fn: (attempt: number) => Promise<T>,
  {
    attempts = 3,
    delayMs = 2000,
    factor = 1.5,
    onRetry,
    operationName,
  }: RetryOptions = {}
): Promise<T> => {
  let lastError: Error | null = null;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error as Error;
      if (attempt >= attempts) {
        break;
      }

      onRetry?.(lastError, attempt);
      const name = operationName ? `${operationName} ` : '';
      logger.warn(
        `${name}attempt ${attempt}/${attempts} failed: ${lastError.message}. Retrying in ${currentDelay}ms...`
      );
      // Add jitter to prevent thundering herd (0.5x to 1.5x multiplier)
      const jitteredDelay = currentDelay * (0.5 + Math.random());
      await delay(jitteredDelay);
      currentDelay *= factor;
    }
  }

  if (lastError) {
    throw lastError;
  }

  // Should never reach here
  throw new Error(operationName || 'Operation failed after retries');
};
