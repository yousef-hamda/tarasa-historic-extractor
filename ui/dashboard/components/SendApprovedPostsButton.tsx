import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch, hasApiKey } from '../utils/api';
import { PaperAirplaneIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface SendApprovedPostsButtonProps {
  /** "compact" omits descriptive helper text — useful in dense headers. */
  variant?: 'default' | 'compact';
  /**
   * Optional callback fired after a successful send so the parent can refresh
   * or surface a higher-level confirmation.
   */
  onSuccess?: (result: { recipient: string; postsCount: number; threshold: number }) => void;
}

interface ExportResult {
  success?: boolean;
  recipient?: string;
  postsCount?: number;
  threshold?: number;
  capped?: boolean;
  error?: string;
  message?: string;
}

/**
 * Shared button used on the Posts page and the Admin page. POSTs to
 * `/api/export/approved-posts`, surfacing the precise reason for failures
 * (no admin email set, no SMTP creds, no posts above threshold, etc.) so the
 * user knows what to do next.
 *
 * Self-contained: fetches `/api/settings` on mount to know the current admin
 * email and whether the local API key is present, then decides whether the
 * button should be enabled / what the tooltip should say.
 */
const SendApprovedPostsButton: React.FC<SendApprovedPostsButtonProps> = ({ variant = 'default', onSuccess }) => {
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [hasKey, setHasKey] = useState<boolean>(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Hydrate from /api/settings on mount so we know the admin email + SMTP
  // status. Falls back to disabled state on any failure.
  useEffect(() => {
    setHasKey(hasApiKey());
    apiFetch('/api/settings', { skipAuth: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setAdminEmail(typeof data.adminEmail === 'string' ? data.adminEmail : '');
        setSmtpConfigured(Boolean(data.emailConfigured));
      })
      .catch(() => {
        // Keep the inputs null; UI will show "click Settings to configure".
      });
  }, []);

  const disabledReason = (() => {
    if (!hasKey) return 'Set an API key in Settings before sending.';
    if (adminEmail === '') return 'Set an admin email in Settings → Email Reports first.';
    if (smtpConfigured === false) return 'Server SMTP credentials are missing — see Settings → Email Reports.';
    return null;
  })();

  const send = useCallback(async () => {
    if (sending || disabledReason) return;
    setSending(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/export/approved-posts', { method: 'POST' });
      const data: ExportResult = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }
      const recipient = data.recipient ?? 'admin';
      const count = data.postsCount ?? 0;
      setResult({
        ok: true,
        message: `Sent ${count} post${count === 1 ? '' : 's'} to ${recipient}${data.capped ? ' (capped at 1000)' : ''}.`,
      });
      if (onSuccess && typeof data.recipient === 'string' && typeof data.postsCount === 'number' && typeof data.threshold === 'number') {
        onSuccess({ recipient: data.recipient, postsCount: data.postsCount, threshold: data.threshold });
      }
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Send failed',
      });
    } finally {
      setSending(false);
    }
  }, [sending, disabledReason, onSuccess]);

  // Auto-clear the result banner after 6 seconds so it doesn't linger.
  useEffect(() => {
    if (!result) return;
    const id = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(id);
  }, [result]);

  const buttonClasses = variant === 'compact'
    ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors'
    : 'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors';

  return (
    <div className="inline-flex flex-col items-stretch gap-1.5">
      <button
        onClick={send}
        disabled={Boolean(disabledReason) || sending}
        title={disabledReason || `Email approved posts to ${adminEmail || 'the admin'}`}
        className={`${buttonClasses} ${
          disabledReason
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {sending ? (
          <ArrowPathIcon className="w-4 h-4 animate-spin" />
        ) : (
          <PaperAirplaneIcon className="w-4 h-4" />
        )}
        {sending ? 'Sending email…' : 'Email approved posts'}
      </button>
      {result && (
        <div
          className={`text-xs px-2 py-1 rounded ${
            result.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {result.message}
        </div>
      )}
      {!result && disabledReason && variant !== 'compact' && (
        <p className="text-xs text-slate-400">{disabledReason}</p>
      )}
    </div>
  );
};

export default SendApprovedPostsButton;
