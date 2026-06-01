import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch, getApiKey, setApiKey as persistApiKey, clearApiKey } from '../utils/api';
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

interface Settings {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
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

  // Reset data state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; message: string; deleted?: Record<string, number> } | null>(null);

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

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await apiFetch('/api/settings');
        if (!res.ok) {
          throw new Error('Failed to fetch settings');
        }
        const data = await res.json();
        setSettings(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
    fetchSessionStatus();
  }, [fetchSessionStatus]);

  // Primary one-click flow.
  //
  // The server returns 202 IMMEDIATELY and runs the headless login in the
  // background. We then poll /api/session/status every 3 s to learn the result.
  // This avoids Railway's proxy 504 timeout that synchronous long requests hit.
  const handleAutoRenew = async () => {
    if (renewingSession) return;
    setRenewingSession(true);
    setSessionRenewResult(null);
    setShowCookieFallback(false);

    try {
      // 1. Kick off the background renewal (fast response, no proxy timeout risk)
      const startRes = await apiFetch('/api/session/renew', {
        method: 'POST',
        skipAuth: true,
        timeout: 15_000,
      });

      if (!startRes.ok && startRes.status !== 202 && startRes.status !== 409) {
        // Try to read JSON, but tolerate non-JSON responses (e.g., proxy HTML)
        let msg = `Unable to start renewal (HTTP ${startRes.status})`;
        try {
          const data = await startRes.json();
          msg = data?.message || data?.error || msg;
        } catch { /* response wasn't JSON — keep status-based message */ }
        throw new Error(msg);
      }
      // status 409 means a previous renewal is still running — that's fine,
      // we just continue to the polling loop.

      // 2. Poll status until the background job finishes or we hit the cap.
      // 240s gives the 200s server-side hard timeout time to fire and the
      // status endpoint time to expose the result.
      const POLL_TIMEOUT_MS = 240_000;
      const POLL_INTERVAL_MS = 3_000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        let statusData: SessionStatus & {
          renewal?: {
            running: boolean;
            lastError: string | null;
            requiresManualUpload: boolean;
          };
        };
        try {
          const statusRes = await apiFetch('/api/session/status');
          if (!statusRes.ok) continue;
          statusData = await statusRes.json();
        } catch {
          // Network blip — try again next tick
          continue;
        }

        // Always refresh the displayed session card while we're polling
        setSessionStatus(statusData);

        const renewal = statusData.renewal;
        if (renewal && !renewal.running) {
          // Background job finished
          if (renewal.lastError) {
            setSessionRenewResult({ success: false, message: renewal.lastError });
            if (renewal.requiresManualUpload) setShowCookieFallback(true);
          } else if (statusData.sessionHealth?.status === 'valid') {
            setSessionRenewResult({
              success: true,
              message: 'Facebook session renewed successfully.',
            });
          } else {
            setSessionRenewResult({
              success: false,
              message: 'Renewal finished but the session is still not valid.',
            });
            setShowCookieFallback(true);
          }
          return;
        }
        // Otherwise it's still running — keep polling.
      }

      // 3. Hit the soft cap without a definitive result
      setSessionRenewResult({
        success: false,
        message: 'Renewal is taking longer than 3 minutes. It may still complete in the background — refresh this page in a minute, or use manual upload.',
      });
      setShowCookieFallback(true);
    } catch (err) {
      setSessionRenewResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to start renewal.',
      });
      setShowCookieFallback(true);
    } finally {
      setRenewingSession(false);
    }
  };

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
      const res = await apiFetch('/api/data/reset', { method: 'DELETE' });
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

        {/* Renew Button */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={handleAutoRenew}
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
            Server logs in to Facebook with your saved credentials. Usually finishes in 30-90 seconds.
          </p>
        </div>

        {/* Fallback: appears only when auto-login fails (captcha / 2FA / FB block) */}
        {showCookieFallback && (
          <div className="mt-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-sm flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <span className="text-slate-700">
              Facebook blocked the automated login. Upload your cookies manually instead:
            </span>
            <button
              onClick={() => {
                setSessionRenewResult(null);
                setShowCookieModal(true);
              }}
              className="ms-auto px-3 py-1.5 rounded-md text-xs font-medium bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              Upload cookies manually
            </button>
          </div>
        )}
      </div>

      {/* Cookie Upload Modal — fallback path only */}
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
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Renew Facebook Session</h3>
              <p className="text-sm text-slate-500 mt-1">
                Upload fresh cookies from your browser. Takes ~30 seconds.
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
          {/* Instructions */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
            <p className="text-sm font-medium text-slate-700 mb-3">How to get your cookies:</p>
            <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
              <li>
                Install{' '}
                <a
                  href="https://cookie-editor.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  Cookie-Editor
                </a>{' '}
                (free, works in Chrome/Firefox/Safari/Edge). One-time, ~20 sec.
              </li>
              <li>
                Open{' '}
                <a
                  href="https://www.facebook.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  facebook.com
                </a>{' '}
                in a new tab and make sure you&apos;re logged in.
              </li>
              <li>
                Click the Cookie-Editor icon in your toolbar → click <b>Export</b> → choose{' '}
                <b>Export as JSON</b>. It auto-copies to your clipboard.
              </li>
              <li>Come back here and paste in the box below, then Save.</li>
            </ol>
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
