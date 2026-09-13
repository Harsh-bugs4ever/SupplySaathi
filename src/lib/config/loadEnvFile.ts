import fs from 'node:fs';
import path from 'node:path';

/**
 * Load `.env.local` (then `.env`) for processes Next.js does not boot.
 *
 * Next loads these itself for the web app, but the worker and the CLI scripts
 * are plain Node processes. Uses Node's built-in `loadEnvFile` rather than a
 * dotenv dependency. Existing environment variables always win, so a value
 * exported in the shell is not silently overridden by a stale file.
 */
export function loadEnvFiles(cwd = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const name of ['.env.local', '.env']) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      loaded.push(name);
    } catch {
      // A malformed env file should not take the worker down; the config
      // loader will report whatever is missing in its own terms.
    }
  }
  return loaded;
}
