import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './index.css'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Only register service worker in production — in dev mode the SW
// would serve stale cached Vite bundles and break HMR / React internals.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Register immediately so the SW begins installing right away
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('SW registration failed:', err);
  });
} else if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  // Unregister any SW left over from a previous production build
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}