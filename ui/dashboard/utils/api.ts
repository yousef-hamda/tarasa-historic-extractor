const getApiBase = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

const DEFAULT_TIMEOUT = 30000; // 30 seconds

// API key storage - read from environment or localStorage
const API_KEY_STORAGE_KEY = 'tarasa_api_key';
export const API_KEY_CHANGED_EVENT = 'tarasa-api-key-changed';

export const getApiKey = (): string => {
  // Server-side: use env variable
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_KEY || '';
  }
  // Client-side: check localStorage, then env
  return localStorage.getItem(API_KEY_STORAGE_KEY) || process.env.NEXT_PUBLIC_API_KEY || '';
};

export const hasApiKey = (): boolean => {
  if (typeof window === 'undefined') return Boolean(process.env.NEXT_PUBLIC_API_KEY);
  return Boolean(localStorage.getItem(API_KEY_STORAGE_KEY) || process.env.NEXT_PUBLIC_API_KEY);
};

export const setApiKey = (key: string): void => {
  if (typeof window === 'undefined') return;
  const trimmed = key.trim();
  if (trimmed) {
    localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
  // Fires within the same tab so listeners (e.g. navbar status pill) can update
  // immediately. localStorage `storage` events only fire in OTHER tabs.
  window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT));
};

export const clearApiKey = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(API_KEY_STORAGE_KEY);
  window.dispatchEvent(new Event(API_KEY_CHANGED_EVENT));
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

  // Single attempt with optional one-shot retry on transient 5xx / 429.
  // When the server rate-limiter (or a Railway rolling deploy) returns a
  // transient error, we want the UI to absorb it silently instead of
  // dropping the user into an error state. We only retry idempotent verbs
  // (GET/HEAD) so we don't double-execute mutations.
  const method = (init?.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (process.env.NODE_ENV === 'development') {
        console.log(`[API] ${method} ${path} -> ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    let response = await attempt();
    // Retry once on rate-limit or transient server errors — but only for
    // idempotent requests where re-executing is safe.
    if (isIdempotent && (response.status === 429 || (response.status >= 500 && response.status < 600))) {
      // Respect Retry-After if the server gave us one (rate-limit case).
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 3000) // cap at 3s so the UI doesn't freeze
        : 800;
      await new Promise((r) => setTimeout(r, waitMs));
      response = await attempt();
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
  }
};
