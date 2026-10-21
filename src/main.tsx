import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element in index.html');

createRoot(rootElement).render(
  <StrictMode>
    {/* Hash routing keeps the legacy app's #list / #study:id style URLs working
        and avoids 404s on GitHub Pages, which has no server-side routing. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
