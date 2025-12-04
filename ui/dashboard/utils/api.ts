const DEFAULT_API_BASE = 'http://localhost:4000';

const getApiBase = () =>
  (process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE).replace(/\/$/, '');

export const apiFetch = (path: string, init?: RequestInit) => {
  const isAbsolute = /^https?:\/\//i.test(path);
  const normalizedPath = isAbsolute ? path : `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(normalizedPath, init);
};
