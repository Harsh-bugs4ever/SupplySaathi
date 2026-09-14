'use client';

import { useEffect, useState } from 'react';
import { Banner, Card, SectionHeading, Spinner } from './ui';
import { apiUrl } from '@/lib/client/api';

/**
 * Live provider capability report.
 *
 * Each capability is probed against the real endpoint, so "search unavailable"
 * here means the credentials genuinely do not grant search — not that a
 * variable is missing. This is the difference between a status page you can
 * trust and one that only reflects your .env file.
 */

interface Capability {
  name: string;
  available: boolean;
  detail: string;
}

interface Health {
  provider: string;
  configured: boolean;
  capabilities: Capability[];
  error?: string;
}

interface HealthResponse {
  mode: string;
  reasoning: Health;
  web: Health[];
  memory: Health;
  email: Health & { allowlistActive: boolean; allowlist: string[]; fromAddress: string | null };
  worker: { pendingJobs: number; hint: string };
}

export function HealthPanel() {
  const [check, setCheck] = useState(0);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setHealth(null);
    fetch(apiUrl('/api/health'), { credentials: 'include', cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error('The provider check failed. Please refresh and try again.');
        return r.json();
      })
      .then((result) => { if (active) setHealth(result); })
      .catch((e) => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [check]);

  if (error) return <Banner tone="danger" action={<button onClick={() => setCheck((v) => v + 1)}>Retry check</button>}>Could not check providers: {error}</Banner>;

  if (!health) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Spinner /> Probing providers…
        </div>
      </Card>
    );
  }

  const groups: Array<{ title: string; note: string; healths: Health[] }> = [
    {
      title: 'Reasoning — DeepSeek',
      note: 'Parses briefs, extracts product facts, drafts quote requests. Falls back to rule-based extraction when unavailable.',
      healths: [health.reasoning],
    },
    {
      title: 'Web research — Anakin',
      note: 'Retrieves supplier pages and, where licensed, runs searches. Page retrieval works without an API key; search needs one.',
      healths: health.web,
    },
    {
      title: 'Memory — Cognee',
      note: 'Cross-case preferences. Cases still work fully without it; preferences remain in the local database.',
      healths: [health.memory],
    },
    {
      title: 'Email',
      note: 'Sends approved quote requests. Without it, drafts can be exported as .eml files.',
      healths: [health.email],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4"><h2 className="text-[16px] font-medium">Connection checks</h2><button className="rounded-lg border border-line px-3 py-2 text-[13px] text-primary hover:border-primary" onClick={() => setCheck((v) => v + 1)}>Check again</button></div>
      {health.worker.pendingJobs > 0 && (
        <Banner tone="warning">
          {health.worker.hint} Start it with <span className="num">npm run worker</span>.
        </Banner>
      )}

      {groups.map((g) => (
        <Card key={g.title} className="p-5">
          <SectionHeading>{g.title}</SectionHeading>
          <p className="mb-3 text-[12.5px] leading-relaxed text-ink-soft">{g.note}</p>

          {g.healths.map((h, i) => (
            <div key={i} className={i > 0 ? 'mt-3 border-t border-line pt-3' : ''}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="num text-[12px] font-medium text-ink">{h.provider}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    h.configured
                      ? 'bg-primary-wash text-primary'
                      : 'bg-surface-sunk text-ink-faint'
                  }`}
                >
                  {h.configured ? 'configured' : 'not configured'}
                </span>
              </div>

              <ul className="space-y-1.5">
                {h.capabilities.map((cap) => (
                  <li key={cap.name} className="flex gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        cap.available ? 'bg-primary' : 'bg-warning'
                      }`}
                    />
                    <div className="min-w-0">
                      <span className="num text-[12px] font-medium text-ink">{cap.name}</span>
                      <span
                        className={`ml-2 text-[11px] ${
                          cap.available ? 'text-primary' : 'text-warning-ink'
                        }`}
                      >
                        {cap.available ? 'available' : 'unavailable'}
                      </span>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
                        {cap.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              {h.error && (
                <p className="mt-2 text-[12px] text-warning-ink">Last error: {h.error}</p>
              )}
            </div>
          ))}

          {g.title === 'Email' && health.email.allowlistActive && (
            <div className="mt-3">
              <Banner tone="warning">
                Demo restriction active: mail can only go to{' '}
                <span className="num">{health.email.allowlist.join(', ')}</span>.
              </Banner>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
