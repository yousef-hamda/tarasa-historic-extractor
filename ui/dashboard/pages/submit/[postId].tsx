import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import type { NextPageWithLayout } from '../../types';
import { apiFetch } from '../../utils/api';
import {
  ClipboardIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface PostData {
  id: number;
  text: string;
  authorName: string;
  postUrl: string | null;
  groupId: string;
  scrapedAt: string;
  isHistoric: boolean | null;
}

// Detect if text is RTL (Hebrew/Arabic)
const isRTL = (text: string): boolean => {
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/;
  return rtlRegex.test(text);
};

// Detect language from text
const detectLanguage = (text: string): 'he' | 'ar' | 'en' => {
  const hebrewRegex = /[\u0590-\u05FF]/;
  const arabicRegex = /[\u0600-\u06FF\u0750-\u077F]/;

  if (hebrewRegex.test(text)) return 'he';
  if (arabicRegex.test(text)) return 'ar';
  return 'en';
};

const SubmitLandingPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { postId } = router.query;

  const [post, setPost] = useState<PostData | null>(null);
  const [tarasaUrl, setTarasaUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [textDirection, setTextDirection] = useState<'ltr' | 'rtl'>('rtl');
  const [language, setLanguage] = useState<'he' | 'ar' | 'en'>('he');
  const [autoRedirect, setAutoRedirect] = useState(true); // Auto-redirect after copy

  // Fetch post data
  useEffect(() => {
    if (!postId) return;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch post data and config in parallel
        const [postRes, configRes] = await Promise.all([
          apiFetch(`/api/submit/${postId}`, { skipAuth: true }),
          apiFetch(`/api/submit/config`, { skipAuth: true }),
        ]);

        if (!postRes.ok) {
          const errorData = await postRes.json();
          throw new Error(errorData.message || 'Failed to load post');
        }

        const postData = await postRes.json();
        setPost(postData);

        // Detect text direction and language
        if (postData.text) {
          setTextDirection(isRTL(postData.text) ? 'rtl' : 'ltr');
          setLanguage(detectLanguage(postData.text));
        }

        // Get tarasa URL config
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.tarasaUrl) {
            setTarasaUrl(configData.tarasaUrl);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [postId]);

  // Copy text to clipboard with auto-redirect
  const handleCopy = useCallback(async () => {
    if (!post?.text) return;

    try {
      await navigator.clipboard.writeText(post.text);
      setCopied(true);

      // Auto-redirect after successful copy
      if (autoRedirect && tarasaUrl) {
        setRedirecting(true);
        setTimeout(() => {
          window.open(tarasaUrl, '_blank');
          setRedirecting(false);
        }, 1500); // Give user time to see the "Copied!" feedback
      }

      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = post.text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);

        // Auto-redirect after successful copy
        if (autoRedirect && tarasaUrl) {
          setRedirecting(true);
          setTimeout(() => {
            window.open(tarasaUrl, '_blank');
            setRedirecting(false);
          }, 1500);
        }

        setTimeout(() => setCopied(false), 3000);
      } catch (copyErr) {
        console.error('Copy failed:', copyErr);
      }
      document.body.removeChild(textarea);
    }
  }, [post?.text, autoRedirect, tarasaUrl]);

  // Open tarasa.me
  const handleContinue = useCallback(() => {
    window.open(tarasaUrl, '_blank');
  }, [tarasaUrl]);

  // Loading state
  if (loading) {
    return (
      <>
        <Head>
          <title>Loading... | Tarasa</title>
        </Head>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin mx-auto" />
            <p className="mt-4 text-slate-600">Loading...</p>
          </div>
        </div>
      </>
    );
  }

  // Error state
  if (error || !post) {
    const errorT = {
      he: { error: 'אירעה שגיאה', notFound: 'הפוסט לא נמצא', tryAgain: 'נסה שוב' },
      ar: { error: 'حدث خطأ', notFound: 'لم يتم العثور على المنشور', tryAgain: 'حاول مرة أخرى' },
      en: { error: 'Error', notFound: 'Post not found', tryAgain: 'Try Again' },
    }[language];

    return (
      <>
        <Head>
          <title>{errorT.error} | Tarasa</title>
        </Head>
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4" dir={textDirection}>
          <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center shadow-lg">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ExclamationCircleIcon className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-xl font-semibold text-slate-900 mb-2">
              {errorT.error}
            </h1>
            <p className="text-slate-600 mb-6">{error || errorT.notFound}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
            >
              {errorT.tryAgain}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Translations based on detected language
  const translations = {
    he: {
      title: 'שתף את הזיכרון שלך',
      subtitle: 'שימור ההיסטוריה הקהילתית',
      almostDone: 'כמעט סיימנו!',
      instructions: 'הטקסט שלך מוכן להעלאה. לחצו על "העתק טקסט" ואז על "המשך לטרסה". באתר, הדביקו את הטקסט בשדה הזיכרון וסמנו "אני מאשר/ת".',
      yourText: 'הטקסט שלך',
      by: 'מאת',
      copyText: 'העתק טקסט',
      copied: 'הועתק!',
      redirecting: 'מעביר לטרסה...',
      continueToTarasa: 'המשך לטרסה',
      viewOriginal: 'צפה בפוסט המקורי בפייסבוק',
      steps: 'שלבים',
      step1: 'לחצו על "העתק טקסט" למעלה',
      step2: 'לחצו על "המשך לטרסה"',
      step3: 'באתר טרסה - הדביקו את הטקסט (Ctrl+V / ⌘+V)',
      step4: 'סמנו "אני מאשר/ת" ולחצו "שלח"',
      footer: 'פלטפורמת טרסה - שימור ההיסטוריה הקהילתית לדורות הבאים',
      error: 'אירעה שגיאה',
      tryAgain: 'נסה שוב',
      autoRedirect: 'פתח טרסה אוטומטית לאחר ההעתקה',
    },
    ar: {
      title: 'شارك ذكرياتك',
      subtitle: 'الحفاظ على التاريخ المجتمعي',
      almostDone: 'اقتربت من الانتهاء!',
      instructions: 'نصك جاهز للإرسال. انقر على "نسخ النص" ثم "المتابعة إلى تراسا". في الموقع، الصق النص في حقل الذكرى وحدد "أوافق".',
      yourText: 'النص الخاص بك',
      by: 'بواسطة',
      copyText: 'نسخ النص',
      copied: 'تم النسخ!',
      redirecting: 'جاري التحويل إلى تراسا...',
      continueToTarasa: 'المتابعة إلى تراسا',
      viewOriginal: 'عرض المنشور الأصلي على فيسبوك',
      steps: 'الخطوات',
      step1: 'انقر على "نسخ النص" أعلاه',
      step2: 'انقر على "المتابعة إلى تراسا"',
      step3: 'في تراسا - الصق النص (Ctrl+V / ⌘+V)',
      step4: 'حدد "أوافق" وانقر "إرسال"',
      footer: 'منصة تراسا - الحفاظ على التاريخ المجتمعي للأجيال القادمة',
      error: 'حدث خطأ',
      tryAgain: 'حاول مرة أخرى',
      autoRedirect: 'فتح تراسا تلقائيًا بعد النسخ',
    },
    en: {
      title: 'Share Your Memory',
      subtitle: 'Preserving Community History',
      almostDone: 'Almost Done!',
      instructions: 'Your text is ready for submission. Click "Copy Text" then "Continue to Tarasa". On the site, paste the text in the memory field and check "I agree".',
      yourText: 'Your Text',
      by: 'By',
      copyText: 'Copy Text',
      copied: 'Copied!',
      redirecting: 'Redirecting to Tarasa...',
      continueToTarasa: 'Continue to Tarasa',
      viewOriginal: 'View original Facebook post',
      steps: 'Steps',
      step1: 'Click "Copy Text" above',
      step2: 'Click "Continue to Tarasa"',
      step3: 'On Tarasa - paste the text (Ctrl+V / Cmd+V)',
      step4: 'Check "I agree" and click "Submit"',
      footer: 'Tarasa Platform - Preserving community history for future generations',
      error: 'Error',
      tryAgain: 'Try Again',
      autoRedirect: 'Auto-open Tarasa after copying',
    },
  };

  const t = translations[language];

  return (
    <>
      <Head>
        <title>{t.title} | Tarasa</title>
        <meta name="description" content={t.footer} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100" dir={textDirection}>
        {/* Header */}
        <header className="bg-white border-b border-slate-200 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-md">
                  <span className="text-white font-bold text-lg">T</span>
                </div>
                <div>
                  <h1 className="font-semibold text-slate-900">Tarasa</h1>
                  <p className="text-xs text-slate-500">{t.subtitle}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-2xl mx-auto px-4 py-8">
          {/* Instructions Card */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-6 mb-6 shadow-sm">
            <h2 className="font-semibold text-blue-900 mb-2 flex items-center gap-2 text-lg">
              <DocumentTextIcon className="w-5 h-5" />
              {t.almostDone}
            </h2>
            <p className="text-blue-800 text-sm leading-relaxed">
              {t.instructions}
            </p>
          </div>

          {/* Post Text Card */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mb-6 shadow-sm">
            <div className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {t.yourText}
                </span>
                {post.authorName && (
                  <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded-md">
                    {t.by}: {post.authorName}
                  </span>
                )}
              </div>
            </div>
            <div className="p-5">
              <div
                className="text-slate-800 leading-relaxed whitespace-pre-wrap break-words max-h-72 overflow-y-auto text-base"
                style={{ direction: textDirection }}
              >
                {post.text}
              </div>
            </div>
          </div>

          {/* Auto-redirect Toggle */}
          <div className="flex items-center justify-between mb-4 px-1">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRedirect}
                onChange={(e) => setAutoRedirect(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {t.autoRedirect}
            </label>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {/* Copy Button */}
            <button
              onClick={handleCopy}
              disabled={redirecting}
              className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-semibold text-lg transition-all shadow-md hover:shadow-lg ${
                redirecting
                  ? 'bg-blue-600 text-white'
                  : copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gradient-to-r from-slate-800 to-slate-900 text-white hover:from-slate-700 hover:to-slate-800'
              }`}
            >
              {redirecting ? (
                <>
                  <ArrowPathIcon className="w-6 h-6 animate-spin" />
                  {t.redirecting}
                </>
              ) : copied ? (
                <>
                  <CheckIcon className="w-6 h-6" />
                  {t.copied}
                </>
              ) : (
                <>
                  <ClipboardIcon className="w-6 h-6" />
                  {t.copyText}
                </>
              )}
            </button>

            {/* Continue to Tarasa Button */}
            <button
              onClick={handleContinue}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
            >
              <ArrowTopRightOnSquareIcon className="w-6 h-6" />
              {t.continueToTarasa}
            </button>
          </div>

          {/* Original Post Link */}
          {post.postUrl && (
            <div className="mt-6 text-center">
              <a
                href={post.postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-blue-600 transition-colors"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                {t.viewOriginal}
              </a>
            </div>
          )}

          {/* Steps Summary */}
          <div className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-semibold text-slate-800 mb-4 text-base">
              {t.steps}:
            </h3>
            <ol className="space-y-4 text-sm text-slate-600" style={{ direction: textDirection }}>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow">
                  1
                </span>
                <span className="pt-1">{t.step1}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow">
                  2
                </span>
                <span className="pt-1">{t.step2}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow">
                  3
                </span>
                <span className="pt-1">{t.step3}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-full flex items-center justify-center text-xs font-bold shadow">
                  4
                </span>
                <span className="pt-1">{t.step4}</span>
              </li>
            </ol>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200 bg-white mt-8">
          <div className="max-w-2xl mx-auto px-4 py-6 text-center">
            <p className="text-xs text-slate-500">
              {t.footer}
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

// Mark this page to skip the default Layout
SubmitLandingPage.noLayout = true;

export default SubmitLandingPage;
