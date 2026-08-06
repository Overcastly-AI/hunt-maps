import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * The API is CommonJS + decorators at runtime, but its unit tests only exercise
 * dependency-free logic (estimators, bearing math, validators). Aliasing the
 * workspace packages to source keeps the tests runnable without a prior build.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@hunt-maps/terrain': resolve(__dirname, '../../packages/terrain/src/index.ts'),
      '@hunt-maps/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
