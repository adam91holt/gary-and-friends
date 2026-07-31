import { defineConfig } from 'vite';

// The e2e harness runs `vite preview` on this port (see playwright.config.ts).
// Non-8787 to avoid colliding with other local services.
export default defineConfig({
  // Relative base so the built bundle works both locally (vite preview / e2e)
  // and when served from a GitHub Pages subpath
  // (https://adam91holt.github.io/gary-and-friends/).
  base: './',
  server: {
    port: 5310,
  },
  preview: {
    port: 5310,
  },
});
