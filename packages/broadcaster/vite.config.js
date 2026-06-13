import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

// Absolute path to the monorepo root, injected so the app can find the channel server
const PROJECT_ROOT = resolve(__dirname, '../..');
// Use the same node binary that's running Vite — avoids PATH lookup issues in GUI apps
const NODE_BIN = process.execPath;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  define: {
    'import.meta.env.VITE_PROJECT_ROOT': JSON.stringify(PROJECT_ROOT),
    'import.meta.env.VITE_NODE_BIN': JSON.stringify(NODE_BIN),
  },
  server: {
    host: host ?? false,
    port: 1420,
    strictPort: true,
    proxy: {
      '/control': {
        target: 'http://localhost:8047',
        ws: true,  // required for WebSocket at /control/events
      },
      '/channel.json': 'http://localhost:8047',
      '/stream': 'http://localhost:8047',
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome105',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
