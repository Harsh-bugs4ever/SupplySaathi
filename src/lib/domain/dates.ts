/**
 * Deadline resolution.
 *
 * A brief that says "by Friday" is not a date. Before any research begins we
 * turn that phrase into an explicit calendar date in the user's timezone and
 * show it back to them, because the whole shortlist depends on it.
 *
 * Implemented with Intl rather than a date library so the timezone rules come
 * from the platform's IANA database and stay correct across DST boundaries.
 */

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export interface ResolvedDeadline {
  /** YYYY-MM-DD in the user's timezone. */
  isoDate: string;
  /** The phrase we resolved, e.g. "Friday". */
  sourcePhrase: string;
  /** Rendered for confirmation, e.g. "Friday, 18 September 2026". */
  display: string;
  timezone: string;
  /** True when the phrase could reasonably mean more than one date. */
  ambiguous: boolean;
  /** Shown next to the date so the user can correct us. */
  explanation: string;
}

/** Calendar parts of an instant, as observed in a given IANA timezone. */
export function partsInZone(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdayShort = get('weekday').toLowerCase();
  const weekday = WEEKDAYS.findIndex((d) => d.startsWith(weekdayShort));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

export function todayInZone(timezone: string, now: Date = new Date()): string {
  const p = partsInZone(now, timezone);
  return isoFromParts(p.year, p.month, p.day);
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Add whole days to a YYYY-MM-DD string without touching timezones. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const next = new Date(utc + days * 86_400_000);
  return isoFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function formatDisplayDate(isoDate: string, timezone: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Noon UTC keeps the calendar date stable for every timezone offset.
  const instant = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(instant);
}

/**
 * Resolve a natural-language deadline phrase against "today" in `timezone`.
 * Returns null when the text contains nothing date-like; the caller then asks.
 */
export function resolveDeadline(
  text: string,
  timezone: string,
  now: Date = new Date(),
): ResolvedDeadline | null {
  const today = todayInZone(timezone, now);
  const todayParts = partsInZone(now, timezone);
  const lower = text.toLowerCase();

  // 1. An explicit ISO date always wins.
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return build(iso[0], iso[0], timezone, false, 'Taken from the explicit date in your brief.');
  }

  // 2. Day/month forms: "18 September", "18/09/2026", "Sept 18".
  const dmy = lower.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : todayParts.year;
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const candidate = isoFromParts(year, month, day);
      return build(
        candidate,
        dmy[0],
        timezone,
        !dmy[3],
        dmy[3]
          ? 'Taken from the date in your brief.'
          : 'Your brief gave a day and month but no year, so we assumed the current year.',
      );
    }
  }

  const monthName = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/,
  );
  if (monthName) {
    const day = Number(monthName[1]);
    const month = monthIndex(monthName[2]) + 1;
    const candidate = isoFromParts(todayParts.year, month, day);
    // If that date has already passed this year, the user means next year.
    const rolled = daysBetween(today, candidate) < 0
      ? isoFromParts(todayParts.year + 1, month, day)
      : candidate;
    return build(
      rolled,
      monthName[0],
      timezone,
      false,
      daysBetween(today, candidate) < 0
        ? 'That date has already passed this year, so we read it as next year.'
        : 'Taken from the date in your brief.',
    );
  }

  // 3. Relative phrases.
  if (/\btomorrow\b/.test(lower)) {
    return build(addDays(today, 1), 'tomorrow', timezone, false, 'Relative to today in your timezone.');
  }
  if (/\btoday\b/.test(lower)) {
    return build(today, 'today', timezone, false, 'Relative to today in your timezone.');
  }
  const inDays = lower.match(/\bin\s+(\d{1,3})\s+days?\b/);
  if (inDays) {
    return build(
      addDays(today, Number(inDays[1])),
      inDays[0],
      timezone,
      false,
      'Counted forward from today in your timezone.',
    );
  }
  const inWeeks = lower.match(/\bin\s+(\d{1,2})\s+weeks?\b/);
  if (inWeeks) {
    return build(
      addDays(today, Number(inWeeks[1]) * 7),
      inWeeks[0],
      timezone,
      false,
      'Counted forward from today in your timezone.',
    );
  }

  // 4. Bare weekday names: the demo brief's "by Friday".
  const nextPrefix = /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
  const bare = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(lower);
  const weekdayMatch = nextPrefix ?? bare;
  if (weekdayMatch) {
    const name = (nextPrefix ? nextPrefix[1] : bare![1]) as (typeof WEEKDAYS)[number];
    const target = WEEKDAYS.indexOf(name);
    let delta = (target - todayParts.weekday + 7) % 7;

    if (nextPrefix) {
      // "next Friday" means the Friday of the following week.
      delta = delta === 0 ? 7 : delta + 7;
    } else if (delta === 0) {
      // Today is the named day. "by Friday" said on a Friday almost always
      // means today, but it is worth flagging rather than silently choosing.
      delta = 0;
    }

    const resolved = addDays(today, delta);
    const ambiguous = !nextPrefix && delta === 0;
    return build(
      resolved,
      weekdayMatch[0],
      timezone,
      ambiguous,
      ambiguous
        ? `Today is ${capitalize(name)}. We read this as today; change it if you meant next week.`
        : `The next ${capitalize(name)} after today in ${timezone}.`,
    );
  }

  if (/\bend of (the )?week\b/.test(lower)) {
    const delta = (5 - todayParts.weekday + 7) % 7;
    return build(
      addDays(today, delta === 0 ? 0 : delta),
      'end of week',
      timezone,
      true,
      'Read as the coming Friday. Adjust if your week ends elsewhere.',
    );
  }
  if (/\bnext week\b/.test(lower)) {
    const delta = (1 - todayParts.weekday + 7) % 7 || 7;
    return build(
      addDays(today, delta + 4),
      'next week',
      timezone,
      true,
      'Read as the Friday of next week, since no specific day was given.',
    );
  }

  return null;
}

function monthIndex(abbr: string): number {
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
    abbr.slice(0, 3),
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function build(
  isoDate: string,
  sourcePhrase: string,
  timezone: string,
  ambiguous: boolean,
  explanation: string,
): ResolvedDeadline {
  return {
    isoDate,
    sourcePhrase,
    display: formatDisplayDate(isoDate, timezone),
    timezone,
    ambiguous,
    explanation,
  };
}
