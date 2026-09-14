import { describe, it, expect } from 'vitest';
import { resolveDeadline, todayInZone, addDays, daysBetween, partsInZone } from '@/lib/domain/dates';

/**
 * Deadline resolution.
 *
 * "by Friday" decides which suppliers qualify, so getting it wrong silently
 * corrupts the whole shortlist. Every case is pinned to a fixed instant so the
 * tests do not drift with the calendar.
 */

const TZ = 'Asia/Kolkata';
// Sunday 13 September 2026, 12:00 UTC = 17:30 IST.
const SUNDAY = new Date('2026-09-13T12:00:00Z');

describe('weekday resolution', () => {
  it('resolves "Friday" to the coming Friday', () => {
    const r = resolveDeadline('delivered by Friday', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2026-09-18');
    expect(r.sourcePhrase.toLowerCase()).toContain('friday');
    expect(r.display).toBe('Friday, 18 September 2026');
    expect(r.ambiguous).toBe(false);
  });

  it('resolves "next Friday" to the following week', () => {
    const r = resolveDeadline('by next Friday', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2026-09-25');
  });

  it('resolves "Monday" to tomorrow when today is Sunday', () => {
    expect(resolveDeadline('by Monday', TZ, SUNDAY)!.isoDate).toBe('2026-09-14');
  });

  it('flags the same-weekday case as ambiguous rather than guessing silently', () => {
    const friday = new Date('2026-09-18T06:00:00Z');
    const r = resolveDeadline('by Friday', TZ, friday)!;
    expect(r.isoDate).toBe('2026-09-18');
    expect(r.ambiguous).toBe(true);
    expect(r.explanation).toMatch(/today is friday/i);
  });
});

describe('explicit dates win over everything', () => {
  it('uses an ISO date verbatim', () => {
    const r = resolveDeadline('needed by 2026-10-02', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2026-10-02');
    expect(r.ambiguous).toBe(false);
  });

  it('parses a day/month/year date', () => {
    expect(resolveDeadline('by 02/10/2026', TZ, SUNDAY)!.isoDate).toBe('2026-10-02');
  });

  it('assumes the current year when none is given, and says so', () => {
    const r = resolveDeadline('by 02/10', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2026-10-02');
    expect(r.ambiguous).toBe(true);
    expect(r.explanation).toMatch(/no year/i);
  });

  it('parses a written month', () => {
    expect(resolveDeadline('by 25 September', TZ, SUNDAY)!.isoDate).toBe('2026-09-25');
  });

  it('rolls a written month into next year when it has already passed', () => {
    const r = resolveDeadline('by 5 March', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2027-03-05');
    expect(r.explanation).toMatch(/next year/i);
  });
});

describe('relative phrases', () => {
  it.each([
    ['tomorrow', '2026-09-14'],
    ['today', '2026-09-13'],
    ['in 3 days', '2026-09-16'],
    ['in 2 weeks', '2026-09-27'],
  ])('resolves "%s"', (phrase, expected) => {
    expect(resolveDeadline(`needed ${phrase}`, TZ, SUNDAY)!.isoDate).toBe(expected);
  });

  it('reads "end of week" as the coming Friday and flags it', () => {
    const r = resolveDeadline('by end of week', TZ, SUNDAY)!;
    expect(r.isoDate).toBe('2026-09-18');
    expect(r.ambiguous).toBe(true);
  });
});

describe('timezone correctness', () => {
  it('uses the local calendar date, not UTC', () => {
    // 19:00 UTC on the 13th is already 00:30 on the 14th in IST.
    const late = new Date('2026-09-13T19:00:00Z');
    expect(todayInZone('Asia/Kolkata', late)).toBe('2026-09-14');
    expect(todayInZone('UTC', late)).toBe('2026-09-13');
  });

  it('resolves the same phrase differently across timezones', () => {
    const late = new Date('2026-09-13T19:00:00Z');
    const ist = resolveDeadline('by Friday', 'Asia/Kolkata', late)!;
    const utc = resolveDeadline('by Friday', 'UTC', late)!;
    expect(ist.isoDate).toBe('2026-09-18');
    expect(utc.isoDate).toBe('2026-09-18');
    // The *day* they start counting from differs, which is the point.
    expect(todayInZone('Asia/Kolkata', late)).not.toBe(todayInZone('UTC', late));
  });

  it('reads weekday correctly in a zone behind UTC', () => {
    const p = partsInZone(new Date('2026-09-14T02:00:00Z'), 'America/New_York');
    expect(p.weekday).toBe(0); // still Sunday in New York
  });
});

describe('returns null rather than guessing', () => {
  it.each([
    'we need 500 boxes',
    'urgently please',
    'as soon as possible',
  ])('returns null for "%s"', (text) => {
    expect(resolveDeadline(text, TZ, SUNDAY)).toBeNull();
  });
});

describe('date arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-28', 5)).toBe('2026-10-03');
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('counts days between dates, signed', () => {
    expect(daysBetween('2026-09-13', '2026-09-18')).toBe(5);
    expect(daysBetween('2026-09-18', '2026-09-13')).toBe(-5);
    expect(daysBetween('2026-09-13', '2026-09-13')).toBe(0);
  });
});
