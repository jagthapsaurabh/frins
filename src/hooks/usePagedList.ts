import { useCallback, useEffect, useRef, useState } from 'react';

export interface PagedState<T = any> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
  loading: boolean;
  error: string | null;
}

const EMPTY = { rows: [], total: 0, page: 1, pages: 1, loading: true, error: null };

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetch one page of a list endpoint and keep it in sync with the filters.
 *
 * Every long list in the console goes through this, so a learner roster of a
 * thousand rows costs one small request per screen instead of one huge one.
 */
export function usePagedList<T = any>(
  authFetch: AuthFetch,
  path: string,
  params: Record<string, string | number | undefined>
) {
  const [state, setState] = useState<PagedState<T>>(EMPTY as PagedState<T>);
  const requestId = useRef(0);
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const queryString = query.toString();

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await authFetch(`${path}${queryString ? `?${queryString}` : ''}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (id !== requestId.current) return;
      setState({
        rows: json.rows || [],
        total: json.total || 0,
        page: json.page || 1,
        pages: json.pages || 1,
        loading: false,
        error: null
      });
    } catch (err: any) {
      if (id !== requestId.current) return;
      setState((prev) => ({ ...prev, loading: false, error: err?.message || 'Could not load this list.' }));
    }
  }, [authFetch, path, queryString]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
