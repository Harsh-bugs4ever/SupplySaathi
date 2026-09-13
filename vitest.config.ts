import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
    pool: 'forks',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
