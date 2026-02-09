const getApiBase = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

const DEFAULT_TIMEOUT = 30000; // 30 seconds

// API key storage - read from environment or localStorage
const API_KEY_STORAGE_KEY = 'tarasa_api_key';

export const getApiKey = (): string => {
  // Server-side: use env variable
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_KEY || '';
  }
  // Client-side: check localStorage, then env
  return localStorage.getItem(API_KEY_STORAGE_KEY) || process.env.NEXT_PUBLIC_API_KEY || '';
};

export const setApiKey = (key: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  }
};

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
  skipAuth?: boolean;
}

export const apiFetch = async (path: string, init?: ApiFetchOptions): Promise<Response> => {
  const prefix = path.startsWith('http') ? '' : getApiBase();
  const url = `${prefix}${path}`;
  const timeout = init?.timeout ?? DEFAULT_TIMEOUT;

  // Build headers with auth
  const headers = new Headers(init?.headers);
  if (!init?.skipAuth) {
    const apiKey = getApiKey();
    if (apiKey) {
      headers.set('X-API-Key', apiKey);
    }
  }
  if (!headers.has('Content-Type') && init?.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...init,
      headers,
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
