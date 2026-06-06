import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';
import { LockClosedIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const UNLOCK_KEY = 'tarasa_site_unlocked';

/**
 * Front-door password gate for the dashboard.
 *
 * - If the backend reports no password is configured (`/api/auth/required` →
 *   `{required:false}`), the gate is transparent and renders children — keeps
 *   the site usable until the operator sets `SITE_PASSWORD` on Railway.
 * - Otherwise the user sees a clean password-only screen. On a correct
 *   password (validated server-side at `/api/auth/login`) we remember it in
 *   localStorage and reveal the app.
 *
 * The public `/submit/[postId]` pages are NOT wrapped by this gate (see
 * _app.tsx) so message recipients are never asked for a password.
 */
const LoginGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  // 'checking' until we know whether a password is required and whether we're
  // already unlocked; then 'locked' or 'unlocked'.
  const [state, setState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Already unlocked this browser?
      try {
        if (typeof window !== 'undefined' && localStorage.getItem(UNLOCK_KEY) === '1') {
          if (!cancelled) setState('unlocked');
          return;
        }
      } catch {
        /* ignore storage errors */
      }
      // Is a password even configured?
      try {
        const res = await apiFetch('/api/auth/required', { skipAuth: true, timeout: 8000 });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setState(data?.required ? 'locked' : 'unlocked');
          return;
        }
      } catch {
        /* fall through */
      }
      // If we can't reach the endpoint, fail OPEN — don't lock the operator out
      // over a transient network blip (sensitive APIs are still key-protected).
      if (!cancelled) setState('unlocked');
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting || !password) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ password }),
          timeout: 10000,
        });
        if (res.ok) {
          try {
            localStorage.setItem(UNLOCK_KEY, '1');
          } catch {
            /* ignore */
          }
          setState('unlocked');
          return;
        }
        const data = await res.json().catch(() => ({}));
        setError(data?.message || t('ui.incorrectPassword'));
      } catch {
        setError(t('ui.incorrectPassword'));
      } finally {
        setSubmitting(false);
      }
    },
    [password, submitting, t]
  );

  if (state === 'unlocked') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <ArrowPathIcon className="w-6 h-6 text-slate-300 animate-spin" />
      </div>
    );
  }

  // Locked — password screen.
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center shadow-lg mb-4">
            <span className="text-white font-bold text-2xl">T</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Tarasa</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-1.5">
            <LockClosedIcon className="w-4 h-4" />
            {t('ui.siteLocked')}
          </p>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('ui.passwordPlaceholder')}
              autoFocus
              autoComplete="current-password"
              className="w-full px-4 py-3 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-slate-800 focus:border-slate-800 outline-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !password}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <LockClosedIcon className="w-5 h-5" />}
            {t('ui.unlock')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginGate;
