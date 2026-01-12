import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ConfidenceData {
  range: string;
  count: number;
  color: string;
}

interface ConfidenceDistributionProps {
  low: number;    // 0-49%
  medium: number; // 50-74%
  high: number;   // 75-100%
  height?: number;
}

const ConfidenceDistribution: React.FC<ConfidenceDistributionProps> = ({
  low,
  medium,
  high,
  height = 200,
}) => {
  const data: ConfidenceData[] = [
    { range: '0-49%', count: low, color: '#ef4444' },
    { range: '50-74%', count: medium, color: '#eab308' },
    { range: '75-100%', count: high, color: '#22c55e' },
  ];

  const total = low + medium + high;

  if (total === 0) {
    return (
      <div
        className="bg-white rounded-lg shadow p-6 flex items-center justify-center text-gray-500"
        style={{ height }}
      >
        No confidence data
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Confidence Distribution</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="range"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <Tooltip
            formatter={(value) => [value, 'Posts']}
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
          />
          <Bar
            dataKey="count"
            fill="#3b82f6"
            radius={[4, 4, 0, 0]}
            // Custom color based on range
            // @ts-ignore - Recharts typing issue
            shape={(props: { x: number; y: number; width: number; height: number; payload: ConfidenceData }) => {
              const { x, y, width, height, payload } = props;
              return (
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={payload.color}
                  rx={4}
                  ry={4}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-around mt-3 text-sm">
        <div className="text-center">
          <span className="font-bold text-red-600">{low}</span>
          <span className="text-gray-500 ml-1">Low</span>
        </div>
        <div className="text-center">
          <span className="font-bold text-yellow-600">{medium}</span>
          <span className="text-gray-500 ml-1">Medium</span>
        </div>
        <div className="text-center">
          <span className="font-bold text-green-600">{high}</span>
          <span className="text-gray-500 ml-1">High</span>
        </div>
      </div>
    </div>
  );
};

export default ConfidenceDistribution;
