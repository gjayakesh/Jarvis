import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development-only handle for driving the voice engine from browser tests.
if (import.meta.env.DEV) {
  void import('./voice/engine').then(({ voice }) => {
    (window as unknown as { __jarvisVoice: unknown }).__jarvisVoice = voice;
  });
}
