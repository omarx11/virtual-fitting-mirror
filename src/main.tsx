import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installLocalOnlyFetch } from './tracking/networkGuard';
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

createRoot(root).render(
  <StrictMode>
    {InspectView ? (
      <Suspense fallback={null}>
        <InspectView />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
