import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
      'demo-service/tests/**/*.test.ts',
    ],
    environment: 'node',
  },
});
