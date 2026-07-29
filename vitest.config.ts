import { defineConfig } from 'vitest/config';

// Fast, pure unit tests only (no browser). Node environment on purpose:
// game logic lives in src/game/* and must be testable without three.js/WebGL.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
