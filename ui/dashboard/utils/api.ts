const getApiBase = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || '';

export const apiFetch = (path: string, init?: RequestInit) => {
  const prefix = path.startsWith('http') ? '' : getApiBase();
  return fetch(`${prefix}${path}`, init);
};
