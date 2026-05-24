import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

type SettingsPayload = {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
};

const defaultSettings: SettingsPayload = {
  groups: [],
  messageLimit: 20,
  baseTarasaUrl: 'https://tarasa.com/add-story',
  emailConfigured: false,
};

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SettingsPayload>(defaultSettings);

  useEffect(() => {
    apiFetch('/api/settings')
      .then((res) => res.json())
      .then((payload: SettingsPayload) => setSettings(payload))
      .catch((error) => console.error('Failed to load settings', error));
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="bg-white shadow rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold">Facebook Groups</h2>
        {settings.groups.length ? (
          <ul className="list-disc list-inside space-y-1">
            {settings.groups.map((group) => (
              <li key={group}>{group}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No groups configured.</p>
        )}
      </section>
      <section className="bg-white shadow rounded p-4 space-y-1">
        <h2 className="text-lg font-semibold">Message Limits</h2>
        <p>Max messages per day: {settings.messageLimit}</p>
      </section>
      <section className="bg-white shadow rounded p-4 space-y-1">
        <h2 className="text-lg font-semibold">Tarasa Submission Link</h2>
        <p className="break-all">{settings.baseTarasaUrl}</p>
      </section>
      <section className="bg-white shadow rounded p-4 space-y-1">
        <h2 className="text-lg font-semibold">Email Alerts</h2>
        <p className="text-sm text-gray-700">
          {settings.emailConfigured
            ? 'Email alerts are configured for login challenges.'
            : 'Email alerts are not configured.'}
        </p>
      </section>
    </div>
  );
};

export default SettingsPage;
