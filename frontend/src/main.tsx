/**
 * Main Entry Point - SolidJS Application Bootstrap
 */

import { render } from 'solid-js/web';
import App from './App';
import { theme } from './core/theme';

// Initialize theme on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    theme.init();
    const appEl = document.getElementById('app');
    if (appEl) {
      render(() => <App />, appEl);
    }
  });
} else {
  theme.init();
  const appEl = document.getElementById('app');
  if (appEl) {
    render(() => <App />, appEl);
  }
}