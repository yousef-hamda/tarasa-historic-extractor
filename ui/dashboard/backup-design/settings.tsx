import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

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
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Settings</h1>
        <p className="text-red-500">Error: {error || 'Failed to load settings'}</p>
        <p className="text-gray-500 mt-2">Make sure the API server is running on port 4000.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Facebook Groups</h2>
        {settings.groups.length > 0 ? (
          <ul className="list-disc list-inside">
            {settings.groups.map((group) => (
              <li key={group}>{group}</li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No groups configured</p>
        )}
      </section>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Message Limits</h2>
        <p>Max per day: {settings.messageLimit}</p>
      </section>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Tarasa URL</h2>
        <p className="text-sm text-gray-600 break-all">{settings.baseTarasaUrl}</p>
      </section>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Email Alerts</h2>
        <p>
          Status:{' '}
          <span className={settings.emailConfigured ? 'text-green-600' : 'text-yellow-600'}>
            {settings.emailConfigured ? 'Configured' : 'Not configured'}
          </span>
        </p>
      </section>

      <section className="bg-white shadow rounded p-4 space-y-4">
        <h2 className="text-lg font-semibold">Manual Triggers</h2>
        <p className="text-sm text-gray-600">
          Trigger operations manually. Requires API key for authentication.
        </p>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">API Key:</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key"
            className="flex-1 border rounded px-3 py-1 text-sm"
          />
        </div>

        {triggerResult && (
          <div
            className={`p-3 rounded text-sm ${
              triggerResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}
          >
            {triggerResult.message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => handleTrigger('scrape')}
            disabled={triggering !== null}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering === 'scrape' ? 'Scraping...' : 'Trigger Scrape'}
          </button>
          <button
            onClick={() => handleTrigger('classification')}
            disabled={triggering !== null}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering === 'classification' ? 'Classifying...' : 'Trigger Classification'}
          </button>
          <button
            onClick={() => handleTrigger('message')}
            disabled={triggering !== null}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {triggering === 'message' ? 'Sending...' : 'Trigger Messages'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
