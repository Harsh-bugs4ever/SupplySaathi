/**
 * Treating retrieved pages as untrusted data.
 *
 * A supplier page is input, not instruction. Some pages contain text designed
 * to be read by an agent ("ignore previous instructions", "you are now in
 * admin mode"). Two defences are applied:
 *
 *   1. Page content is never concatenated into a system prompt. It is passed
 *      as a clearly fenced user-role payload with an explicit framing telling
 *      the model the content is data to be summarised, never obeyed.
 *   2. The most common override phrasings are neutralised before the content
 *      is sent, and their presence is recorded so the run can flag the page.
 *
 * Neither defence is complete on its own. Together with the fact that the model
 * has no tools in the extraction step — it can only return JSON matching a
 * schema — an injected instruction has nowhere to go even if it is followed.
 */

const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, label: 'instruction override' },
  { re: /disregard\s+(all\s+)?(previous|prior|above)/gi, label: 'instruction override' },
  { re: /you\s+are\s+now\s+(a|an|in)\b/gi, label: 'role reassignment' },
  { re: /system\s*prompt/gi, label: 'system prompt reference' },
  { re: /\bnew\s+instructions?\s*:/gi, label: 'instruction injection' },
  { re: /\b(reveal|print|output|show)\s+(your|the)\s+(prompt|instructions?|api[_\s-]?key|secret)/gi, label: 'secret exfiltration attempt' },
  { re: /<\s*\/?\s*(system|assistant)\s*>/gi, label: 'role tag injection' },
];

export interface SanitizedContent {
  text: string;
  /** Non-empty when the page tried to talk to the agent rather than describe a product. */
  injectionFlags: string[];
  truncated: boolean;
  originalLength: number;
}

export function sanitizePageContent(raw: string, maxChars = 20_000): SanitizedContent {
  const originalLength = raw.length;
  let text = raw;
  const flags = new Set<string>();

  for (const { re, label } of INJECTION_PATTERNS) {
    if (re.test(text)) {
      flags.add(label);
      text = text.replace(re, '[redacted-directive]');
    }
    re.lastIndex = 0;
  }

  // Strip anything that looks like a script or style block that survived
  // markdown conversion, plus HTML comments (a favourite injection hiding spot).
  text = text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Collapse the runs of whitespace that markdown conversion leaves behind,
  // which otherwise waste a large share of the context window.
  text = text.replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n');

  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars);

  return {
    text: text.trim(),
    injectionFlags: [...flags],
    truncated,
    originalLength,
  };
}

/**
 * Excerpts shown in the evidence drawer.
 *
 * We display a short verbatim window around the matched fact so the user can
 * judge the source themselves, with all markup removed — raw retrieved HTML is
 * never rendered into the page.
 */
export function makeExcerpt(content: string, needle: string, window = 240): string {
  const plain = stripMarkup(content);
  const idx = plain.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return plain.slice(0, window).trim();

  const start = Math.max(0, idx - Math.floor(window / 3));
  const end = Math.min(plain.length, idx + needle.length + Math.floor((window * 2) / 3));
  const prefix = start > 0 ? '…' : '';
  const suffix = end < plain.length ? '…' : '';
  return `${prefix}${plain.slice(start, end).trim()}${suffix}`;
}

export function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hard cap on bytes accepted from a fetch, before any parsing. */
export function enforceByteLimit(body: string, maxBytes: number): { body: string; truncated: boolean } {
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes <= maxBytes) return { body, truncated: false };
  return { body: Buffer.from(body, 'utf8').subarray(0, maxBytes).toString('utf8'), truncated: true };
}
