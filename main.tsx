import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Environment-Aware Service Worker Guard:
// - Production on GitHub Pages (*.github.io): register ./sw.js for full offline PWA support.
// - Preview / Dev environments (AI Studio, localhost, run.app, webcontainer): unregister stale SWs & purge caches silently so live updates show immediately.
try {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    const isGitHubPages = window.location.hostname.toLowerCase().endsWith('github.io');
    window.addEventListener('load', () => {
      try {
        if (isGitHubPages) {
          navigator.serviceWorker.register('./sw.js').catch(() => {});
        } else {
          navigator.serviceWorker
            .getRegistrations()
            .then((regs) => {
              regs.forEach((reg) => {
                reg.unregister().catch(() => {});
              });
            })
            .catch(() => {});
          if ('caches' in window) {
            caches
              .keys()
              .then((keys) => {
                keys.forEach((key) => {
                  caches.delete(key).catch(() => {});
                });
              })
              .catch(() => {});
          }
        }
      } catch {
        // Silent in restricted preview contexts
      }
    });
  }
} catch {
  // Ignore unsupported environments
}
