import { defineConfig } from 'vite';

// The e2e harness runs `vite preview` on this port (see playwright.config.ts).
// Non-8787 to avoid colliding with other local services.
export default defineConfig({
  server: {
    port: 5310,
  },
  preview: {
    port: 5310,
  },
});
