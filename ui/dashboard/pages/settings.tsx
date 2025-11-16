import React from 'react';

const SettingsPage: React.FC = () => {
  const groups = process.env.GROUP_IDS?.split(',') || [];
  const messageLimit = process.env.MAX_MESSAGES_PER_DAY || '20';

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Facebook Groups</h2>
        <ul className="list-disc list-inside">
          {groups.map((group) => (
            <li key={group}>{group}</li>
          ))}
        </ul>
      </section>
      <section className="bg-white shadow rounded p-4">
        <h2 className="text-lg font-semibold">Message Limits</h2>
        <p>Max per day: {messageLimit}</p>
      </section>
    </div>
  );
};

export default SettingsPage;
