import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/atkinson-hyperlegible-mono';
import './styles/app.css';
import './styles/pages.css';
import './styles/console.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, storedTheme } from './lib/prefs';

// Before the first render, so a viewer who chose the light theme does not see dark first.
applyTheme(storedTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
