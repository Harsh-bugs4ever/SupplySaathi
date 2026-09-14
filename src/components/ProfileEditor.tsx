'use client';

import { useEffect, useState } from 'react';
import { Banner, Button, Card, SectionHeading, Spinner } from './ui';
import { GhostEmpty } from './Logo';
import { api, apiUrl } from '@/lib/client/api';
import type { BusinessProfile, SupplierNote } from '@/lib/domain/types';

/**
 * Business profile and memory.
 *
 * Memory is only ever written from an explicit action here or from a case — the
 * agent never infers a standing preference on its own, because a wrong one
 * silently distorts every future search. Everything remembered is listed, and
 * anything can be deleted.
 */

const input =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] focus:border-primary focus:outline-none';
const label = 'mb-1.5 block text-[12px] font-medium text-ink-soft';

export function ProfileEditor() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [notes, setNotes] = useState<SupplierNote[]>([]);
  const [cogneeConfigured, setCogneeConfigured] = useState(false);
  const [memoryUnavailable, setMemoryUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [newNote, setNewNote] = useState('');
  const [newKind, setNewKind] = useState<SupplierNote['kind']>('preference');

  const [noticeError, setNoticeError] = useState(false);

  // Profile and memory are two endpoints, loaded together so the page renders
  // once rather than shifting as each arrives.
  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ profile: BusinessProfile }>('/api/profile'),
      api<{ notes: SupplierNote[]; remoteUnavailable: boolean; cogneeConfigured: boolean }>(
        '/api/memory',
      ),
    ])
      .then(([p, m]) => {
        if (!active) return;
        setProfile(p.profile);
        setNotes(m.notes);
        setCogneeConfigured(m.cogneeConfigured);
        setMemoryUnavailable(m.remoteUnavailable);
      })
      .catch((e) => active && setLoadError((e as Error).message));
    return () => {
      active = false;
    };
  }, []);

  async function request(path: string, method: string, body?: unknown) {
    setNoticeError(false);
    try {
      const res = await fetch(apiUrl(path), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not save changes.');
      return data;
    } catch (error) {
      setNoticeError(true);
      setNotice(error instanceof Error ? error.message : 'Connection interrupted. Please try again.');
      return null;
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      if (profile && (await request('/api/profile', 'PATCH', profile))) setNotice('Saved.');
    } finally { setSaving(false); }
  }

  async function addNote() {
    if (newNote.trim().length < 3 || saving) return;
    setSaving(true);
    try {
      const data = await request('/api/memory', 'POST', { text: newNote.trim(), kind: newKind });
      if (data) {
        setNotes(data.notes);
        setNewNote('');
        setNotice('Remembered. It will be offered on your next case.');
      }
    } finally { setSaving(false); }
  }

  async function removeNote(id: string) {
    const data = await request(`/api/memory?id=${encodeURIComponent(id)}`, 'DELETE');
    if (data) { setNotes(data.notes); setNotice('Note removed.'); }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[760px] px-5 py-10 sm:px-8">
        <Banner tone="danger">{loadError}</Banner>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-[760px] px-5 py-10 sm:px-8">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Spinner /> Loading your business profile…
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[760px] px-5 py-10 sm:px-8">
      <header className="mb-7">
        <h1 className="display text-[30px] text-ink">Business profile</h1>
        <p className="mt-1.5 text-[14px] text-ink-soft">
          Used to fill in delivery details and to resolve dates in your timezone.
        </p>
      </header>

      {notice && (
        <div className="mb-4">
          <Banner tone={noticeError ? 'danger' : 'success'}>{notice}</Banner>
        </div>
      )}

      <Card className="mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="bn" className={label}>
              Business name
            </label>
            <input
              id="bn"
              value={profile.businessName}
              onChange={(e) => setProfile({ ...profile, businessName: e.target.value })}
              className={input}
            />
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Quote requests are signed with this name. We never invent a person’s name.
            </p>
          </div>

          <div>
            <label htmlFor="city" className={label}>
              City
            </label>
            <input
              id="city"
              value={profile.city}
              onChange={(e) => setProfile({ ...profile, city: e.target.value })}
              className={input}
            />
          </div>
          <div>
            <label htmlFor="pin" className={label}>
              Postal code
            </label>
            <input
              id="pin"
              value={profile.postalCode}
              onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })}
              className={`${input} num`}
            />
          </div>
          <div>
            <label htmlFor="cur" className={label}>
              Currency
            </label>
            <select
              id="cur"
              value={profile.currency}
              onChange={(e) => setProfile({ ...profile, currency: e.target.value })}
              className={input}
            >
              <option>INR</option>
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
            </select>
          </div>
          <div>
            <label htmlFor="tz" className={label}>
              Timezone
            </label>
            <input
              id="tz"
              value={profile.timezone}
              onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
              className={`${input} num`}
            />
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Deadlines like “Friday” are resolved against this.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="em" className={label}>
              Your contact email
            </label>
            <input
              id="em"
              value={profile.contactEmail}
              onChange={(e) => setProfile({ ...profile, contactEmail: e.target.value })}
              placeholder="orders@yourbakery.example"
              className={`${input} num`}
            />
          </div>
        </div>

        <Button variant="primary" className="mt-5" onClick={saveProfile} disabled={saving}>
          {saving ? <Spinner /> : null} Save profile
        </Button>
      </Card>

      <section>
        <SectionHeading count={notes.length}>What we remember</SectionHeading>

        {cogneeConfigured && memoryUnavailable && (
          <div className="mb-3">
            <Banner tone="warning">
              Cross-case memory (Cognee) is temporarily unavailable. Preferences below still apply —
              they are stored locally.
            </Banner>
          </div>
        )}
        {!cogneeConfigured && (
          <div className="mb-3">
            <Banner tone="info">
              Cognee is not configured, so memory is stored locally only. Everything below still
              works.
            </Banner>
          </div>
        )}

        <Card className="p-4">
          <label htmlFor="nn" className={label}>
            Remember something
          </label>
          <textarea
            id="nn"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            placeholder="We prefer recyclable packaging."
            className={`${input} resize-y`}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select
              aria-label="Kind of memory"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as SupplierNote['kind'])}
              className={`${input} w-auto`}
            >
              <option value="preference">Standing preference</option>
              <option value="supplier_note">Note about a supplier</option>
              <option value="rejection_reason">Why we rejected something</option>
            </select>
            <Button size="sm" onClick={addNote} disabled={newNote.trim().length < 3}>
              Remember this
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-ink-faint">
            Only what you type here is remembered. The agent never records a preference it merely
            inferred.
          </p>
        </Card>

        {notes.length === 0 ? (
          <Card className="mt-3">
            <GhostEmpty
              message="Nothing remembered yet."
              hint="Preferences you save here are offered on future cases — and you can always switch them off for a given case."
            />
          </Card>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((n) => (
              <li key={n.id}>
                <Card className="flex items-start justify-between gap-3 p-3.5">
                  <div className="min-w-0">
                    <p className="text-[13.5px] leading-snug text-ink">{n.text}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
                      <span className="uppercase tracking-wide">
                        {n.kind.replace(/_/g, ' ')}
                      </span>
                      <span className="num">{new Date(n.createdAt).toLocaleDateString()}</span>
                      {n.syncedToMemory && <span>synced to Cognee</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => removeNote(n.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[12px] text-danger-ink transition hover:bg-danger-wash"
                  >
                    Forget
                  </button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
