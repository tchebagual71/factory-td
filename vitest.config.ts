import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Phaser needs a browser; game modules only use it for types and
      // scene-injected calls, so tests swap in an empty stub.
      phaser: fileURLToPath(new URL('./src/test/phaser-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
