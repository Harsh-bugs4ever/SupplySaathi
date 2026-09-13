/**
 * Server-only configuration. Importing this from a client component is a build
 * error by design (`server-only`), so provider secrets can never reach the browser.
 */
import 'server-only';
import { loadConfig, type AppConfig } from './load';

export const config: AppConfig = loadConfig();
export type { AppConfig };
