import React from 'react';

interface SystemStatusIndicatorProps {
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  title?: string;
  subtitle?: string;
}

const SystemStatusIndicator: React.FC<SystemStatusIndicatorProps> = ({
  status,
  title,
  subtitle,
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'healthy':
        return {
          bgGradient: 'from-green-400 to-emerald-500',
          pulseColor: 'bg-green-400',
          icon: (
            <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          title: title || 'System Healthy',
          subtitle: subtitle || 'All systems operational',
          animation: 'animate-pulse-slow',
        };
      case 'degraded':
        return {
          bgGradient: 'from-yellow-400 to-orange-500',
          pulseColor: 'bg-yellow-400',
          icon: (
            <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ),
          title: title || 'System Degraded',
          subtitle: subtitle || 'Some services need attention',
          animation: 'animate-bounce-slow',
        };
      case 'critical':
        return {
          bgGradient: 'from-red-500 to-rose-600',
          pulseColor: 'bg-red-500',
          icon: (
            <svg className="w-16 h-16 text-white animate-shake" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ),
          title: title || 'Critical Issues',
          subtitle: subtitle || 'Immediate attention required',
          animation: 'animate-pulse',
        };
      case 'offline':
        return {
          bgGradient: 'from-gray-500 to-gray-700',
          pulseColor: 'bg-gray-500',
          icon: (
            <svg className="w-16 h-16 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
            </svg>
          ),
          title: title || 'System Offline',
          subtitle: subtitle || 'Unable to connect to server',
          animation: '',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${config.bgGradient} p-6 shadow-lg`}>
      {/* Animated background circles */}
      <div className="absolute inset-0 overflow-hidden">
        <div className={`absolute -top-4 -right-4 w-24 h-24 ${config.pulseColor} rounded-full opacity-20 ${config.animation}`} />
        <div className={`absolute -bottom-8 -left-8 w-32 h-32 ${config.pulseColor} rounded-full opacity-10 ${config.animation}`} style={{ animationDelay: '0.5s' }} />
        <div className={`absolute top-1/2 left-1/2 w-16 h-16 ${config.pulseColor} rounded-full opacity-15 ${config.animation}`} style={{ animationDelay: '1s' }} />
      </div>

      {/* Content */}
      <div className="relative flex items-center gap-4">
        {/* Icon with glow effect */}
        <div className="relative">
          <div className={`absolute inset-0 ${config.pulseColor} rounded-full blur-xl opacity-50 ${config.animation}`} />
          <div className="relative">
            {config.icon}
          </div>
        </div>

        {/* Text */}
        <div className="flex-1">
          <h3 className="text-xl font-bold text-white">{config.title}</h3>
          <p className="text-white/80 text-sm">{config.subtitle}</p>
        </div>

        {/* Status dot with ripple */}
        <div className="relative">
          <span className={`absolute inline-flex h-full w-full rounded-full ${config.pulseColor} opacity-75 ${status !== 'offline' ? 'animate-ping' : ''}`} />
          <span className={`relative inline-flex rounded-full h-4 w-4 ${config.pulseColor}`} />
        </div>
      </div>

      {/* Progress bar for degraded/critical */}
      {(status === 'degraded' || status === 'critical') && (
        <div className="relative mt-4">
          <div className="h-1 bg-white/20 rounded-full overflow-hidden">
            <div
              className={`h-full bg-white/60 rounded-full ${status === 'critical' ? 'animate-progress-critical' : 'animate-progress-warning'}`}
              style={{ width: status === 'critical' ? '90%' : '60%' }}
            />
          </div>
        </div>
      )}

      {/* Healthy checkmark animation */}
      {status === 'healthy' && (
        <div className="absolute bottom-2 right-2 opacity-10">
          <svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </div>
  );
};

export default SystemStatusIndicator;
