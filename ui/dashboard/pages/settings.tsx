import React from 'react';
import type { GetServerSideProps } from 'next';

interface SettingsPageProps {
  groups: string[];
  messageLimit: string;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ groups, messageLimit }) => {

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

export const getServerSideProps: GetServerSideProps<SettingsPageProps> = async () => {
  const groups = (process.env.GROUP_IDS || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);

  return {
    props: {
      groups,
      messageLimit: process.env.MAX_MESSAGES_PER_DAY || '20',
    },
  };
};

export default SettingsPage;
