import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/archivo';
import './index.css';
import App from './App.jsx';
import { flush } from './services/offlineQueue.js';
import api from './services/api.js';

// Send anything the outbox is holding, and keep trying when the signal comes back.
//
// On start as well as on `online`, because the browser only fires `online` if it noticed going
// offline first: a phone that was in a dead spot for an hour and then walked into signal reports
// nothing at all, and that is exactly the case this exists for. A failed flush is silent — the
// next attempt (a reload, a reconnect, or the banner's own button) says what happened.
function startOutbox() {
  const attempt = () => {
    flush(api).catch(() => {});
  };
  attempt();
  window.addEventListener('online', attempt);
}

// The service worker, in production only.
//
// Not in development on purpose: a worker that serves the shell from a cache fights Vite's
// hot-reload and produces an afternoon of "my change did not apply" that has nothing to do with
// the change. `npm run build && npm run preview` is where to test offline behaviour.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker is a degraded app (no offline shell), not a broken one. Nothing
      // else depends on it, so this is not worth surfacing to the user.
    });
  });
}

startOutbox();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
