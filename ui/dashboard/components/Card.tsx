import React from 'react';

type CardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
};

const Card: React.FC<CardProps> = ({ title, value, subtitle }) => (
  <div className="bg-white shadow rounded p-4">
    <p className="text-sm text-gray-500">{title}</p>
    <p className="text-2xl font-semibold">{value}</p>
    {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
  </div>
);

export default Card;
