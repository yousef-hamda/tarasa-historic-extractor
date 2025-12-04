export const callPlaywrightWithRetry = async <T>(
  operation: () => Promise<T>,
  retries = 2,
  baseDelayMs = 1000,
): Promise<T> => {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) {
        break;
      }
      const delay = Math.pow(2, attempt) * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Playwright retry attempts exhausted without error details');
};
