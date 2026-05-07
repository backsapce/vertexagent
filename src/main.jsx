import './polyfills.js'
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

// Register the service worker in both dev and production.
// In dev, sw.js uses network-first caching on localhost so HMR stays fresh
// while the last loaded app shell can still open after the dev server stops.
if ('serviceWorker' in navigator) {
  const swUrl = new URL(`${import.meta.env.BASE_URL}sw.js`, window.location.origin)

  navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL }).catch((err) => {
    console.warn('SW registration failed:', err);
  });
}
