import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Language } from '../i18n';
import { GlobeAltIcon } from '@heroicons/react/24/outline';

interface LanguageSwitcherProps {
  /** "compact" renders a smaller pill group (e.g. for tight headers). */
  compact?: boolean;
}

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
  { code: 'ar', label: 'العربية' },
];

/**
 * Inline segmented selector for the dashboard language. Replaces the old
 * absolute-positioned dropdown that overflowed out of the viewport. As three
 * always-visible pills it can't go out of frame and reads clearly in both LTR
 * and RTL layouts. Selecting a language updates the whole site immediately
 * (LanguageProvider flips `document.dir` + every `t()` call).
 */
const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ compact = false }) => {
  const { language, setLanguage } = useLanguage();

  const pad = compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <div className="inline-flex items-center gap-2">
      {!compact && <GlobeAltIcon className="w-5 h-5 text-slate-400" />}
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 gap-1">
        {LANGUAGES.map(({ code, label }) => {
          const active = language === code;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              aria-pressed={active}
              className={`rounded-md font-medium transition-colors ${pad} ${
                active
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LanguageSwitcher;
