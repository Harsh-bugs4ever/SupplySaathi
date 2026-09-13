import { config } from '@/lib/config/env';
import { Card, SectionHeading } from '@/components/ui';
import { HealthPanel } from '@/components/HealthPanel';

export const dynamic = 'force-dynamic';

/**
 * Settings.
 *
 * The point of this page is honesty about capability. It probes each provider
 * live and reports what is actually available with the configured credentials,
 * rather than inferring from whether an environment variable happens to be set.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[860px] px-5 py-10 sm:px-8">
      <header className="mb-7">
        <h1 className="display text-[30px] text-ink">Settings</h1>
        <p className="mt-1.5 text-[14px] text-ink-soft">
          What SupplySaathi can actually do with the credentials on this machine.
        </p>
      </header>

      <Card className="mb-6 p-5">
        <SectionHeading>Mode</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-[13px] font-medium ${
              config.mode === 'live'
                ? 'border-primary/25 bg-primary-wash text-primary'
                : 'border-warning/35 bg-warning-wash text-warning-ink'
            }`}
          >
            {config.mode === 'live' ? 'Live mode' : 'Demo mode'}
          </span>
          <p className="text-[13px] text-ink-soft">
            {config.mode === 'live'
              ? 'Real supplier pages are retrieved. Missing integrations produce honest errors rather than fixtures.'
              : 'Deterministic sample data. No network calls, no outreach.'}
          </p>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-faint">
          Change <span className="num">APP_MODE</span> in <span className="num">.env.local</span> and
          restart. SupplySaathi never silently falls back from live data to fixtures.
        </p>
      </Card>

      <HealthPanel />

      <Card className="mt-6 p-5">
        <SectionHeading>Research limits</SectionHeading>
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <Row label="Maximum pages per case" value={config.agent.maxPages} />
          <Row label="Maximum research rounds" value={config.agent.maxRounds} />
          <Row label="Time budget" value={`${Math.round(config.agent.timeBudgetMs / 1000)}s`} />
          <Row label="Maximum page size" value={`${Math.round(config.agent.maxPageBytes / 1024)} KB`} />
        </dl>
        <p className="mt-3 text-[12.5px] text-ink-faint">
          When a limit is reached the run stops and returns what it has found, rather than running
          on indefinitely.
        </p>
      </Card>

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

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rule py-1.5">
      <dt className="text-[13px] text-ink-soft">{label}</dt>
      <dd className="num text-[13px] font-medium text-ink">{value}</dd>
    </div>
  );
}
