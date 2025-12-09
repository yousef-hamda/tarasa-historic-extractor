const getApiBase = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

const DEFAULT_TIMEOUT = 30000; // 30 seconds

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public statusText?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiFetchOptions extends RequestInit {
  timeout?: number;
}

export const apiFetch = async (path: string, init?: ApiFetchOptions): Promise<Response> => {
  const prefix = path.startsWith('http') ? '' : getApiBase();
  const url = `${prefix}${path}`;
  const timeout = init?.timeout ?? DEFAULT_TIMEOUT;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (process.env.NODE_ENV === 'development') {
      console.log(`[API] ${init?.method || 'GET'} ${path} -> ${response.status}`);
    }

    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(`Request timeout after ${timeout}ms`, 408, 'Request Timeout');
    }
    throw new ApiError(
      error instanceof Error ? error.message : 'Network error',
      0,
      'Network Error'
    );
  } finally {
    clearTimeout(timeoutId);
  }
};
