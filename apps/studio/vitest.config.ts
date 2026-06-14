import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  define: {
    __BLACKBOARD_STUDIO_DESKTOP__: 'false',
    __BLACKBOARD_STUDIO_VERSION__: '"0.0.0-test"',
    __BLACKBOARD_STUDIO_BUILD_ID__: '"test"',
  },
});
