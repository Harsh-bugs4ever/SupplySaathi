'use client';

import { useEffect, useState } from 'react';
import { Banner, Card, SectionHeading, Spinner } from './ui';
import { HealthPanel } from './HealthPanel';
import { api } from '@/lib/client/api';

/**
 * Settings.
 *
 * Honest about capability: a credential being *present* and a provider plan
 * actually granting the thing you need are different facts, and this page keeps
 * them apart. The summary tiles read the first; `HealthPanel` below probes the
 * second against the real endpoints.
 */

interface Credentials {
  anakin: boolean;
  deepseek: boolean;
  brightDataSearch: boolean;
  brightDataRetrieval: boolean;
  cognee: boolean;
}

interface Summary {
  mode: 'demo' | 'live';
  credentials: Credentials;
  agent: {
    maxPages: number;
    maxRounds: number;
    timeBudgetMs: number;
    maxPageBytes: number;
  };
}

export function SettingsView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<Summary>('/api/health')
      .then((d) => active && setSummary(d))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[860px] px-5 py-10 sm:px-8">
      <header className="mb-7">
        <h1 className="display text-[30px] text-ink">Settings</h1>
        <p className="mt-1.5 text-[14px] text-ink-soft">
          Manage real-world research, discovery, and outreach.
        </p>
      </header>

      {error && (
        <div className="mb-6">
          <Banner tone="danger">
            Could not reach the API: {error} The interface is deployed separately from the API, so
            this usually means the API service is down or the rewrite is misconfigured.
          </Banner>
        </div>
      )}

      {!summary && !error && (
        <Card className="mb-6 p-6">
          <div className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Spinner /> Reading configuration…
          </div>
        </Card>
      )}

      {summary && (
        <Card className="connection-card mb-6 p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow">LIVE RESEARCH</span>
            <span className="rounded-full border border-primary/30 px-3 py-1 text-[12px] text-primary">
              {summary.mode === 'live'
                ? 'Default for new cases'
                : 'Available in the case composer'}
            </span>
          </div>

          <h2 className="text-[25px] font-semibold tracking-tight">
            Connect to the real supplier web.
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-ink-soft">
            Live cases retrieve actual supplier pages. Without a search subscription, discovery
            starts from the curated bakery-packaging catalogue. Retrieval availability is checked
            below.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Tile
              title="Page retrieval"
              value={
                summary.credentials.anakin
                  ? 'Anakin key configured'
                  : summary.credentials.brightDataRetrieval
                    ? 'Bright Data zone configured'
                    : 'Anakin keyless access'
              }
            />
            <Tile
              title="Supplier discovery"
              value={
                summary.credentials.anakin || summary.credentials.brightDataSearch
                  ? 'Search credentials configured'
                  : 'Curated catalogue'
              }
            />
            <Tile
              title="Reasoning"
              value={
                summary.credentials.deepseek ? 'DeepSeek key configured' : 'Rule-based extraction'
              }
            />
          </div>

          <details className="mt-5 border-t border-line pt-4">
            <summary className="cursor-pointer text-[14px] font-medium text-primary">
              Unlock broader search and AI extraction
            </summary>
            <div className="mt-4 space-y-3 text-[14px] leading-7 text-ink-soft">
              <p>
                Add credentials to the <strong>API service</strong> environment (Render), not to the
                interface deployment. Restart it afterwards. Keys never belong in browser code.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-paper p-4 text-[12px] text-ink">
                {'APP_MODE=live\nANAKIN_API_KEY=your_key\nDEEPSEEK_API_KEY=your_key'}
              </pre>
              <p>
                A key being present does not prove your plan grants the capability. The checks below
                call each provider for real. Email sending stays off until you configure a sender.
              </p>
            </div>
          </details>
        </Card>
      )}

      <HealthPanel />

      {summary && (
        <Card className="mt-6 p-5">
          <SectionHeading>Research limits</SectionHeading>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <Row label="Maximum pages per case" value={summary.agent.maxPages} />
            <Row label="Maximum research rounds" value={summary.agent.maxRounds} />
            <Row label="Time budget" value={`${Math.round(summary.agent.timeBudgetMs / 1000)}s`} />
            <Row
              label="Maximum page size"
              value={`${Math.round(summary.agent.maxPageBytes / 1024)} KB`}
            />
          </dl>
          <p className="mt-3 text-[12.5px] text-ink-faint">
            When a limit is reached the run stops and returns what it has found, rather than running
            on indefinitely.
          </p>
        </Card>
      )}

      <Card className="mt-6 p-5">
        <SectionHeading>Safety</SectionHeading>
        <ul className="space-y-2 text-[13px] leading-relaxed text-ink-soft">
          <li>Nothing is sent to a supplier without an explicit approval of the exact text.</li>
          <li>Editing an approved draft revokes the approval automatically.</li>
          <li>A repeated send with the same approval is refused, not repeated.</li>
          <li>Retrieved pages are treated as untrusted data and can never issue instructions.</li>
          <li>Requests to localhost, private networks and cloud metadata endpoints are blocked.</li>
          <li>Recipient addresses are never guessed — only sourced from a page or typed by you.</li>
        </ul>
      </Card>
    </div>
  );
}

function Tile({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper/40 p-4">
      <p className="text-[14px] font-medium">{title}</p>
      <p className="mt-2 text-[13px] text-primary">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rule flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[13px] text-ink-soft">{label}</dt>
      <dd className="num text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}
