import { config } from '@/lib/config/env';
import { db, handler, ok } from '@/lib/api/helpers';
import { createWebProvider, CompositeWebProvider } from '@/lib/providers/web';
import { createReasoningProvider } from '@/lib/providers/reasoning';
import { createMemoryProvider } from '@/lib/providers/memory';
import { createEmailProvider } from '@/lib/providers/email';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Provider capability report.
 *
 * Every provider is probed live rather than inferred from whether a key is
 * present. The Settings page renders this directly, so what the user sees is
 * what the agent will actually be able to do on the next run — including the
 * cases where a credential exists but the specific capability is not licensed.
 */
export const GET = handler(async () => {
  const database = db();
  const profile = repo.getOrCreateProfile(database);

  const web = createWebProvider(config, 'live');
  const reasoning = createReasoningProvider(config, 'live');
  const memory = createMemoryProvider(config, profile.id, database);
  const email = createEmailProvider(config);

  const [webHealth, reasoningHealth, memoryHealth, emailHealth] = await Promise.all([
    web instanceof CompositeWebProvider ? web.healthAll() : web.health().then((h) => [h]),
    reasoning.health().catch((e) => ({
      provider: 'deepseek',
      configured: Boolean(config.deepseek.apiKey),
      capabilities: [{ name: 'chat_completions', available: false, detail: (e as Error).message }],
      checkedAt: new Date().toISOString(),
    })),
    memory.health(),
    email.health(),
  ]);

  const jobCount = database
    .prepare("SELECT COUNT(*) AS n FROM job WHERE status IN ('queued','running')")
    .get() as { n: number } | undefined;

  return ok({
    mode: config.mode,
    timezone: config.timezone,
    // Never echo a key back, only whether one is present.
    reasoning: reasoningHealth,
    web: webHealth,
    memory: memoryHealth,
    email: {
      ...emailHealth,
      allowlistActive: email.allowlistActive,
      allowlist: email.allowlist,
      fromAddress: config.email.fromAddress || null,
    },
    agent: config.agent,
    worker: {
      pendingJobs: jobCount?.n ?? 0,
      // The worker writes nothing here; a non-zero backlog that never drains is
      // the signal that `npm run worker` is not running.
      hint:
        (jobCount?.n ?? 0) > 0
          ? 'Jobs are queued. If they do not start, the worker process is not running.'
          : 'No jobs queued.',
    },
  });
});
