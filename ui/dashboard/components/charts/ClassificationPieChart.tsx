import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

interface ClassificationPieChartProps {
  historic: number;
  nonHistoric: number;
  height?: number;
}

const COLORS = ['#22c55e', '#6b7280'];

const ClassificationPieChart: React.FC<ClassificationPieChartProps> = ({
  historic,
  nonHistoric,
  height = 250,
}) => {
  const data = [
    { name: 'Historic', value: historic },
    { name: 'Non-Historic', value: nonHistoric },
  ];

  const total = historic + nonHistoric;

  if (total === 0) {
    return (
      <div
        className="bg-white rounded-lg shadow p-6 flex items-center justify-center text-gray-500"
        style={{ height }}
      >
        No classification data
      </div>
    );
  }

  const historicPercent = Math.round((historic / total) * 100);

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Classification Distribution</h3>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
            label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => [value, 'Posts']}
            contentStyle={{
              backgroundColor: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
            }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      <div className="text-center mt-2">
        <span className="text-2xl font-bold text-green-600">{historicPercent}%</span>
        <span className="text-gray-500 ml-2">historic content</span>
      </div>
    </div>
  );
};

export default ClassificationPieChart;
