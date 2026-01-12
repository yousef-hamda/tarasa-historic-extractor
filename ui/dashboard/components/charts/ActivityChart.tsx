import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ActivityData {
  date: string;
  posts: number;
  classified: number;
  messages: number;
}

interface ActivityChartProps {
  data: ActivityData[];
  height?: number;
}

const ActivityChart: React.FC<ActivityChartProps> = ({ data, height = 300 }) => {
  if (!data || data.length === 0) {
    return (
      <div
        className="bg-white rounded-lg shadow p-6 flex items-center justify-center text-gray-500"
        style={{ height }}
      >
        No activity data available
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Activity Overview</h3>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorPosts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="colorClassified" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="colorMessages" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="posts"
            name="Posts Scraped"
            stroke="#3b82f6"
            fillOpacity={1}
            fill="url(#colorPosts)"
          />
          <Area
            type="monotone"
            dataKey="classified"
            name="Classified"
            stroke="#8b5cf6"
            fillOpacity={1}
            fill="url(#colorClassified)"
          />
          <Area
            type="monotone"
            dataKey="messages"
            name="Messages Sent"
            stroke="#22c55e"
            fillOpacity={1}
            fill="url(#colorMessages)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ActivityChart;
