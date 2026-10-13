import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Read the shared .env in the project root, then the process environment.
  const env = {
    ...loadEnv(mode, path.resolve(import.meta.dirname, '..', '..'), ''),
    ...process.env,
  };
  const port = Number(env.WEB_PORT ?? 5173);
  const apiTarget = env.API_URL ?? `http://localhost:${env.PORT ?? 8080}`;

  return {
    base: env.BASE_PATH ?? '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      // During development the API runs as a separate process; forward /api to it.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
    },
  };
});
