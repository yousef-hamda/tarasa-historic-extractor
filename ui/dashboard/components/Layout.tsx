import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiFetch } from '../utils/api';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
}

const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/posts', label: 'Posts' },
  { href: '/messages', label: 'Messages' },
  { href: '/groups', label: 'Groups' },
  { href: '/logs', label: 'Logs' },
  { href: '/admin', label: 'Admin' },
  { href: '/debug', label: 'Debug' },
  { href: '/backup', label: 'Backup' },
  { href: '/settings', label: 'Settings' },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth({ status: data.status });
      }
    } catch {
      setHealth({ status: 'unhealthy' });
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const getStatusColor = () => {
    if (!health) return 'bg-gray-400';
    switch (health.status) {
      case 'ok':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'unhealthy':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              {/* Logo/Title */}
              <div className="flex items-center gap-3 mr-8">
                <div className="relative flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${getStatusColor()}`} />
                </div>
                <span className="text-xl font-bold text-gray-900">Tarasa</span>
              </div>

              {/* Navigation Links */}
              <div className="flex space-x-1">
                {navLinks.map((link) => {
                  const isActive = router.pathname === link.href;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side - Status indicator */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="hidden sm:inline">System:</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                    health?.status === 'ok'
                      ? 'bg-green-100 text-green-800'
                      : health?.status === 'degraded'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {health?.status || 'Loading...'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
};

export default Layout;
