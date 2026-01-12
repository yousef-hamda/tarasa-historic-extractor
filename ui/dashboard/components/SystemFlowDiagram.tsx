import React from 'react';
import {
  GlobeAltIcon,
  CircleStackIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

interface SystemFlowDiagramProps {
  healthStatus?: {
    database: boolean;
    facebookSession: boolean;
    openaiKey: boolean;
    apifyToken: boolean;
  };
  stats?: {
    postsTotal: number;
    classifiedTotal: number;
    historicTotal: number;
    queueCount: number;
    sentLast24h: number;
  };
}

const SystemFlowDiagram: React.FC<SystemFlowDiagramProps> = ({ healthStatus, stats }) => {
  const stages = [
    {
      id: 'scrape',
      title: 'Scrape',
      description: 'Facebook Groups',
      icon: GlobeAltIcon,
      color: 'blue',
      stat: stats?.postsTotal ?? 0,
      statLabel: 'Posts',
      healthy: healthStatus?.facebookSession && healthStatus?.apifyToken,
    },
    {
      id: 'store',
      title: 'Store',
      description: 'PostgreSQL DB',
      icon: CircleStackIcon,
      color: 'purple',
      stat: stats?.postsTotal ?? 0,
      statLabel: 'Stored',
      healthy: healthStatus?.database,
    },
    {
      id: 'classify',
      title: 'Classify',
      description: 'OpenAI GPT-4',
      icon: SparklesIcon,
      color: 'indigo',
      stat: stats?.classifiedTotal ?? 0,
      statLabel: 'Classified',
      healthy: healthStatus?.openaiKey,
    },
    {
      id: 'queue',
      title: 'Queue',
      description: 'Historic Posts',
      icon: ChatBubbleLeftRightIcon,
      color: 'green',
      stat: stats?.queueCount ?? 0,
      statLabel: 'In Queue',
      healthy: true,
    },
    {
      id: 'send',
      title: 'Send',
      description: 'Messages',
      icon: EnvelopeIcon,
      color: 'orange',
      stat: stats?.sentLast24h ?? 0,
      statLabel: 'Sent (24h)',
      healthy: healthStatus?.facebookSession,
    },
  ];

  const getColorClasses = (color: string, healthy?: boolean) => {
    if (healthy === false) {
      return {
        bg: 'bg-red-100',
        iconBg: 'bg-red-200',
        icon: 'text-red-600',
        border: 'border-red-300',
        text: 'text-red-800',
      };
    }

    const colors: Record<string, { bg: string; iconBg: string; icon: string; border: string; text: string }> = {
      blue: { bg: 'bg-blue-50', iconBg: 'bg-blue-100', icon: 'text-blue-600', border: 'border-blue-200', text: 'text-blue-800' },
      purple: { bg: 'bg-purple-50', iconBg: 'bg-purple-100', icon: 'text-purple-600', border: 'border-purple-200', text: 'text-purple-800' },
      indigo: { bg: 'bg-indigo-50', iconBg: 'bg-indigo-100', icon: 'text-indigo-600', border: 'border-indigo-200', text: 'text-indigo-800' },
      green: { bg: 'bg-green-50', iconBg: 'bg-green-100', icon: 'text-green-600', border: 'border-green-200', text: 'text-green-800' },
      orange: { bg: 'bg-orange-50', iconBg: 'bg-orange-100', icon: 'text-orange-600', border: 'border-orange-200', text: 'text-orange-800' },
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6">System Pipeline</h3>

      {/* Desktop View - Horizontal Flow */}
      <div className="hidden lg:flex items-center justify-between">
        {stages.map((stage, index) => {
          const colors = getColorClasses(stage.color, stage.healthy);
          const Icon = stage.icon;

          return (
            <React.Fragment key={stage.id}>
              <div className={`flex flex-col items-center p-4 rounded-xl ${colors.bg} border ${colors.border} relative min-w-[120px]`}>
                {/* Health indicator */}
                <div className="absolute -top-2 -right-2">
                  {stage.healthy ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-500 bg-white rounded-full" />
                  ) : (
                    <XCircleIcon className="h-5 w-5 text-red-500 bg-white rounded-full" />
                  )}
                </div>

                <div className={`p-3 rounded-full ${colors.iconBg} mb-3`}>
                  <Icon className={`h-6 w-6 ${colors.icon}`} />
                </div>
                <h4 className={`font-semibold ${colors.text}`}>{stage.title}</h4>
                <p className="text-xs text-gray-500 mt-1">{stage.description}</p>
                <div className="mt-3 text-center">
                  <p className={`text-xl font-bold ${colors.text}`}>{stage.stat.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{stage.statLabel}</p>
                </div>
              </div>

              {index < stages.length - 1 && (
                <div className="flex items-center px-2">
                  <ArrowRightIcon className="h-6 w-6 text-gray-300" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Mobile/Tablet View - Vertical Flow */}
      <div className="lg:hidden space-y-4">
        {stages.map((stage, index) => {
          const colors = getColorClasses(stage.color, stage.healthy);
          const Icon = stage.icon;

          return (
            <React.Fragment key={stage.id}>
              <div className={`flex items-center gap-4 p-4 rounded-xl ${colors.bg} border ${colors.border} relative`}>
                {/* Health indicator */}
                <div className="absolute top-2 right-2">
                  {stage.healthy ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircleIcon className="h-5 w-5 text-red-500" />
                  )}
                </div>

                <div className={`p-3 rounded-full ${colors.iconBg} flex-shrink-0`}>
                  <Icon className={`h-6 w-6 ${colors.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-semibold ${colors.text}`}>{stage.title}</h4>
                  <p className="text-xs text-gray-500">{stage.description}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xl font-bold ${colors.text}`}>{stage.stat.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{stage.statLabel}</p>
                </div>
              </div>

              {index < stages.length - 1 && (
                <div className="flex justify-center">
                  <ArrowRightIcon className="h-5 w-5 text-gray-300 rotate-90" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Pipeline Summary */}
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex flex-wrap gap-4 justify-center text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-gray-600">Healthy</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-gray-600">Needs Attention</span>
          </div>
          <div className="text-gray-400">|</div>
          <div className="text-gray-600">
            Conversion Rate:{' '}
            <span className="font-semibold text-green-600">
              {stats?.classifiedTotal
                ? Math.round((stats.historicTotal / stats.classifiedTotal) * 100)
                : 0}%
            </span>
            {' '}Historic
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemFlowDiagram;
