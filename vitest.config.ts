import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest 2 ships a Vite whose builtin-module list predates `node:sqlite`
 * (stable in Node 22.5). Its resolver strips the `node:` prefix and then looks
 * for a package called "sqlite", which does not exist. This plugin short-
 * circuits that by marking the specifier external so Node loads it directly.
 *
 * `enforce: 'pre'` matters — it has to run before Vite's own resolver.
 */
const nodeSqliteExternal = {
  name: 'node-sqlite-external',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (id === 'node:sqlite') return { id: 'node:sqlite', external: true };
    return null;
  },
};

export default defineConfig({
  plugins: [nodeSqliteExternal],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 30000,
    testTimeout: 30000,
    pool: 'forks',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
