import type { AppProps } from 'next/app';
import Layout from '../components/Layout';
import ErrorBoundary from '../components/ErrorBoundary';
import { LanguageProvider } from '../contexts/LanguageContext';
import '../styles/globals.css';
import type { NextPageWithLayout } from '../types';

// Extended AppProps type to support noLayout flag on page components
type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

function TarasaDashboard({ Component, pageProps }: AppPropsWithLayout) {
  // Check if page wants to skip the layout
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
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

export default TarasaDashboard;
