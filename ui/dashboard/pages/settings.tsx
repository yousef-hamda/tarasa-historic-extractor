import React, { useEffect, useState } from 'react';
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
} from '@heroicons/react/24/outline';

interface Settings {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
}

type TriggerType = 'scrape' | 'classification' | 'message';

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [triggering, setTriggering] = useState<TriggerType | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ type: TriggerType; success: boolean; message: string } | null>(null);

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
  }, []);

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
