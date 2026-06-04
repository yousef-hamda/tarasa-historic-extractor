import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch, getApiKey, setApiKey as persistApiKey, clearApiKey } from '../utils/api';
import { cronToHuman } from '../utils/cronHuman';
import LanguageSwitcher from '../components/LanguageSwitcher';
import {
  Cog6ToothIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  GlobeAltIcon,
  EnvelopeIcon,
  BoltIcon,
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  KeyIcon,
  ExclamationTriangleIcon,
  UserCircleIcon,
  ShieldCheckIcon,
  TrashIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';

type SpeedPreset = 'conservative' | 'normal' | 'fast' | 'aggressive';
const SPEED_ORDER: SpeedPreset[] = ['conservative', 'normal', 'fast', 'aggressive'];

interface SpeedPresetDefinition {
  preset: SpeedPreset;
  label: string;
  description: string;
  warning?: string;
  danger?: string;
  schedules: { scrape: string; classify: string; message: string };
}

interface Settings {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
  emailTransport?: 'resend' | 'smtp' | 'none';
  apifyConfigured?: boolean;
  messagingEnabled?: boolean;
  historicThreshold?: {
    value: number;
    min: number;
    max: number;
    default: number;
  };
  speed?: {
    preset: SpeedPreset;
    presets: Record<SpeedPreset, SpeedPresetDefinition>;
  };
  adminEmail?: string;
}

interface SessionStatus {
  loggedIn: boolean;
  userId: string | null;
  userName: string | null;
  status: string;
  lastChecked: string;
  canAccessPrivateGroups: boolean;
  requiresAction: boolean;
  sessionHealth?: {
    status: string;
    lastChecked: string;
    lastValid: string;
    expiresAt: string | null;
    errorMessage: string | null;
  };
}

type TriggerType = 'scrape' | 'classification' | 'message';

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<{ kind: 'saved' | 'cleared' } | null>(null);
  const [triggering, setTriggering] = useState<TriggerType | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ type: TriggerType; success: boolean; message: string } | null>(null);
  const [resettingBreaker, setResettingBreaker] = useState(false);

  // Hydrate the input from localStorage on mount so users see what's already saved.
  useEffect(() => {
    const existing = getApiKey();
    if (existing) setApiKey(existing);
  }, []);

  // Auto-clear the API-key save status banner after 3 s.
  useEffect(() => {
    if (!apiKeyStatus) return;
    const id = setTimeout(() => setApiKeyStatus(null), 3000);
    return () => clearTimeout(id);
  }, [apiKeyStatus]);

  const handleSaveApiKey = () => {
    persistApiKey(apiKey);
    setApiKeyStatus({ kind: 'saved' });
  };

  const handleClearApiKey = () => {
    clearApiKey();
    setApiKey('');
    setApiKeyStatus({ kind: 'cleared' });
  };

  // Session state
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [renewingSession, setRenewingSession] = useState(false);
  const [sessionRenewResult, setSessionRenewResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showCookieModal, setShowCookieModal] = useState(false);
  const [showCookieFallback, setShowCookieFallback] = useState(false);
  const [cookieJson, setCookieJson] = useState('');

  // Credentials modal state — primary path for renewing the FB session.
  // User types FB email + password (and optionally a 2FA code) into a modal;
  // we POST them to /api/session/renew and poll /api/session/status for the
  // result. If FB hits us with a captcha/checkpoint, we hand off to the
  // Cookie Editor manual-upload modal.
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [credentialsEmail, setCredentialsEmail] = useState('');
  const [credentialsPassword, setCredentialsPassword] = useState('');
  const [credentialsTotp, setCredentialsTotp] = useState('');
  const [credentialsShow2fa, setCredentialsShow2fa] = useState(false);

  // Reset data state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string; deleted?: Record<string, number> } | null>(null);

  // Threshold slider state — local copy of the value so the slider can drag
  // smoothly; we POST only when the user releases (onMouseUp / onTouchEnd /
  // onChange-after-mouseup), debounced to avoid hammering the API.
  const [thresholdDraft, setThresholdDraft] = useState<number | null>(null);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdSaveResult, setThresholdSaveResult] = useState<{ success: boolean; message: string } | null>(null);

  // System speed state
  const [speedSaving, setSpeedSaving] = useState<SpeedPreset | null>(null);
  const [speedResult, setSpeedResult] = useState<{ success: boolean; message: string } | null>(null);

  // Phantom-cleanup state
  const [cleaningPhantoms, setCleaningPhantoms] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ success: boolean; message: string; reasons?: Record<string, number> } | null>(null);

  // Admin email recipient state
  const [adminEmailDraft, setAdminEmailDraft] = useState<string>('');
  const [adminEmailHydrated, setAdminEmailHydrated] = useState(false);
  const [adminEmailSaving, setAdminEmailSaving] = useState(false);
  const [adminEmailResult, setAdminEmailResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchSessionStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/session/status');
      if (res.ok) {
        const data = await res.json();
        setSessionStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch session status:', err);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings');
      if (!res.ok) {
        throw new Error('Failed to fetch settings');
      }
      const data = await res.json();
      setSettings(data);
      // Seed the threshold slider draft from the server value on first load.
      if (data.historicThreshold && thresholdDraft === null) {
        setThresholdDraft(data.historicThreshold.value);
      }
      // Seed the admin-email input from the server value on first load.
      if (!adminEmailHydrated) {
        setAdminEmailDraft(typeof data.adminEmail === 'string' ? data.adminEmail : '');
        setAdminEmailHydrated(true);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [thresholdDraft]);

  useEffect(() => {
    loadSettings();
    fetchSessionStatus();
  }, [loadSettings, fetchSessionStatus]);

  const commitThreshold = useCallback(async (value: number) => {
    setThresholdSaving(true);
    setThresholdSaveResult(null);
    try {
      const res = await apiFetch('/api/settings/threshold', {
        method: 'POST',
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      setThresholdSaveResult({ success: true, message: `Threshold saved: ${data.historicThreshold.value}%` });
      // Update settings so other reads (e.g. badge label) reflect immediately.
      setSettings((s) => (s ? { ...s, historicThreshold: data.historicThreshold } : s));
    } catch (err) {
      setThresholdSaveResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to save threshold',
      });
    } finally {
      setThresholdSaving(false);
    }
  }, []);

  const commitSpeedPreset = useCallback(async (preset: SpeedPreset) => {
    setSpeedSaving(preset);
    setSpeedResult(null);
    try {
      const res = await apiFetch('/api/settings/speed', {
        method: 'POST',
        body: JSON.stringify({ preset }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      setSpeedResult({ success: true, message: `Speed preset changed to "${preset}". New schedules apply immediately.` });
      setSettings((s) => (s ? { ...s, speed: data.speed } : s));
    } catch (err) {
      setSpeedResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to change speed preset',
      });
    } finally {
      setSpeedSaving(null);
    }
  }, []);

  const commitAdminEmail = useCallback(async () => {
    setAdminEmailSaving(true);
    setAdminEmailResult(null);
    try {
      const res = await apiFetch('/api/settings/admin-email', {
        method: 'POST',
        body: JSON.stringify({ email: adminEmailDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      const stored = typeof data.adminEmail === 'string' ? data.adminEmail : '';
      setAdminEmailDraft(stored);
      setAdminEmailResult({
        success: true,
        message: stored ? `Saved: ${stored}` : 'Cleared — exports will be disabled until you set an email.',
      });
      setSettings((s) => (s ? { ...s, adminEmail: stored } : s));
    } catch (err) {
      setAdminEmailResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to save email',
      });
    } finally {
      setAdminEmailSaving(false);
    }
  }, [adminEmailDraft]);

  const handleCleanupPhantoms = useCallback(async () => {
    if (cleaningPhantoms) return;
    const ok = typeof window !== 'undefined' && window.confirm(
      'Run the phantom-post cleanup? This deletes any post currently in the DB that the scrape filter would reject today (self-author chrome, group rules, etc.). Cannot be undone.'
    );
    if (!ok) return;
    setCleaningPhantoms(true);
    setCleanupResult(null);
    try {
      const res = await apiFetch('/api/admin/cleanup-phantoms', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      setCleanupResult({
        success: true,
        message: data.deleted === 0 ? 'No phantom posts found.' : `Removed ${data.deleted} phantom posts.`,
        reasons: data.reasons,
      });
    } catch (err) {
      setCleanupResult({
        success: false,
        message: err instanceof Error ? err.message : 'Cleanup failed',
      });
    } finally {
      setCleaningPhantoms(false);
    }
  }, [cleaningPhantoms]);

  // Open the credentials modal. This replaces the old "immediately POST to
  // /api/session/renew" handler — we now collect FB email + password from
  // the user first, then submit (the modal owns the POST + polling loop).
  const openCredentialsModal = () => {
    setSessionRenewResult(null);
    setShowCookieFallback(false);
    setCredentialsShow2fa(false);
    setCredentialsTotp('');
    // Keep email/password if the user already typed them in a prior session
    // so a "Try again" doesn't make them re-type.
    setShowCredentialsModal(true);
  };

  // Drives the actual renewal request once the user submits the credentials
  // modal. Mirrors the old handleAutoRenew flow (202 + status polling) but
  // sends credentials in the body and threads the result back up to both the
  // page banner and the modal's local state.
  const submitCredentialsRenewal = useCallback(
    async (
      email: string,
      password: string,
      totpCode: string | undefined
    ): Promise<{
      ok: boolean;
      challenge?: 'captcha' | '2fa' | 'checkpoint' | null;
      userId?: string | null;
      message: string;
    }> => {
      if (renewingSession) {
        return { ok: false, message: 'Renewal already in flight.' };
      }

      setRenewingSession(true);
      setSessionRenewResult(null);

      try {
        const startRes = await apiFetch('/api/session/renew', {
          method: 'POST',
          skipAuth: true,
          timeout: 15_000,
          body: JSON.stringify({
            email,
            password,
            ...(totpCode ? { totpCode } : {}),
          }),
        });

        if (!startRes.ok && startRes.status !== 202 && startRes.status !== 409) {
          let msg = `Unable to start renewal (HTTP ${startRes.status})`;
          try {
            const data = await startRes.json();
            msg = data?.message || data?.error || msg;
          } catch {
            /* response wasn't JSON — keep status-based message */
          }
          setRenewingSession(false);
          return { ok: false, message: msg };
        }

        const POLL_TIMEOUT_MS = 240_000;
        const POLL_INTERVAL_MS = 3_000;
        const startedAt = Date.now();

        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

          let statusData: SessionStatus & {
            renewal?: {
              running: boolean;
              lastError: string | null;
              challenge: 'captcha' | '2fa' | 'checkpoint' | null;
              userId: string | null;
              requiresManualUpload: boolean;
            };
          };
          try {
            const statusRes = await apiFetch('/api/session/status');
            if (!statusRes.ok) continue;
            statusData = await statusRes.json();
          } catch {
            continue;
          }

          setSessionStatus(statusData);

          const renewal = statusData.renewal;
          if (renewal && !renewal.running) {
            if (renewal.lastError) {
              setRenewingSession(false);
              return {
                ok: false,
                message: renewal.lastError,
                challenge: renewal.challenge,
              };
            }
            if (statusData.sessionHealth?.status === 'valid') {
              setRenewingSession(false);
              return {
                ok: true,
                userId: renewal.userId,
                message: 'Facebook session renewed successfully.',
              };
            }
            setRenewingSession(false);
            return {
              ok: false,
              message: 'Renewal finished but the session is still not valid.',
            };
          }
        }

        setRenewingSession(false);
        return {
          ok: false,
          message:
            'Renewal is taking longer than 4 minutes. It may still complete in the background — refresh in a minute, or use the manual cookie path.',
        };
      } catch (err) {
        setRenewingSession(false);
        return {
          ok: false,
          message:
            err instanceof Error ? err.message : 'Failed to start renewal.',
        };
      }
    },
    [renewingSession]
  );

  const handleUploadCookies = async () => {
    if (renewingSession) return;
    const trimmed = cookieJson.trim();
    if (!trimmed) {
      setSessionRenewResult({ success: false, message: 'Paste your cookies JSON before saving.' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setSessionRenewResult({
        success: false,
        message: 'Could not parse JSON. Make sure you copied the full export from Cookie-Editor.',
      });
      return;
    }

    setRenewingSession(true);
    setSessionRenewResult(null);

    try {
      // skipAuth: this endpoint is public; never block on a missing API key
      const res = await apiFetch('/api/session/upload-cookies', {
        method: 'POST',
        body: JSON.stringify(Array.isArray(parsed) ? { cookies: parsed } : parsed),
        skipAuth: true,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSessionRenewResult({
          success: true,
          message: `Session renewed — ${data.cookieCount} cookies saved for user ${data.userId}.`,
        });
        setCookieJson('');
        setShowCookieModal(false);
        await fetchSessionStatus();
      } else {
        setSessionRenewResult({
          success: false,
          message: data.message || data.error || 'Failed to save cookies',
        });
      }
    } catch (err) {
      setSessionRenewResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to save cookies',
      });
    } finally {
      setRenewingSession(false);
    }
  };

  const handleResetData = async () => {
    if (resetConfirmText !== 'DELETE ALL DATA') {
      setResetResult({ success: false, message: 'Please type "DELETE ALL DATA" to confirm' });
      return;
    }

    setResetting(true);
    setResetResult(null);

    try {
      // The backend requires the X-Confirm-Delete header as a second factor
      // beyond typing "DELETE ALL DATA" in the textbox. Without this header
      // the route returns 400 ("Send X-Confirm-Delete: DELETE-ALL-DATA…").
      const res = await apiFetch('/api/data/reset', {
        method: 'DELETE',
        headers: { 'X-Confirm-Delete': 'DELETE-ALL-DATA' },
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setResetResult({
          success: true,
          message: data.message,
          deleted: data.deleted,
        });
        setShowResetConfirm(false);
        setResetConfirmText('');
      } else {
        setResetResult({
          success: false,
          message: data.message || 'Failed to reset data',
        });
      }
    } catch (err) {
      setResetResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to reset data',
      });
    } finally {
      setResetting(false);
    }
  };

  const handleTrigger = async (type: TriggerType) => {
    if (!apiKey) {
      setTriggerResult({ type, success: false, message: 'Please enter an API key' });
      return;
    }

    setTriggering(type);
    setTriggerResult(null);

    const endpoints: Record<TriggerType, string> = {
      scrape: '/api/trigger-scrape',
      classification: '/api/trigger-classification',
      message: '/api/trigger-message',
    };

    try {
      const res = await apiFetch(endpoints[type], {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || `Failed to trigger ${type}`);
      }

      setTriggerResult({ type, success: true, message: `${type} completed successfully` });
    } catch (err) {
      setTriggerResult({
        type,
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTriggering(null);
    }
  };

  // Manually reset the OpenAI circuit breaker. The breaker auto-opens for 15
  // minutes after a burst of failures (e.g. when OpenAI billing is in a bad
  // state). Once the user has fixed the underlying issue, this button lets
  // them recover instantly instead of waiting out the cooldown.
  const handleResetBreaker = async () => {
    if (resettingBreaker) return;
    setResettingBreaker(true);
    try {
      const res = await apiFetch('/api/debug/circuit-breakers/reset', {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data?.error || data?.message || `Reset failed (HTTP ${res.status})`);
      }
      setTriggerResult({
        type: 'classification',
        success: true,
        message: 'OpenAI circuit breaker reset — next classify/generate tick will retry the API.',
      });
    } catch (err) {
      setTriggerResult({
        type: 'classification',
        success: false,
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setResettingBreaker(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
          <p className="text-slate-500 text-sm mt-0.5">Configure your system</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
              <p className="text-slate-600 text-sm">{error || 'Failed to load settings'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">Configure your system preferences</p>
      </div>

      {/* Settings Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Facebook Groups Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <UserGroupIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Facebook Groups</h2>
          </div>

          {settings.groups.length > 0 ? (
            <div className="space-y-2">
              {settings.groups.map((group, index) => (
                <div key={group} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg text-sm">
                  <span className="w-5 h-5 rounded bg-slate-200 text-slate-600 text-xs flex items-center justify-center font-medium">
                    {index + 1}
                  </span>
                  <span className="text-slate-700 truncate">{group}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No groups configured</p>
          )}

          <p className="text-xs text-slate-400 mt-3">
            Total: {settings.groups.length} groups
          </p>
        </div>

        {/* Message Limits Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Message Limits</h2>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">Maximum per day</p>
            <p className="text-3xl font-semibold text-slate-900">{settings.messageLimit}</p>
          </div>

          <p className="text-xs text-slate-400 mt-3">
            Rate-limited to prevent account restrictions
          </p>
        </div>

        {/* Tarasa URL Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <GlobeAltIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Tarasa URL</h2>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <p className="text-sm text-slate-700 font-mono break-all">
              {settings.baseTarasaUrl}
            </p>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-xs text-slate-500">Configured</span>
          </div>
        </div>

        {/* Email Alerts Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <EnvelopeIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Email Alerts</h2>
          </div>

          <div className={`p-4 rounded-lg ${settings.emailConfigured ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Status</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-2 h-2 rounded-full ${settings.emailConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className={`text-sm font-medium ${settings.emailConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {settings.emailConfigured ? 'Configured' : 'Not Configured'}
                  </span>
                </div>
              </div>
              {settings.emailConfigured ? (
                <CheckCircleIcon className="w-8 h-8 text-emerald-500" />
              ) : (
                <XCircleIcon className="w-8 h-8 text-amber-500" />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Language card — moved here from the navbar so the navbar has room
          for all 11 nav items without overlapping the Settings link. */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <GlobeAltIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Language</h2>
            <p className="text-sm text-slate-500">Dashboard display language (English / עברית / العربية)</p>
          </div>
        </div>
        <LanguageSwitcher />
      </div>

      {/* Email Reports card — admin recipient for the "Send Approved Posts"
          button on the Posts + Admin pages. The SYSTEM_EMAIL_ALERT /
          SYSTEM_EMAIL_PASSWORD env vars also need to be set in Railway for
          the transport to work — `settings.emailConfigured` reflects that. */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <EnvelopeIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Email Reports</h2>
            <p className="text-sm text-slate-500">Where the &ldquo;Send Approved Posts&rdquo; button emails the report</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="admin-email" className="text-sm font-medium text-slate-700 block mb-2">
              Admin email
            </label>
            <div className="flex gap-2">
              <input
                id="admin-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={adminEmailDraft}
                onChange={(e) => setAdminEmailDraft(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm"
                disabled={adminEmailSaving}
              />
              <button
                onClick={commitAdminEmail}
                disabled={adminEmailSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {adminEmailSaving ? (
                  <>
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    Save
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Used by the &ldquo;Send Approved Posts&rdquo; button on the Posts and Admin pages. Leave blank to disable the export.
            </p>
          </div>

          {/* Transport status. Railway blocks outbound SMTP, so Resend is
              the only viable transport in production. We show which one is
              actually in use, and if neither is configured, give exact
              setup instructions. */}
          {settings.emailTransport === 'resend' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <CheckCircleIcon className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-800">
                Email transport: <b>Resend</b> (HTTP-based, works on Railway). Free tier covers 100 emails/day. The button will work.
              </p>
            </div>
          )}
          {settings.emailTransport === 'smtp' && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                Email transport: <b>Gmail SMTP</b>. <b>Railway blocks outbound SMTP</b> — sends will time out in production. For Railway, set
                <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded text-xs">RESEND_API_KEY</code>
                instead (get a free key at resend.com).
              </p>
            </div>
          )}
          {(!settings.emailTransport || settings.emailTransport === 'none') && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 space-y-1">
                <p>
                  <b>No email transport configured.</b> The export button will fail until one is set up.
                </p>
                <p>
                  Recommended: set
                  <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded text-xs">RESEND_API_KEY</code>
                  in Railway env (free tier 100 emails/day at <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="underline">resend.com</a>). Optional:
                  <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded text-xs">RESEND_FROM_EMAIL</code>
                  to send from a verified domain (defaults to
                  <code className="mx-1 px-1 py-0.5 bg-amber-100 rounded text-xs">onboarding@resend.dev</code>).
                </p>
              </div>
            </div>
          )}

          {adminEmailResult && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
              adminEmailResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}>
              {adminEmailResult.success ? <CheckCircleIcon className="w-5 h-5" /> : <XCircleIcon className="w-5 h-5" />}
              {adminEmailResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Classification Threshold Card.
          Slider sets the minimum confidence a post must score (strictly
          greater than) for it to count as historic everywhere: the messenger
          eligibility filter, the dashboard "Historic Posts" stat, and the
          "Historic" badge on the Posts page. Default 75; range 50-100. */}
      {settings.historicThreshold && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <SparklesIcon className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Classification Threshold</h2>
              <p className="text-sm text-slate-500">Minimum confidence for a post to be treated as historic</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="threshold-slider" className="text-sm font-medium text-slate-700">
                  Threshold
                </label>
                <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                  {thresholdDraft ?? settings.historicThreshold.value}%
                </span>
              </div>
              <input
                id="threshold-slider"
                type="range"
                min={settings.historicThreshold.min}
                max={settings.historicThreshold.max}
                step={1}
                value={thresholdDraft ?? settings.historicThreshold.value}
                onChange={(e) => setThresholdDraft(Number(e.target.value))}
                onMouseUp={(e) => commitThreshold(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => commitThreshold(Number((e.target as HTMLInputElement).value))}
                onKeyUp={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    commitThreshold(Number((e.target as HTMLInputElement).value));
                  }
                }}
                disabled={thresholdSaving}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>{settings.historicThreshold.min}% (looser)</span>
                <span>Default {settings.historicThreshold.default}%</span>
                <span>{settings.historicThreshold.max}% (stricter)</span>
              </div>
            </div>

            {(thresholdDraft ?? settings.historicThreshold.value) <= 60 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Below 60% will let event listings, photo captions, and one-liners through. Only loosen if you have a clear reason — the messenger will then attempt outreach on those posts.
                </p>
              </div>
            )}

            {thresholdSaveResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                thresholdSaveResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {thresholdSaveResult.success ? <CheckCircleIcon className="w-5 h-5" /> : <XCircleIcon className="w-5 h-5" />}
                {thresholdSaveResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Speed Card.
          Four-tick segmented selector for the scrape / classify / message
          cron cadence. "Normal" is the production default. "Fast" and
          "Aggressive" carry escalating warnings — Facebook's anti-bot will
          push back at higher cadences. */}
      {settings.speed && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <BoltIcon className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">System Speed</h2>
              <p className="text-sm text-slate-500">How often the scrape, classify, and message crons run</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SPEED_ORDER.map((p) => {
                const def = settings.speed!.presets[p];
                const isActive = settings.speed!.preset === p;
                const isAggressive = p === 'aggressive';
                const isFast = p === 'fast';
                const tone = isActive
                  ? isAggressive
                    ? 'bg-red-600 text-white border-red-600'
                    : isFast
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300';
                return (
                  <button
                    key={p}
                    onClick={() => commitSpeedPreset(p)}
                    disabled={speedSaving !== null || isActive}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${tone}`}
                    title={`${def.label}: scrape ${cronToHuman(def.schedules.scrape)}, classify ${cronToHuman(def.schedules.classify)}, message ${cronToHuman(def.schedules.message)}`}
                  >
                    {speedSaving === p ? '…' : def.label}
                  </button>
                );
              })}
            </div>

            {/* Show details for the currently active preset. */}
            {(() => {
              const def = settings.speed!.presets[settings.speed!.preset];
              const tone = def.danger
                ? 'bg-red-50 border-red-200 text-red-800'
                : def.warning
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700';
              return (
                <div className={`p-4 rounded-lg border ${tone}`}>
                  <p className="text-sm">{def.description}</p>
                  {def.warning && (
                    <div className="mt-2 flex items-start gap-2 text-sm">
                      <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{def.warning}</span>
                    </div>
                  )}
                  {def.danger && (
                    <div className="mt-2 flex items-start gap-2 text-sm font-semibold">
                      <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{def.danger}</span>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-slate-500">Scrape</p>
                      <p className="font-medium">{cronToHuman(def.schedules.scrape)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Classify</p>
                      <p className="font-medium">{cronToHuman(def.schedules.classify)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Message</p>
                      <p className="font-medium">{cronToHuman(def.schedules.message)}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {speedResult && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                speedResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}>
                {speedResult.success ? <CheckCircleIcon className="w-5 h-5" /> : <XCircleIcon className="w-5 h-5" />}
                {speedResult.message}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Facebook Session Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
            <UserCircleIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Facebook Session</h2>
            <p className="text-sm text-slate-500">Manage your Facebook authentication</p>
          </div>
        </div>

        {/* Session Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          {sessionLoading ? (
            <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
          ) : sessionStatus ? (
            <>
              {/* Current Status */}
              <div className={`p-4 rounded-lg ${sessionStatus.loggedIn ? 'bg-emerald-50 border border-emerald-100' : 'bg-red-50 border border-red-100'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Session Status</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${sessionStatus.loggedIn ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className={`font-semibold ${sessionStatus.loggedIn ? 'text-emerald-700' : 'text-red-700'}`}>
                        {sessionStatus.loggedIn ? 'Active' : 'Expired'}
                      </span>
                    </div>
                    {sessionStatus.userName && (
                      <p className="text-sm text-slate-600 mt-1">{sessionStatus.userName}</p>
                    )}
                  </div>
                  {sessionStatus.loggedIn ? (
                    <ShieldCheckIcon className="w-8 h-8 text-emerald-500" />
                  ) : (
                    <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
                  )}
                </div>
              </div>

              {/* Session Details */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-xs text-slate-500 mb-2">Session Details</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">User ID:</span>
                    <span className="text-slate-700 font-mono text-xs">{sessionStatus.userId || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Last Checked:</span>
                    <span className="text-slate-700 text-xs">
                      {sessionStatus.lastChecked ? new Date(sessionStatus.lastChecked).toLocaleString() : 'Never'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Private Groups:</span>
                    <span className={sessionStatus.canAccessPrivateGroups ? 'text-emerald-600' : 'text-amber-600'}>
                      {sessionStatus.canAccessPrivateGroups ? 'Accessible' : 'Limited'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="p-4 bg-amber-50 rounded-lg">
              <p className="text-amber-700">Unable to load session status</p>
            </div>
          )}
        </div>

        {/* Renew Result Message */}
        {sessionRenewResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg mb-5 ${
            sessionRenewResult.success ? 'bg-emerald-50' : 'bg-red-50'
          }`}>
            {sessionRenewResult.success ? (
              <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
            ) : (
              <XCircleIcon className="w-5 h-5 text-red-500" />
            )}
            <span className={`text-sm ${sessionRenewResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
              {sessionRenewResult.message}
            </span>
          </div>
        )}

        {/* Renew Button — opens a modal that asks the user for their FB
            email + password (+ optional 2FA code). On submit, the modal POSTs
            to /api/session/renew and polls /api/session/status. If FB rejects
            with a captcha/checkpoint we hand off to the Cookie Editor modal. */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={openCredentialsModal}
            disabled={renewingSession}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
              renewingSession
                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {renewingSession ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Logging in… (checking every 3 s)
              </>
            ) : (
              <>
                <ArrowPathIcon className="w-4 h-4" />
                Renew Session
              </>
            )}
          </button>
          <p className="text-xs text-slate-400">
            You&apos;ll enter your Facebook email + password. We try to log in
            for you. Usually finishes in 30-90 seconds.
          </p>
        </div>

        {/* Fallback banner: appears only when auto-login failed (captcha /
            checkpoint / persistent failure). Points the user at the
            Cookie Editor flow. */}
        {showCookieFallback && (
          <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <span className="text-slate-700">
              Facebook blocked the automated login. Switch to <b>Plan B</b> — paste
              your cookies (~30 sec one-time setup of a free Chrome extension).
            </span>
            <button
              onClick={() => {
                setSessionRenewResult(null);
                setShowCookieModal(true);
              }}
              className="ms-auto px-3 py-1.5 rounded-md text-xs font-medium bg-white border border-amber-300 text-amber-700 hover:bg-amber-100"
            >
              Use Plan B (paste cookies)
            </button>
          </div>
        )}
      </div>

      {/* Credentials Renewal Modal — primary path. User types FB email +
          password (+ optional 2FA code). Modal POSTs and polls; on captcha /
          checkpoint failure it hands off to the Cookie Editor modal. */}
      {showCredentialsModal && (
        <CredentialsRenewModal
          email={credentialsEmail}
          password={credentialsPassword}
          totpCode={credentialsTotp}
          show2fa={credentialsShow2fa}
          renewing={renewingSession}
          setEmail={setCredentialsEmail}
          setPassword={setCredentialsPassword}
          setTotpCode={setCredentialsTotp}
          setShow2fa={setCredentialsShow2fa}
          onClose={() => setShowCredentialsModal(false)}
          onSwitchToPlanB={() => {
            // User wants to bail out of the credentials flow and paste
            // cookies instead. Close this modal, open the Cookie Editor one.
            setShowCredentialsModal(false);
            setSessionRenewResult(null);
            setShowCookieModal(true);
          }}
          onSubmit={async () => {
            const result = await submitCredentialsRenewal(
              credentialsEmail.trim(),
              credentialsPassword,
              credentialsTotp.trim() || undefined
            );
            if (result.ok) {
              setSessionRenewResult({
                success: true,
                message: result.userId
                  ? `Facebook session renewed for user ${result.userId}.`
                  : 'Facebook session renewed successfully.',
              });
              setShowCredentialsModal(false);
              setCredentialsPassword('');
              setCredentialsTotp('');
              setCredentialsShow2fa(false);
              fetchSessionStatus();
              return { ok: true };
            }
            // Renewal failed. Decide UX based on the challenge type.
            if (result.challenge === '2fa') {
              setCredentialsShow2fa(true);
              // Pass the backend's message through; the modal renders it
              // INSIDE the yellow 2FA box (not a separate red banner) when
              // show2fa is true, which keeps the prompt and the feedback in
              // the same visual unit.
              return {
                ok: false,
                stayOpen: true,
                message: result.message,
              };
            }
            if (result.challenge === 'captcha' || result.challenge === 'checkpoint') {
              setShowCredentialsModal(false);
              setSessionRenewResult({ success: false, message: result.message });
              setShowCookieFallback(true);
              setShowCookieModal(true);
              return { ok: false, message: result.message };
            }
            // Generic error — keep modal open, surface message.
            return { ok: false, message: result.message, stayOpen: true };
          }}
        />
      )}

      {/* Cookie Upload Modal — Plan B (manual paste via Cookie Editor). */}
      {showCookieModal && (
        <CookieUploadModal
          cookieJson={cookieJson}
          setCookieJson={setCookieJson}
          onSave={handleUploadCookies}
          onClose={() => setShowCookieModal(false)}
          saving={renewingSession}
        />
      )}

      {/* Manual Triggers Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <Cog6ToothIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manual Triggers</h2>
            <p className="text-sm text-slate-500">Trigger operations manually with API key</p>
          </div>
        </div>

        {/* API Key Input */}
        <div className="mb-5">
          <label className="text-sm font-medium text-slate-700 block mb-2">API Key</label>
          <div className="relative">
            <KeyIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((v) => !v)}
              aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
            >
              {showApiKey ? (
                <EyeSlashIcon className="w-4 h-4" />
              ) : (
                <EyeIcon className="w-4 h-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Authenticates your dashboard with the backend. Stored locally in your
            browser only — never sent anywhere except this app&apos;s API.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircleIcon className="w-4 h-4" />
              Save API Key
            </button>
            <button
              type="button"
              onClick={handleClearApiKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <TrashIcon className="w-4 h-4" />
              Clear
            </button>
          </div>

          {apiKeyStatus && (
            <div
              className={`mt-3 flex items-center gap-2 p-3 rounded-lg ${
                apiKeyStatus.kind === 'saved' ? 'bg-emerald-50' : 'bg-slate-50'
              }`}
            >
              <CheckCircleIcon
                className={`w-5 h-5 ${
                  apiKeyStatus.kind === 'saved' ? 'text-emerald-500' : 'text-slate-500'
                }`}
              />
              <span
                className={`text-sm ${
                  apiKeyStatus.kind === 'saved' ? 'text-emerald-700' : 'text-slate-700'
                }`}
              >
                {apiKeyStatus.kind === 'saved'
                  ? 'API Key saved — all dashboard actions now active.'
                  : 'API Key cleared from this browser.'}
              </span>
            </div>
          )}
        </div>

        {/* Result Message */}
        {triggerResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg mb-5 ${
            triggerResult.success ? 'bg-emerald-50' : 'bg-red-50'
          }`}>
            {triggerResult.success ? (
              <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
            ) : (
              <XCircleIcon className="w-5 h-5 text-red-500" />
            )}
            <span className={`text-sm ${triggerResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
              {triggerResult.message}
            </span>
          </div>
        )}

        {/* Trigger Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={() => handleTrigger('scrape')}
            disabled={triggering !== null}
            className="btn-primary justify-center"
          >
            {triggering === 'scrape' ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <BoltIcon className="w-4 h-4" />
            )}
            {triggering === 'scrape' ? 'Scraping...' : 'Trigger Scrape'}
          </button>

          <button
            onClick={() => handleTrigger('classification')}
            disabled={triggering !== null}
            className="btn-secondary justify-center"
          >
            {triggering === 'classification' ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <SparklesIcon className="w-4 h-4" />
            )}
            {triggering === 'classification' ? 'Classifying...' : 'Trigger Classification'}
          </button>

          <button
            onClick={() => handleTrigger('message')}
            disabled={triggering !== null}
            className="btn-secondary justify-center"
          >
            {triggering === 'message' ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <ChatBubbleLeftRightIcon className="w-4 h-4" />
            )}
            {triggering === 'message' ? 'Sending...' : 'Trigger Messages'}
          </button>

          <button
            onClick={handleResetBreaker}
            disabled={resettingBreaker}
            className="btn-secondary justify-center"
            title="Force-reset the OpenAI circuit breaker to CLOSED. Useful after fixing OpenAI billing or transient quota issues — otherwise you'd wait 15 minutes for auto-recovery."
          >
            {resettingBreaker ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <BoltIcon className="w-4 h-4" />
            )}
            {resettingBreaker ? 'Resetting…' : 'Reset OpenAI Breaker'}
          </button>
        </div>
      </div>

      {/* Danger Zone - Reset Data */}
      <div className="bg-white border border-red-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
            <TrashIcon className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-red-900">Danger Zone</h2>
            <p className="text-sm text-red-600">Irreversible actions - proceed with caution</p>
          </div>
        </div>

        {/* Reset Result Message */}
        {resetResult && (
          <div className={`flex items-start gap-2 p-4 rounded-lg mb-5 ${
            resetResult.success ? 'bg-emerald-50' : 'bg-red-50'
          }`}>
            {resetResult.success ? (
              <CheckCircleIcon className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <span className={`text-sm font-medium ${resetResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
                {resetResult.message}
              </span>
              {resetResult.deleted && (
                <div className="mt-2 text-xs text-emerald-600 space-y-1">
                  <p>• {resetResult.deleted.posts} posts deleted</p>
                  <p>• {resetResult.deleted.classifications} classifications deleted</p>
                  <p>• {resetResult.deleted.generatedMessages} generated messages deleted</p>
                  <p>• {resetResult.deleted.sentMessages} sent messages deleted</p>
                  <p>• {resetResult.deleted.logs} logs deleted</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phantom-post cleanup. Runs the same `shouldSkipPost` filter the
            scraper uses against every row currently in the DB and removes
            anything that matches today's stricter criteria. Surfaces the
            reason histogram so the operator can see WHY rows were removed. */}
        <div className="p-4 bg-red-50 rounded-lg border border-red-100 mb-4">
          <h3 className="font-semibold text-red-900 mb-2">Clean Phantom Posts</h3>
          <p className="text-sm text-red-700 mb-4">
            Removes posts that the current scraper filter would reject (operator-self chrome, group rules, no-author rows). Useful after a stricter filter ships — runs the live filter against existing data so it can&apos;t drift.
          </p>

          {cleanupResult && (
            <div className={`mb-3 p-3 rounded-lg text-sm ${
              cleanupResult.success ? 'bg-white border border-emerald-200 text-emerald-800' : 'bg-white border border-red-200 text-red-800'
            }`}>
              <p className="font-medium">{cleanupResult.message}</p>
              {cleanupResult.reasons && Object.keys(cleanupResult.reasons).length > 0 && (
                <ul className="mt-2 text-xs space-y-1">
                  {Object.entries(cleanupResult.reasons).map(([reason, count]) => (
                    <li key={reason}>• {count}× {reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            onClick={handleCleanupPhantoms}
            disabled={cleaningPhantoms}
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cleaningPhantoms ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Scanning posts…
              </>
            ) : (
              <>
                <TrashIcon className="w-4 h-4" />
                Run phantom cleanup
              </>
            )}
          </button>
        </div>

        {/* Reset Data Section */}
        <div className="p-4 bg-red-50 rounded-lg border border-red-100">
          <h3 className="font-semibold text-red-900 mb-2">Reset All Data</h3>
          <p className="text-sm text-red-700 mb-4">
            This will permanently delete all scraped posts, AI classifications, generated messages,
            sent messages, and system logs. This action cannot be undone.
          </p>

          {!showResetConfirm ? (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              <TrashIcon className="w-4 h-4" />
              Reset All Data
            </button>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-lg border-2 border-red-300">
                <p className="text-sm font-medium text-red-900 mb-3">
                  ⚠️ Are you absolutely sure? This will delete ALL data!
                </p>
                <p className="text-sm text-red-700 mb-3">
                  Type <strong className="font-mono bg-red-100 px-1 rounded">DELETE ALL DATA</strong> to confirm:
                </p>
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder="Type here to confirm..."
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  disabled={resetting}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleResetData}
                  disabled={resetting || resetConfirmText !== 'DELETE ALL DATA'}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    resetConfirmText === 'DELETE ALL DATA' && !resetting
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {resetting ? (
                    <>
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <TrashIcon className="w-4 h-4" />
                      Yes, Delete Everything
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowResetConfirm(false);
                    setResetConfirmText('');
                  }}
                  disabled={resetting}
                  className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

export const getServerSideProps = async () => {
  return { props: {} };
};

// ============================================================================
// CookieUploadModal — clean, self-contained, lives at the bottom of the file
// so it can share the strict tsconfig settings of the page.
// ============================================================================

interface CookieUploadModalProps {
  cookieJson: string;
  setCookieJson: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

const CookieUploadModal: React.FC<CookieUploadModalProps> = ({
  cookieJson,
  setCookieJson,
  onSave,
  onClose,
  saving,
}) => {
  // Live preview: do we appear to have c_user and xs?
  const preview = React.useMemo(() => {
    const trimmed = cookieJson.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : null;
      if (!arr) return { ok: false, msg: 'JSON parsed, but no cookies array detected.' };
      const fb = arr.filter((c: { domain?: string }) => typeof c?.domain === 'string' && c.domain.includes('facebook.com'));
      const hasCUser = fb.some((c: { name?: string }) => c?.name === 'c_user');
      const hasXs = fb.some((c: { name?: string }) => c?.name === 'xs');
      if (hasCUser && hasXs) {
        return { ok: true, msg: `Detected c_user + xs (${fb.length} facebook.com cookies in total).` };
      }
      const missing = [!hasCUser && 'c_user', !hasXs && 'xs'].filter(Boolean).join(' and ');
      return { ok: false, msg: `Missing ${missing}. Make sure you're logged into Facebook before exporting.` };
    } catch {
      return { ok: false, msg: 'Not valid JSON yet — paste the full Cookie-Editor export.' };
    }
  }, [cookieJson]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-amber-100 bg-amber-50/40">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                <h3 className="text-lg font-semibold text-slate-900">
                  Plan B — paste your Facebook cookies
                </h3>
              </div>
              <p className="text-sm text-slate-600">
                Use this if the automatic login didn&apos;t work. About 30 seconds
                the first time (installing a free Chrome extension), ~10 seconds
                every time after.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Step-by-step instructions */}
          <div className="space-y-3">
            {/* Step 1 — Install Cookie Editor */}
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">
                1
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  Install <b>Cookie Editor</b> (free, official Chrome store)
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  One click. 2M+ users. No developer mode warnings.
                </p>
                <a
                  href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                >
                  <KeyIcon className="w-3.5 h-3.5" />
                  Install Cookie Editor
                </a>
              </div>
            </div>

            {/* Step 2 — Log into Facebook */}
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">
                2
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  Open Facebook in a new tab and log in
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Skip this step if you&apos;re already logged in.
                </p>
                <a
                  href="https://www.facebook.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  Open facebook.com →
                </a>
              </div>
            </div>

            {/* Step 3 — Export from Cookie Editor */}
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">
                3
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  While on the Facebook tab, click the Cookie Editor icon
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Look for the cookie icon in your browser toolbar (top-right). If
                  you don&apos;t see it, click the <b>puzzle-piece</b> icon → pin Cookie
                  Editor.
                </p>
                <p className="text-xs text-slate-700 mt-1.5">
                  In the popup: click <b>Export</b> (bottom button) → choose{' '}
                  <b>Export as JSON</b>. Cookies are now copied to your clipboard.
                </p>
              </div>
            </div>

            {/* Step 4 — Paste and save */}
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-sm font-semibold flex items-center justify-center">
                4
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  Come back here, paste below, then click <b>Save Cookies</b>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  We&apos;ll check that the right cookies are in there and tell you
                  if anything is missing.
                </p>
              </div>
            </div>
          </div>

          {/* Textarea */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-2">
              Cookies JSON
            </label>
            <textarea
              value={cookieJson}
              onChange={(e) => setCookieJson(e.target.value)}
              placeholder='[ { "name": "c_user", "value": "...", "domain": ".facebook.com", ... }, ... ]'
              spellCheck={false}
              className="w-full h-40 p-3 border border-slate-200 rounded-lg text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {preview && (
              <div
                className={`mt-2 flex items-start gap-2 p-2 rounded-md text-xs ${
                  preview.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {preview.ok ? (
                  <CheckCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                )}
                <span>{preview.msg}</span>
              </div>
            )}
          </div>

          {/* Privacy note */}
          <p className="text-xs text-slate-500">
            Cookies are sent only to this app&apos;s API and stored on the server to keep the
            scraper logged in. They are never shared elsewhere.
          </p>
        </div>

        <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !preview?.ok}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircleIcon className="w-4 h-4" />
                Save Cookies
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// CredentialsRenewModal — primary path. Asks the user for their Facebook
// email + password (and optionally a 2FA code). On submit the parent does
// the actual POST + polling and tells us what happened via the onSubmit
// return value: success closes the modal; 2FA failure shows the code field
// inline; captcha/checkpoint hands off to the Cookie Editor modal.
// ============================================================================

interface CredentialsRenewModalProps {
  email: string;
  password: string;
  totpCode: string;
  show2fa: boolean;
  renewing: boolean;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  setTotpCode: (v: string) => void;
  setShow2fa: (v: boolean) => void;
  onClose: () => void;
  /** Closes this modal and opens the Cookie Editor paste modal. Escape hatch
   *  the user can take any time — useful when FB throws a challenge they
   *  don't want to / can't satisfy here. */
  onSwitchToPlanB: () => void;
  onSubmit: () => Promise<{ ok: boolean; message?: string; stayOpen?: boolean }>;
}

const CredentialsRenewModal: React.FC<CredentialsRenewModalProps> = ({
  email,
  password,
  totpCode,
  show2fa,
  renewing,
  setEmail,
  setPassword,
  setTotpCode,
  setShow2fa,
  onClose,
  onSwitchToPlanB,
  onSubmit,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const totpInputRef = React.useRef<HTMLInputElement | null>(null);

  // Auto-focus the 2FA field the moment it appears, so the user gets a clear
  // visual signal ("type your code here") instead of having to find it.
  React.useEffect(() => {
    if (show2fa && totpInputRef.current) {
      totpInputRef.current.focus();
    }
  }, [show2fa]);

  const handleSubmit = async () => {
    setLocalError(null);
    if (!email.trim() || !password) {
      setLocalError('Enter your Facebook email and password.');
      return;
    }
    const res = await onSubmit();
    if (!res.ok && res.stayOpen && res.message) {
      setLocalError(res.message);
    }
  };

  // When show2fa is true the error belongs INSIDE the yellow box (the
  // yellow box and the error message are about the same thing — the 2FA
  // code — so they should sit visually together rather than as a red
  // banner below).
  const errorBelongsInYellowBox = show2fa && Boolean(localError);
  const errorBelongsInRedBanner = !show2fa && Boolean(localError);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={renewing ? undefined : onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Renew Facebook Session
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Enter your Facebook credentials. We&apos;ll log in for you and save the cookies.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              disabled={renewing}
              className="text-slate-400 hover:text-slate-600 p-1 disabled:opacity-40"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Email */}
          <div>
            <label htmlFor="fb-email" className="text-sm font-medium text-slate-700 block mb-1.5">
              Facebook email
            </label>
            <input
              id="fb-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={renewing}
              autoFocus
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
            />
          </div>

          {/* Password */}
          <div>
            <label htmlFor="fb-pass" className="text-sm font-medium text-slate-700 block mb-1.5">
              Facebook password
            </label>
            <div className="relative">
              <input
                id="fb-pass"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                disabled={renewing}
                className="w-full px-3 py-2 pr-10 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? (
                  <EyeSlashIcon className="w-4 h-4" />
                ) : (
                  <EyeIcon className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* 2FA code — hidden by default, shown automatically if FB asks
              for one, or revealed manually via the link below. */}
          {show2fa ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <label htmlFor="fb-totp" className="text-sm font-medium text-amber-900 block mb-1">
                Facebook wants a 2FA code
              </label>
              <p className="text-xs text-amber-800 mb-2">
                Open your authenticator app (Google Authenticator, Authy, etc.) and type the current 6-digit code below, then click <b>Log in &amp; save cookies</b>.
              </p>
              <input
                id="fb-totp"
                ref={totpInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={8}
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                disabled={renewing}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm font-mono tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-amber-100"
              />
              {/* When a 2FA-related error comes back (most often "code was
                  wrong, try again"), show it inside the yellow box so the
                  prompt and the feedback sit together. */}
              {errorBelongsInYellowBox && (
                <p className="mt-2 text-xs text-amber-900 flex items-start gap-1.5">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{localError}</span>
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShow2fa(true)}
              disabled={renewing}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50"
            >
              I have 2FA enabled on Facebook →
            </button>
          )}

          {/* Red banner — only for errors that AREN'T about 2FA (e.g. wrong
              email/password, network error). When 2FA is the topic the error
              renders inside the yellow box above instead. Always includes the
              Plan B escape hatch. */}
          {errorBelongsInRedBanner && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-red-700">{localError}</span>
              </div>
              <button
                type="button"
                onClick={onSwitchToPlanB}
                disabled={renewing}
                className="text-xs font-medium text-red-700 hover:text-red-900 underline disabled:opacity-50"
              >
                Or skip this and paste your cookies manually (Plan B) →
              </button>
            </div>
          )}

          {/* Privacy note */}
          <p className="text-xs text-slate-500">
            Your credentials go only to this app&apos;s server, which uses them to log in to Facebook on
            your behalf. They are not stored — only the resulting session cookies are.
          </p>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 space-y-3">
          {/* Always-visible Plan B escape hatch — small, low-emphasis, but
              never hidden. The user should never feel trapped in this modal. */}
          <div className="text-center">
            <button
              type="button"
              onClick={onSwitchToPlanB}
              disabled={renewing}
              className="text-xs text-slate-500 hover:text-slate-700 underline disabled:opacity-50"
            >
              Don&apos;t want to log in here? Paste your Facebook cookies instead →
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={renewing}
              className="px-4 py-2 rounded-md text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={renewing || !email.trim() || !password}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {renewing ? (
                <>
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  Logging in… (up to ~90s)
                </>
              ) : (
                <>
                  <ShieldCheckIcon className="w-4 h-4" />
                  Log in &amp; save cookies
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
