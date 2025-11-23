export const callOpenAIWithRetry = async <T>(operation: () => Promise<T>, retries = 3, baseDelayMs = 1000): Promise<T> => {
  let attempt = 0;

  while (attempt < retries) {
    try {
      return await operation();
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      if (status === 429 && attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * baseDelayMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error('OpenAI retry attempts exhausted');
};
