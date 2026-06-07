/**
 * Telegram → internal API bridge for the COMPLEX / DESTRUCTIVE operations.
 *
 * For simple triggers (scrape, classify, settings…) the control catalog calls
 * the underlying functions directly. But a handful of operations have rich,
 * already-tested route logic that would be risky to duplicate:
 *
 *   • Email "approved posts"  — private HTML/CSV rendering + email transport
 *   • Cleanup phantom posts   — must use the live `shouldSkipPost` filter
 *   • Reset ALL data          — guarded by a confirm header
 *   • Upload cookies          — cookie normalization + session-restore side effects
 *   • Run diagnostics / healing
 *   • List / cleanup backups
 *
 * Rather than re-implement (and risk drifting from) that logic, we call the
 * existing HTTP endpoints on localhost. The bot runs IN THE SAME PROCESS as the
 * API, so it can read `process.env.API_KEY` directly and present it as the
 * `X-API-Key` header — no site-password handshake needed. Operator tap-rate is
 * far below the rate limits, and reusing the routes guarantees the Telegram
 * path and the dashboard path can never diverge.
 */

import axios from 'axios';
import logger from './logger';

const PORT = process.env.PORT || 4000;
const BASE = `http://127.0.0.1:${PORT}`;

const authHeaders = (): Record<string, string> => {
  const key = process.env.API_KEY;
  return key ? { 'X-API-Key': key } : {};
};

/** Pull the most useful human message out of an axios error. */
const explain = (error: unknown, fallback: string): Error => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: string; hint?: string } | undefined;
    const parts = [data?.message || data?.error || error.message];
    if (data?.hint) parts.push(`Hint: ${data.hint}`);
    return new Error(parts.filter(Boolean).join('\n'));
  }
  return new Error((error as Error)?.message || fallback);
};

export interface ApprovedEmailResult {
  recipient: string;
  postsCount: number;
  threshold: number;
  capped: boolean;
}

export const sendApprovedPostsEmail = async (): Promise<ApprovedEmailResult> => {
  try {
    const res = await axios.post(`${BASE}/api/export/approved-posts`, {}, {
      headers: authHeaders(),
      timeout: 120_000,
    });
    return res.data as ApprovedEmailResult;
  } catch (error) {
    throw explain(error, 'Email export failed');
  }
};

export interface PhantomCleanupResult {
  deleted: number;
  reasons: Record<string, number>;
}

export const cleanupPhantomPosts = async (): Promise<PhantomCleanupResult> => {
  try {
    const res = await axios.post(`${BASE}/api/admin/cleanup-phantoms`, {}, {
      headers: authHeaders(),
      timeout: 120_000,
    });
    return res.data as PhantomCleanupResult;
  } catch (error) {
    throw explain(error, 'Phantom cleanup failed');
  }
};

export const resetAllData = async (): Promise<Record<string, number>> => {
  try {
    const res = await axios.delete(`${BASE}/api/data/reset`, {
      headers: { ...authHeaders(), 'X-Confirm-Delete': 'DELETE-ALL-DATA' },
      timeout: 60_000,
    });
    // Strip any non-count metadata for a tidy summary.
    const data = res.data as Record<string, unknown>;
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'number') counts[k] = v;
    }
    return counts;
  } catch (error) {
    throw explain(error, 'Data reset failed');
  }
};

export interface CookieUploadResult {
  cookieCount: number;
  userId: string;
}

/**
 * Accepts the raw JSON string the user pasted (a cookie array, or
 * `{ "cookies": [...] }`), forwards it to the public upload-cookies endpoint
 * which validates, persists, marks the session valid, and runs the
 * reactivate-groups + kick-scrape side effects.
 */
export const uploadCookiesFromJson = async (raw: string): Promise<CookieUploadResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('That is not valid JSON. Paste the full Cookie-Editor export.');
  }
  try {
    const res = await axios.post(`${BASE}/api/session/upload-cookies`, parsed, { timeout: 30_000 });
    return res.data as CookieUploadResult;
  } catch (error) {
    throw explain(error, 'Cookie upload failed');
  }
};

export const runDiagnostics = async (): Promise<string> => {
  try {
    const res = await axios.post(`${BASE}/api/debug/diagnostics/run`, {}, {
      headers: authHeaders(),
      timeout: 150_000,
    });
    const d = res.data as { status?: string; summary?: string; passed?: number; failed?: number };
    if (d.summary) return d.summary;
    if (typeof d.passed === 'number') return `Passed ${d.passed}, failed ${d.failed ?? 0}.`;
    return d.status ? `Status: ${d.status}.` : 'Diagnostics complete.';
  } catch (error) {
    throw explain(error, 'Diagnostics failed');
  }
};

export const runHealing = async (): Promise<string> => {
  try {
    const res = await axios.post(`${BASE}/api/debug/healing/run`, {}, {
      headers: authHeaders(),
      timeout: 60_000,
    });
    const d = res.data as { actionsCount?: number; issues?: unknown[] };
    if (typeof d.actionsCount === 'number') return `Healing actions taken: ${d.actionsCount}.`;
    return 'Self-healing checks complete.';
  } catch (error) {
    throw explain(error, 'Self-healing failed');
  }
};

export interface BackupSummary {
  count: number;
  items: Array<{ id: string; type: string; createdAt: string | null }>;
}

export const listBackups = async (): Promise<BackupSummary> => {
  try {
    const res = await axios.get(`${BASE}/api/backup/list`, { headers: authHeaders(), timeout: 20_000 });
    const data = res.data as { backups?: Array<Record<string, unknown>> };
    const backups = Array.isArray(data.backups) ? data.backups : [];
    return {
      count: backups.length,
      items: backups.slice(0, 8).map((b) => ({
        id: String(b.id ?? b.filename ?? '?'),
        type: String(b.type ?? ''),
        createdAt: (b.createdAt as string) ?? null,
      })),
    };
  } catch (error) {
    throw explain(error, 'Backup list failed');
  }
};

export const cleanupBackups = async (): Promise<number> => {
  try {
    const res = await axios.post(`${BASE}/api/backup/cleanup`, {}, { headers: authHeaders(), timeout: 30_000 });
    const d = res.data as { deleted?: number };
    return d.deleted ?? 0;
  } catch (error) {
    throw explain(error, 'Backup cleanup failed');
  }
};

// Surface a one-time warning at import if the API key is missing in production,
// since the protected bridges will 401 without it.
if (process.env.NODE_ENV === 'production' && !process.env.API_KEY) {
  logger.warn('[TelegramActions] API_KEY is not set — admin Telegram actions that call protected endpoints will fail.');
}
