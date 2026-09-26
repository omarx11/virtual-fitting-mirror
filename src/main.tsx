import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installLocalOnlyFetch } from './tracking/networkGuard';
import './styles.css';

// Covers the main-thread tracking fallback; the worker installs its own guard.
installLocalOnlyFetch();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
