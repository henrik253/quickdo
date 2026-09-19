import { useRegisterSW } from 'virtual:pwa-register/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store';
import { T } from './testids';
import './styles.css';

/**
 * "new version — reload" pill (F-024). Prompt-mode service worker: the new version is applied only
 * when the capture bar is empty so a half-typed todo is never lost. The server's SSE `update` event
 * (a pending code update) shows the same pill.
 */
function UpdatePill() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn('service worker registration failed', err);
    },
  });
  const draft = useStore((s) => s.draft);
  const updatePending = useStore((s) => s.updatePending);
  if (!(needRefresh || updatePending) || draft !== '') return null;
  return (
    <button
      type="button"
      className="pill"
      data-testid={T.updatePill}
      style={{
        position: 'fixed',
        top: 'calc(8px + env(safe-area-inset-top, 0px))',
        right: 16,
        zIndex: 25,
      }}
      onClick={() => {
        if (needRefresh) void updateServiceWorker(true);
        else window.location.reload();
      }}
    >
      new version — reload
    </button>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
      <UpdatePill />
    </StrictMode>,
  );
}
