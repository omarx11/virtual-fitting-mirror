import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { I18nProvider } from './i18n/I18nProvider';
import { applyLocale, loadLocale } from './i18n/locale';
import { installLocalOnlyFetch } from './tracking/networkGuard';
// Self-hosted (bundled) so the page still makes no third-party requests. The Arabic face is the
// Arabic subset only: the browser downloads it only once Arabic text is on screen.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './styles.css';

// Covers the main-thread tracking fallback and garment/physics loading; the worker installs its own.
installLocalOnlyFetch();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Development-only 3D inspection view (/?inspect=3d); never part of a production build.
const inspect = import.meta.env.DEV && new URLSearchParams(location.search).get('inspect') === '3d';
const InspectView = inspect
  ? lazy(() => import('./inspect/InspectView').then((m) => ({ default: m.InspectView })))
  : null;

// Research & testing notes (/research); loaded on its own so the mirror never downloads it.
const ResearchPage = /^\/research\/?$/.test(location.pathname)
  ? lazy(() => import('./research/ResearchPage').then((m) => ({ default: m.ResearchPage })))
  : null;
const Page = InspectView ?? ResearchPage;

// Language and direction are set before the first render, so an Arabic page never flips after load.
const locale = loadLocale();
applyLocale(locale);

createRoot(root).render(
  <StrictMode>
    <I18nProvider initial={locale}>
      {Page ? (
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      ) : (
        <App />
      )}
    </I18nProvider>
  </StrictMode>,
);
