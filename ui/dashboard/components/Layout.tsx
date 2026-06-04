import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiFetch, hasApiKey, API_KEY_CHANGED_EVENT } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';
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
  SparklesIcon,
  MagnifyingGlassIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';

interface HealthChecks {
  database: boolean;
  facebookSession: boolean;
  openaiKey: boolean;
  apifyToken: boolean;
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  checks?: HealthChecks;
}

const navLinks = [
  { href: '/', labelKey: 'nav.dashboard', icon: HomeIcon },
  { href: '/posts', labelKey: 'nav.posts', icon: DocumentTextIcon },
  { href: '/search', labelKey: 'nav.search', icon: MagnifyingGlassIcon },
  { href: '/messages', labelKey: 'nav.messages', icon: ChatBubbleLeftRightIcon },
  { href: '/groups', labelKey: 'nav.groups', icon: UserGroupIcon },
  { href: '/logs', labelKey: 'nav.logs', icon: ClipboardDocumentListIcon },
  { href: '/prompts', labelKey: 'nav.prompts', icon: SparklesIcon },
  { href: '/admin', labelKey: 'nav.admin', icon: ShieldCheckIcon },
  { href: '/debug', labelKey: 'nav.debug', icon: WrenchScrewdriverIcon },
  { href: '/backup', labelKey: 'nav.backup', icon: ServerStackIcon },
  { href: '/settings', labelKey: 'nav.settings', icon: CogIcon },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { t, direction } = useLanguage();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth({ status: data.status, checks: data.checks });
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

  // API-key presence tracking. Updates immediately when set/cleared from
  // Settings (custom event), and across tabs via the native storage event.
  useEffect(() => {
    const sync = () => setApiKeyPresent(hasApiKey());
    sync();
    window.addEventListener(API_KEY_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(API_KEY_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // Compose a truthful status by looking at the granular `checks` object.
  // The bare `status` field from /api/health can claim "ok" even when one
  // check fails (e.g. facebookSession=false during a zombie-session window),
  // which would mislead operators. Trust the checks first; fall back to the
  // top-level status if `checks` is absent (older container or network blip).
  const getStatusConfig = () => {
    if (!health) {
      return {
        color: 'bg-slate-400',
        text: t('common.loading'),
        tooltip: 'Loading system health...',
      };
    }

    const failedChecks: string[] = [];
    if (health.checks) {
      if (!health.checks.database) failedChecks.push('Database');
      if (!health.checks.facebookSession) failedChecks.push('Facebook session');
      if (!health.checks.openaiKey) failedChecks.push('OpenAI key');
      // apifyToken is intentionally disabled in this deployment, so don't
      // count it as a failed check that would flip the pill red.
    }

    // Synthesize the displayed status: if any check failed, treat as degraded
    // even when /api/health reports "ok".
    const effectiveStatus: 'ok' | 'degraded' | 'unhealthy' =
      failedChecks.length === 0
        ? health.status
        : failedChecks.length >= 2
          ? 'unhealthy'
          : 'degraded';

    const tooltip = (() => {
      if (!health.checks) return `Status: ${health.status}`;
      const passed: string[] = [];
      if (health.checks.database) passed.push('Database');
      if (health.checks.facebookSession) passed.push('Facebook session');
      if (health.checks.openaiKey) passed.push('OpenAI key');
      const lines: string[] = [];
      if (passed.length) lines.push(`OK: ${passed.join(', ')}`);
      if (failedChecks.length) lines.push(`Failing: ${failedChecks.join(', ')}`);
      return lines.join(' • ');
    })();

    switch (effectiveStatus) {
      case 'ok':
        return { color: 'bg-emerald-500', text: t('dashboard.healthy'), tooltip };
      case 'degraded':
        return { color: 'bg-amber-500', text: t('dashboard.degraded'), tooltip };
      case 'unhealthy':
        return { color: 'bg-red-500', text: t('dashboard.unhealthy'), tooltip };
      default:
        return { color: 'bg-slate-400', text: t('common.unknown'), tooltip };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="min-h-screen bg-slate-50" dir={direction}>
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14 gap-3">
            {/* Left side - Logo & Navigation */}
            <div className="flex items-center min-w-0">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-2.5 me-8">
                <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">T</span>
                </div>
                <span className="hidden sm:block font-semibold text-slate-900">Tarasa</span>
              </Link>

              {/* Desktop Navigation.
                  Two visibility modes to fit all 11 items + the right-side
                  controls without clipping:
                  - md..xl (768..1280): icon-only pills with tooltips.
                  - xl+ (>=1280): icon + label.
                  The previous layout used `hidden lg:flex` with full labels
                  for every item, which overflowed once the user had >=10
                  nav items on a typical laptop (1440-1680 wide) and pushed
                  the right-side status / language controls off-screen. */}
              <div className="hidden md:flex items-center gap-0.5 min-w-0">
                {navLinks.map((link) => {
                  const isActive = router.pathname === link.href;
                  const Icon = link.icon;
                  const label = t(link.labelKey);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      title={label}
                      aria-label={label}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                        isActive
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="hidden xl:inline">{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right side - Status, API Key, Mobile Menu.
                `flex-shrink-0` on this and on each child stops the navbar
                items on the left from squeezing this group off-screen at
                narrow viewports. Language switcher moved to Settings page
                so the navbar has room for all nav items without overlap. */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* API Key Status. When already connected we DON'T show a
                  pill — the user asked for the green "Connected" pill to be
                  removed. We still surface a clickable warning pill when the
                  key is missing so the user has a path to fix it. */}
              {!apiKeyPresent && (
                <Link
                  href="/settings"
                  className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                  title="No API key set — click to configure"
                >
                  <KeyIcon className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">API Key needed</span>
                </Link>
              )}

              {/* System Status — responsive pill.
                  - `<sm`: hidden (mobile keeps nav clean).
                  - `sm..lg`: just the colored dot in a small pill — no
                    label, so it can't run out of frame.
                  - `lg+`: dot + label, full pill.
                  The `whitespace-nowrap` + `flex-shrink-0` combo keeps the
                  pill from being clipped when neighbors expand. */}
              <div
                className="hidden sm:inline-flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-md bg-slate-50 border border-slate-200 flex-shrink-0 whitespace-nowrap"
                title={statusConfig.tooltip}
                aria-label={`System status: ${statusConfig.text}. ${statusConfig.tooltip}`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusConfig.color}`} />
                <span className="hidden lg:inline text-xs font-medium text-slate-600">
                  {statusConfig.text}
                </span>
              </div>

              {/* Mobile menu button — only shown when desktop nav is hidden. */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100"
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
          <div className="md:hidden border-t border-slate-200 bg-white">
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
                    {t(link.labelKey)}
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
