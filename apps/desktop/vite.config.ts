/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev port and no host exposure beyond loopback.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
