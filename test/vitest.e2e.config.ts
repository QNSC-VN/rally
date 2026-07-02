import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

// E2E config: runs tests against a live API + real DB.
// E2E tests live in test/e2e/**/*.e2e.spec.ts (none yet — scaffold as features stabilise).
export default defineConfig({
  plugins: [swc.vite(), tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.e2e.spec.ts'],
    passWithNoTests: true,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
