import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiFetch } from '../utils/api';
import {
  HomeIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  CogIcon,
  WrenchScrewdriverIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
}

const navLinks = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/posts', label: 'Posts', icon: DocumentTextIcon },
  { href: '/messages', label: 'Messages', icon: ChatBubbleLeftRightIcon },
  { href: '/groups', label: 'Groups', icon: UserGroupIcon },
  { href: '/logs', label: 'Logs', icon: ClipboardDocumentListIcon },
  { href: '/admin', label: 'Admin', icon: ShieldCheckIcon },
  { href: '/debug', label: 'Debug', icon: WrenchScrewdriverIcon },
  { href: '/backup', label: 'Backup', icon: ServerStackIcon },
  { href: '/settings', label: 'Settings', icon: CogIcon },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const getStatusConfig = () => {
    if (!health) return { color: 'bg-slate-400', text: 'Loading' };
    switch (health.status) {
      case 'ok':
        return { color: 'bg-emerald-500', text: 'Healthy' };
      case 'degraded':
        return { color: 'bg-amber-500', text: 'Degraded' };
      case 'unhealthy':
        return { color: 'bg-red-500', text: 'Unhealthy' };
      default:
        return { color: 'bg-slate-400', text: 'Unknown' };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            {/* Left side - Logo & Navigation */}
            <div className="flex items-center">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-2.5 mr-8">
                <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">T</span>
                </div>
                <span className="hidden sm:block font-semibold text-slate-900">Tarasa</span>
              </Link>

              {/* Desktop Navigation */}
              <div className="hidden lg:flex items-center gap-1">
                {navLinks.map((link) => {
                  const isActive = router.pathname === link.href;
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side - Status & Mobile Menu */}
            <div className="flex items-center gap-3">
              {/* System Status */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200">
                <div className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                <span className="text-xs font-medium text-slate-600">
                  {statusConfig.text}
                </span>
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              >
                {mobileMenuOpen ? (
                  <XMarkIcon className="w-5 h-5" />
                ) : (
                  <Bars3Icon className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white">
            <div className="px-4 py-2 space-y-1">
              {navLinks.map((link) => {
                const isActive = router.pathname === link.href;
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="animate-slide-up">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
