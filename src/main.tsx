import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element in index.html');

/**
 * GitHub Pages cannot send X-Frame-Options or a frame-ancestors policy, so
 * another site could show Snap Notes in an invisible frame and trick clicks
 * onto it (clickjacking). Inside a frame the app does not start; it offers a
 * link to open it properly instead.
 */
function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

if (isFramed()) {
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'Open Snap Notes';
  rootElement.replaceChildren('Snap Notes cannot be shown inside another page. ', link);
} else {
  createRoot(rootElement).render(
    <StrictMode>
      {/* Hash routing keeps the legacy app's #list / #study:id style URLs working
        and avoids 404s on GitHub Pages, which has no server-side routing. */}
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
}
