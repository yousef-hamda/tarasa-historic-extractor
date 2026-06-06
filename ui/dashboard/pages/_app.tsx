import type { AppProps } from 'next/app';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';
import LoginGate from '../components/LoginGate';
import { LanguageProvider } from '../contexts/LanguageContext';
import '../styles/globals.css';
import type { NextPageWithLayout } from '../types';

// Extended AppProps type to support noLayout flag on page components
type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

function TarasaDashboard({ Component, pageProps }: AppPropsWithLayout) {
  // Check if page wants to skip the layout. noLayout pages are the public
  // landing pages (/submit/[postId], _error) — they bypass BOTH the dashboard
  // chrome and the site password gate so message recipients aren't blocked.
  const skipLayout = Component.noLayout === true;

  if (skipLayout) {
    return (
      <LanguageProvider>
        <ErrorBoundary>
          <Component {...pageProps} />
        </ErrorBoundary>
      </LanguageProvider>
    );
  }

  return (
    <LanguageProvider>
      <ErrorBoundary>
        <LoginGate>
          <Layout>
            <Component {...pageProps} />
          </Layout>
        </LoginGate>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

export default TarasaDashboard;
