import logger from './logger';
import { openaiCircuitBreaker } from './circuitBreaker';

// HTTP status codes that are retryable
const RETRYABLE_STATUS_CODES = [
  429, // Rate limit
  500, // Internal server error
  502, // Bad gateway
  503, // Service unavailable
  504, // Gateway timeout
];

interface ErrorWithStatus {
  status?: number;
  response?: { status?: number };
  code?: string;
  message?: string;
}

const isErrorWithStatus = (error: unknown): error is ErrorWithStatus => {
  return typeof error === 'object' && error !== null;
};

export const callOpenAIWithRetry = async <T>(operation: () => Promise<T>, retries = 3, baseDelayMs = 1000): Promise<T> => {
  // Check circuit breaker before attempting
  if (openaiCircuitBreaker.isOpen()) {
    logger.warn('[OpenAI] Circuit breaker is OPEN, skipping OpenAI call');
    throw new Error('OpenAI circuit breaker is open - service temporarily disabled');
  }

  let lastError: Error | undefined;

  // Execute within circuit breaker
  return openaiCircuitBreaker.execute(async () => {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        let status: number | undefined;
        let code: string | undefined;
        let message: string | undefined;

        if (isErrorWithStatus(error)) {
          status = error.status ?? error.response?.status;
          code = error.code;
          message = error.message;
        }

        const isRetryable = (status !== undefined && RETRYABLE_STATUS_CODES.includes(status)) ||
          code === 'ECONNRESET' ||
          code === 'ETIMEDOUT' ||
          code === 'ENOTFOUND';

        if (isRetryable && attempt < retries - 1) {
          const delay = Math.pow(2, attempt) * baseDelayMs;
          logger.warn(`OpenAI request failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms: ${message || status}`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('OpenAI retry attempts exhausted');
  });
};

/**
 * Check if OpenAI circuit breaker is open
 */
export const isOpenAIAvailable = (): boolean => {
  return !openaiCircuitBreaker.isOpen();
};
