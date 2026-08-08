import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';
import { AuthProvider, initOfflineQueue, queryClient } from './lib/api';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

// Registers the `online` listener that replays queued offline writes
// (`lib/api/offlineQueue.ts`) as soon as the device reconnects, and makes one
// attempt at boot in case a queue was left over from the last offline
// session. Fire-and-forget: nothing in the initial render depends on it.
initOfflineQueue();

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
