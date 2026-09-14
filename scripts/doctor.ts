import { loadEnvFiles } from '../src/lib/config/loadEnvFile';

const loaded = loadEnvFiles();

import { loadConfig } from '../src/lib/config/load';
import { createWebProvider, CompositeWebProvider } from '../src/lib/providers/web';
import { createReasoningProvider } from '../src/lib/providers/reasoning';
import { createMemoryProvider } from '../src/lib/providers/memory';
import { createEmailProvider } from '../src/lib/providers/email';
import { getDb, migrate } from '../src/lib/db/client';
import { getOrCreateProfile } from '../src/lib/db/repo';
import type { ProviderHealth } from '../src/lib/providers/types';

/**
 * Provider diagnostics.
 *
 * Probes every integration against its real endpoint and prints what is
 * genuinely available. Run this after filling in `.env.local` — it is the
 * difference between "I set a key" and "the key works for the thing I need".
 *
 *   npm run doctor
 */

const TICK = '✓';
const CROSS = '✗';

function line(char = '─', n = 68): string {
  return char.repeat(n);
}

function render(h: ProviderHealth): void {
  const anyAvailable = h.capabilities.some((c) => c.available);
  console.log(`\n  ${anyAvailable ? TICK : CROSS} ${h.provider}  ${h.configured ? '' : '(not configured)'}`);
  for (const c of h.capabilities) {
    console.log(`      ${c.available ? TICK : CROSS} ${c.name}`);
    console.log(`          ${c.detail}`);
  }
  if (h.error) console.log(`      last error: ${h.error}`);
}

async function main() {
  const cfg = loadConfig();

  console.log(`\n${line('=')}`);
  console.log('  SupplySaathi — provider diagnostics');
  console.log(line('='));
  console.log(`  env files loaded : ${loaded.length ? loaded.join(', ') : 'none (using process env only)'}`);
  console.log(`  mode             : ${cfg.mode}`);
  console.log(`  timezone         : ${cfg.timezone}`);
  console.log(`  database         : ${cfg.databasePath}`);

  // Keys are reported as present or absent, never echoed.
  console.log(`\n  Credentials present:`);
  const keys: Array<[string, boolean]> = [
    ['DEEPSEEK_API_KEY', Boolean(cfg.deepseek.apiKey)],
    ['ANAKIN_API_KEY', Boolean(cfg.anakin.apiKey)],
    ['COGNEE_API_KEY', Boolean(cfg.cognee.apiKey)],
    ['COGNEE_BASE_URL', Boolean(cfg.cognee.baseUrl)],
  ];
  for (const [name, present] of keys) {
    console.log(`      ${present ? TICK : '-'} ${name}`);
  }

  const db = getDb();
  migrate(db);
  const profile = getOrCreateProfile(db);

  console.log(`\n${line()}`);
  console.log('  Probing providers (this makes real requests)…');
  console.log(line());

  // ── Reasoning ─────────────────────────────────────────────────────────────
  console.log('\n[ Reasoning — DeepSeek ]');
  render(await createReasoningProvider(cfg, 'live').health());

  // ── Web ───────────────────────────────────────────────────────────────────
  console.log('\n[ Web research — Anakin ]');
  const web = createWebProvider(cfg, 'live');
  const webHealths =
    web instanceof CompositeWebProvider ? await web.healthAll() : [await web.health()];
  webHealths.forEach(render);

  // ── Memory ────────────────────────────────────────────────────────────────
  console.log('\n[ Memory — Cognee ]');
  render(await createMemoryProvider(cfg, profile.id, db).health());

  // ── Email ─────────────────────────────────────────────────────────────────
  console.log('\n[ Email ]');
  const email = createEmailProvider(cfg);
  render(await email.health());
  if (email.allowlistActive) {
    console.log(`      Restricted to: ${email.allowlist.join(', ')}`);
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  console.log(`\n${line('=')}`);
  const canRetrieve = webHealths.some((h) =>
    h.capabilities.some((c) => c.name.includes('page_retrieval') && c.available),
  );
  const canSearch = webHealths.some((h) =>
    h.capabilities.some((c) => c.name.includes('search') && c.available),
  );

  if (canRetrieve) {
    console.log(`  ${TICK} Live research will work.`);
    console.log(
      canSearch
        ? `  ${TICK} Candidates will be discovered by live search.`
        : `  - No search capability: candidates come from the curated supplier` +
          `\n      catalogue plus any URL you supply. This is a supported mode.`,
    );
  } else {
    console.log(`  ${CROSS} Live page retrieval is unavailable. Use APP_MODE=demo,`);
    console.log(`      or check the web provider settings above.`);
  }
  console.log(line('='));
  console.log('');
}

main().catch((err) => {
  console.error('\nDiagnostics failed:', (err as Error).message);
  process.exit(1);
});
