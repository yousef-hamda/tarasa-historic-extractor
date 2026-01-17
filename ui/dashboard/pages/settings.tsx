import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
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
  const [triggering, setTriggering] = useState<TriggerType | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ type: TriggerType; success: boolean; message: string } | null>(null);

  // Session state
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [renewingSession, setRenewingSession] = useState(false);
  const [sessionRenewResult, setSessionRenewResult] = useState<{ success: boolean; message: string } | null>(null);

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

  const handleRenewSession = async () => {
    if (renewingSession) return;

    setRenewingSession(true);
    setSessionRenewResult(null);

    try {
      const res = await apiFetch('/api/session/renew', { method: 'POST' });
      const data = await res.json();

      if (res.ok && data.success) {
        setSessionRenewResult({ success: true, message: data.message });
        // Refresh session status
        await fetchSessionStatus();
      } else {
        setSessionRenewResult({
          success: false,
          message: data.hint || data.message || 'Session renewal failed',
        });
      }
    } catch (err) {
      setSessionRenewResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to renew session',
      });
    } finally {
      setRenewingSession(false);
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
      const res = await fetch(endpoints[type], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
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
        <div className="flex items-center gap-4">
          <button
            onClick={handleRenewSession}
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
                Renewing Session...
              </>
            ) : (
              <>
                <ArrowPathIcon className="w-4 h-4" />
                Renew Session
              </>
            )}
          </button>
          <p className="text-xs text-slate-400">
            Opens a browser to verify and refresh your Facebook login
          </p>
        </div>
      </div>

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
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm"
            />
          </div>
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
    </div>
  );
};

export default SettingsPage;

export const getServerSideProps = async () => {
  return { props: {} };
};
