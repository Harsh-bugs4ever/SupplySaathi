/**
 * Pure config loader. Kept free of `server-only` so the worker process and the
 * test suite can use it directly.
 */

export type AppMode = 'demo' | 'live';
export type EmailProviderKind = 'none' | 'smtp' | 'resend' | 'test';

export interface AppConfig {
  mode: AppMode;
  databasePath: string;
  timezone: string;
  baseUrl: string;
  auth: { enabled: boolean; password: string };
  deepseek: { apiKey: string; baseUrl: string; model: string; timeoutMs: number };
  webProviderOrder: string[];
  anakin: {
    apiKey: string;
    baseUrl: string;
    country: string;
    useBrowserOnRetry: boolean;
    timeoutMs: number;
  };
  cognee: { apiKey: string; baseUrl: string; dataset: string; timeoutMs: number };
  email: {
    provider: EmailProviderKind;
    fromName: string;
    fromAddress: string;
    replyTo: string;
    allowlist: string[];
    smtp: { host: string; port: number; secure: boolean; user: string; pass: string };
    resend: { apiKey: string };
  };
  agent: {
    maxPages: number;
    maxRounds: number;
    timeBudgetMs: number;
    maxPageBytes: number;
  };
}

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v.trim();
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(key: string, fallback = false): boolean {
  const raw = str(key);
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function loadConfig(): AppConfig {
  const rawMode = str('APP_MODE', 'demo').toLowerCase();
  const mode: AppMode = rawMode === 'live' ? 'live' : 'demo';

  return {
    mode,
    databasePath: str('DATABASE_PATH', './data/supplysaathi.db'),
    timezone: str('APP_TIMEZONE', 'Asia/Kolkata'),
    baseUrl: str('APP_BASE_URL', 'http://localhost:3000'),
    auth: {
      enabled: bool('APP_AUTH_ENABLED', false),
      password: str('APP_AUTH_PASSWORD'),
    },
    deepseek: {
      apiKey: str('DEEPSEEK_API_KEY'),
      baseUrl: str('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
      model: str('DEEPSEEK_MODEL', 'deepseek-flash'),
      timeoutMs: num('DEEPSEEK_TIMEOUT_MS', 60_000),
    },
    webProviderOrder: str('WEB_PROVIDER_ORDER', 'anakin')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    anakin: {
      apiKey: str('ANAKIN_API_KEY'),
      baseUrl: str('ANAKIN_BASE_URL', 'https://api.anakin.io/v1').replace(/\/+$/, ''),
      country: str('ANAKIN_COUNTRY', 'in'),
      useBrowserOnRetry: bool('ANAKIN_USE_BROWSER_ON_RETRY', true),
      timeoutMs: num('ANAKIN_TIMEOUT_MS', 95_000),
    },
    cognee: {
      apiKey: str('COGNEE_API_KEY'),
      baseUrl: str('COGNEE_BASE_URL').replace(/\/+$/, ''),
      dataset: str('COGNEE_DATASET', 'supplysaathi'),
      timeoutMs: num('COGNEE_TIMEOUT_MS', 45_000),
    },
    email: {
      provider: (['none', 'smtp', 'resend', 'test'].includes(str('EMAIL_PROVIDER', 'none'))
        ? str('EMAIL_PROVIDER', 'none')
        : 'none') as EmailProviderKind,
      fromName: str('EMAIL_FROM_NAME', 'SupplySaathi'),
      fromAddress: str('EMAIL_FROM_ADDRESS'),
      replyTo: str('EMAIL_REPLY_TO'),
      allowlist: str('EMAIL_ALLOWLIST')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      smtp: {
        host: str('SMTP_HOST'),
        port: num('SMTP_PORT', 587),
        secure: bool('SMTP_SECURE', false),
        user: str('SMTP_USER'),
        pass: str('SMTP_PASS'),
      },
      resend: { apiKey: str('RESEND_API_KEY') },
    },
    agent: {
      maxPages: num('AGENT_MAX_PAGES', 12),
      maxRounds: num('AGENT_MAX_ROUNDS', 2),
      timeBudgetMs: num('AGENT_TIME_BUDGET_MS', 240_000),
      maxPageBytes: num('AGENT_MAX_PAGE_BYTES', 800_000),
    },
  };
}
