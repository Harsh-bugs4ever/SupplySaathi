'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, Button, Card, Spinner } from './ui';
import { GhostMark } from './Logo';

/**
 * Case creation.
 *
 * A natural-language brief is the primary input, because that is how the
 * problem actually arrives ("supplier cancelled, I need 500 boxes by Friday").
 * The structured fields exist to correct or pin down anything the parse got
 * wrong — they are authoritative where they are filled in, and optional
 * everywhere else.
 */

const DEMO_BRIEF =
  'Our usual supplier cancelled. We need 500 cake boxes, 10 x 10 x 5 inches, ' +
  'suitable for direct food contact, delivered to Pune by Friday. Budget ₹8,000. ' +
  'Find alternatives and prepare quote requests.';

const input =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint transition focus:border-primary focus:outline-none';
const label = 'mb-1.5 block text-[12px] font-medium text-ink-soft';

export function NewCaseForm({
  defaultMode,
  timezone,
}: {
  defaultMode: 'demo' | 'live';
  timezone: string;
}) {
  const router = useRouter();

  const [briefText, setBriefText] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Structured overrides
  const [originalUrl, setOriginalUrl] = useState('');
  const [quantity, setQuantity] = useState('');
  const [dims, setDims] = useState({ l: '', w: '', h: '', unit: 'in', surface: 'external' });
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [deadline, setDeadline] = useState('');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [foodContact, setFoodContact] = useState(true);
  const [partialOk, setPartialOk] = useState(false);
  const [softened, setSoftened] = useState<string[]>([]);
  const [preferences, setPreferences] = useState('');

  const toggleSoft = (kind: string) =>
    setSoftened((s) => (s.includes(kind) ? s.filter((k) => k !== kind) : [...s, kind]));

  async function submit() {
    setError(null);
    if (briefText.trim().length < 10) {
      setError('Describe what you need — a sentence or two is enough.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefText,
          originalProductUrl: originalUrl.trim() || null,
          mode: defaultMode,
          structured: {
            quantity: quantity ? Number(quantity) : null,
            partialOk,
            dimensions:
              dims.l && dims.w && dims.h
                ? {
                    length: Number(dims.l),
                    width: Number(dims.w),
                    height: Number(dims.h),
                    unit: dims.unit as 'mm' | 'cm' | 'in',
                    surface: dims.surface as 'external' | 'internal' | 'unspecified',
                  }
                : null,
            foodContactRequired: foodContact,
            city: city.trim() || null,
            postalCode: postalCode.trim() || null,
            deadlineText: deadline.trim() || null,
            budgetAmount: budget ? Number(budget) : null,
            currency,
            softenedKinds: softened,
            preferences: preferences
              .split('\n')
              .map((p) => p.trim())
              .filter(Boolean),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not create the case.');
        return;
      }
      router.push(`/cases/${data.case.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[820px] px-5 py-10 sm:px-8 lg:py-16">
      <header className="mb-9">
        <div className="mb-5 flex items-center gap-3">
          <GhostMark size={44} className="text-primary" animated />
          <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] text-ink-soft">
            Sourcing rescue
          </span>
        </div>

        <h1 className="display text-[34px] text-ink sm:text-[44px]">
          Find a replacement.
          <br />
          Keep the order moving.
        </h1>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">
          Describe what you need. SupplySaathi reads live supplier pages, rejects what does not fit,
          shows you the tradeoffs with evidence, and prepares quote requests for your approval.
        </p>
      </header>

      {error && (
        <div className="mb-5">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <Card className="p-5 sm:p-6">
        <label htmlFor="brief" className={label}>
          What do you need?
        </label>
        <textarea
          id="brief"
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          rows={5}
          placeholder="Our usual supplier cancelled. We need 500 cake boxes, 10 x 10 x 5 inches, food safe, delivered to Pune by Friday. Budget ₹8,000."
          className={`${input} resize-y leading-relaxed`}
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setBriefText(DEMO_BRIEF)}
            className="rounded-full border border-line bg-paper px-3 py-1 text-[12px] text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            Use the example brief
          </button>
          <span className="text-[12px] text-ink-faint">
            Dates are resolved in {timezone} and shown to you before research starts.
          </span>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <label htmlFor="url" className={label}>
            Original product URL <span className="font-normal text-ink-faint">— optional</span>
          </label>
          <input
            id="url"
            value={originalUrl}
            onChange={(e) => setOriginalUrl(e.target.value)}
            placeholder="https://your-old-supplier.com/product/cake-box"
            className={`${input} num text-[13px]`}
          />
          <p className="mt-1.5 text-[12px] text-ink-faint">
            We read it for the specification baseline — not as a supplier to contact.
          </p>
        </div>

        <button
          onClick={() => setShowDetails((s) => !s)}
          className="mt-5 flex w-full items-center justify-between rounded-lg bg-surface-sunk px-3.5 py-2.5 text-[13px] font-medium text-ink-soft transition hover:text-ink"
          aria-expanded={showDetails}
        >
          <span>Pin down the details {showDetails ? '' : '(optional)'}</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            className={`transition-transform ${showDetails ? 'rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {showDetails && (
          <div className="animate-arrive mt-5 space-y-5">
            <p className="text-[12px] leading-relaxed text-ink-faint">
              Anything you fill in here overrides what we read from your description.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="qty" className={label}>
                  Quantity (units)
                </label>
                <input
                  id="qty"
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="500"
                  className={`${input} num`}
                />
                <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={partialOk}
                    onChange={(e) => setPartialOk(e.target.checked)}
                    className="accent-[var(--color-primary)]"
                  />
                  Partial fulfilment is acceptable
                </label>
              </div>

              <div>
                <label htmlFor="deadline" className={label}>
                  Required arrival
                </label>
                <input
                  id="deadline"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  placeholder="Friday, or 2026-09-18"
                  className={input}
                />
                <p className="mt-1.5 text-[12px] text-ink-faint">
                  We show you the exact date we resolved before searching.
                </p>
              </div>
            </div>

            <div>
              <span className={label}>Dimensions</span>
              <div className="flex flex-wrap items-center gap-2">
                {(['l', 'w', 'h'] as const).map((k, i) => (
                  <div key={k} className="flex items-center gap-2">
                    <input
                      aria-label={['Length', 'Width', 'Height'][i]}
                      type="number"
                      step="0.01"
                      value={dims[k]}
                      onChange={(e) => setDims({ ...dims, [k]: e.target.value })}
                      placeholder={['10', '10', '5'][i]}
                      className={`${input} num w-[72px]`}
                    />
                    {i < 2 && <span className="text-ink-faint">×</span>}
                  </div>
                ))}
                <select
                  aria-label="Unit"
                  value={dims.unit}
                  onChange={(e) => setDims({ ...dims, unit: e.target.value })}
                  className={`${input} w-auto`}
                >
                  <option value="in">inches</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
                <select
                  aria-label="Measured surface"
                  value={dims.surface}
                  onChange={(e) => setDims({ ...dims, surface: e.target.value })}
                  className={`${input} w-auto`}
                >
                  <option value="external">external (outer)</option>
                  <option value="internal">internal (usable)</option>
                </select>
              </div>
              <p className="mt-1.5 text-[12px] text-ink-faint">
                Internal and external are never treated as equivalent — a mismatch is flagged for
                confirmation rather than silently accepted.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="city" className={label}>
                  Delivery city
                </label>
                <input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Pune"
                  className={input}
                />
              </div>
              <div>
                <label htmlFor="pin" className={label}>
                  Postal code
                </label>
                <input
                  id="pin"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="411001"
                  className={`${input} num`}
                />
              </div>
              <div>
                <label htmlFor="budget" className={label}>
                  Maximum budget
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={`${input} w-auto`}
                  >
                    <option>INR</option>
                    <option>USD</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                  <input
                    id="budget"
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="8000"
                    className={`${input} num`}
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="prefs" className={label}>
                Preferences <span className="font-normal text-ink-faint">— one per line</span>
              </label>
              <textarea
                id="prefs"
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                rows={2}
                placeholder={'Recycled material\nLocal supplier'}
                className={`${input} resize-y`}
              />
              <p className="mt-1.5 text-[12px] text-ink-faint">
                Preferences affect ranking. They never exclude a supplier.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-paper p-3.5">
              <span className={label}>Treat as preference rather than requirement</span>
              <div className="flex flex-wrap gap-2">
                {[
                  ['certification', 'Food-contact certification'],
                  ['material', 'Material'],
                  ['delivery_date', 'Arrival date'],
                  ['budget', 'Budget'],
                ].map(([kind, text]) => (
                  <button
                    key={kind}
                    onClick={() => toggleSoft(kind)}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                      softened.includes(kind)
                        ? 'border-line-strong bg-surface-sunk text-ink-soft'
                        : 'border-ink/15 bg-surface text-ink'
                    }`}
                  >
                    {text}
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide opacity-60">
                      {softened.includes(kind) ? 'prefer' : 'must'}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink-faint">
                A requirement can exclude a supplier outright. A preference only changes the order.
              </p>
            </div>

            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              <input
                type="checkbox"
                checked={foodContact}
                onChange={(e) => setFoodContact(e.target.checked)}
                className="accent-[var(--color-primary)]"
              />
              Must be suitable for direct food contact
            </label>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Spinner /> Reading your brief…
              </>
            ) : (
              <>
                Start the rescue
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </>
            )}
          </Button>
          <p className="text-[12px] text-ink-faint">
            Nothing is sent to any supplier until you approve it.
          </p>
        </div>
      </Card>
    </div>
  );
}
