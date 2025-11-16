import React, { useEffect, useState } from 'react';

type SettingsPayload = {
  groups: string[];
  messageLimit: number;
  baseTarasaUrl: string;
  emailConfigured: boolean;
};

const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SettingsPayload>({
    groups: [],
    messageLimit: 0,
    baseTarasaUrl: '',
    emailConfigured: false,
  });

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((payload) => setSettings(payload));
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="bg-white shadow rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold">Facebook Groups</h2>
        {settings.groups.length ? (
          <ul className="list-disc list-inside">
            {settings.groups.map((group) => (
              <li key={group}>{group}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No groups configured.</p>
        )}
      </section>
      <section className="bg-white shadow rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold">Message Limits</h2>
        <p>Max per day: {settings.messageLimit || '—'}</p>
      </section>
      <section className="bg-white shadow rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold">Tarasa Submission Link</h2>
        <p>{settings.baseTarasaUrl || 'Not configured'}</p>
      </section>
      <section className="bg-white shadow rounded p-4 space-y-2">
        <h2 className="text-lg font-semibold">Alert Emails</h2>
        <p>{settings.emailConfigured ? 'Configured' : 'Not configured'} (SYSTEM_EMAIL_ALERT)</p>
      </section>
    </div>
  );
};

export default SettingsPage;
