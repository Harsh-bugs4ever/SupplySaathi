import { checkUrl } from '../security/urlGuard';

/**
 * Listing pages versus product pages.
 *
 * A category or search page ("1-48 of 414 results") is not a product. Treating
 * one as a product produces exactly the kind of fabricated candidate this whole
 * system exists to avoid — a price from one listing married to a pack size from
 * another, under a heading scraped from the pagination.
 *
 * So listing pages are handled as what they are: a source of product URLs to
 * follow, within the run's page budget.
 */

const LISTING_SIGNALS: RegExp[] = [
  /\b\d+\s*-\s*\d+\s+of\s+(over\s+)?[\d,]+\s+results?/i,
  /\bresults?\s+for\s*["“]/i,
  /\bshowing\s+\d+\s*(-|–|to)\s*\d+\b/i,
  /\bsort\s+by\b.*\b(relevance|price|popularity)\b/i,
  /\b(page\s+1\s+of\s+\d+|next\s+page)\b/i,
  /\bfilter\s+by\b/i,
  /\b\d{2,}\s+products?\s+found\b/i,
];

/**
 * Does this URL name one specific product?
 *
 * Checked before the content signals below, because real product pages are full
 * of listing-shaped furniture — "sort by" on the reviews, a "customers also
 * bought" carousel — and judging them on content alone throws away the actual
 * products the agent was sent to find.
 */
export function looksLikeProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isProductPath(u);
  } catch {
    return false;
  }
}

/** Heuristic: does this page list many products rather than describe one? */
export function looksLikeListingPage(markdown: string, url: string): boolean {
  // A product URL wins outright.
  if (looksLikeProductUrl(url)) return false;

  // A search URL is a listing by construction.
  try {
    const u = new URL(url);
    if (/\/(search|collections|category|catalogue|impcat|proddir)\b/.test(u.pathname)) return true;
    if (/\/s\/?$/.test(u.pathname)) return true;
    if (u.searchParams.has('q') || u.searchParams.has('k') || u.searchParams.has('ss')) return true;
  } catch {
    /* handled by the caller's URL guard */
  }

  // Otherwise fall back to what the page says about itself. Two independent
  // signals are required, so a single stray "filter by" is not enough.
  return LISTING_SIGNALS.filter((re) => re.test(markdown)).length >= 2;
}

/**
 * Harvest plausible product URLs from a listing page's markdown links.
 *
 * Deliberately conservative: same host only, and the path has to look like a
 * product rather than a category, so the agent does not wander off into a
 * site's help pages and spend its budget there.
 */
export function extractProductLinks(markdown: string, baseUrl: string, limit = 6): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const found = new Map<string, number>();
  // Markdown links, as produced by the scrapers' markdown conversion.
  const linkRe = /\[([^\]]{3,120})\]\((https?:\/\/[^)\s]+)\)/g;

  for (const match of markdown.matchAll(linkRe)) {
    const [, text, href] = match;

    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }

    // Stay on the supplier's own site.
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (!checkUrl(u.toString()).ok) continue;
    if (!isProductPath(u)) continue;

    // Rank by how product-like the link text is, so the best few win when the
    // page offers more links than the budget allows.
    const score = scoreLinkText(text);
    if (score <= 0) continue;

    const clean = stripTracking(u);
    found.set(clean, Math.max(found.get(clean) ?? 0, score));
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}

function isProductPath(u: URL): boolean {
  const p = u.pathname.toLowerCase();

  // Obvious non-products.
  if (/\/(cart|login|signin|account|help|policy|privacy|terms|about|contact|blog|careers)\b/.test(p)) {
    return false;
  }
  // Another listing, not a product.
  if (/\/(search|s)\/?$/.test(p)) return false;

  return (
    /\/(dp|gp\/product|product|products|proddetail|item|p)\//.test(p) ||
    /\/p\/[a-z0-9-]+/.test(p) ||
    /-\d{4,}\.html?$/.test(p)
  );
}

function scoreLinkText(text: string): number {
  const t = text.toLowerCase().trim();
  if (t.length < 6) return 0;
  if (/^(next|previous|prev|page \d+|see more|view all|sponsored)$/.test(t)) return 0;

  let score = 1;
  // Text that mentions the kind of thing we are sourcing is a better bet.
  if (/\b(box|carton|packaging|container)\b/.test(t)) score += 3;
  if (/\d+\s*[x×]\s*\d+/.test(t)) score += 3; // carries dimensions
  if (/\b(pack|pcs|pieces|set of)\b/.test(t)) score += 2;
  if (/\b(cake|bakery|pastry|dessert)\b/.test(t)) score += 2;
  return score;
}

/** Drop the tracking parameters that make the same product look like two. */
function stripTracking(u: URL): string {
  const junk = [
    'ref',
    'ref_',
    'tag',
    'psc',
    'qid',
    'sr',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'gclid',
    'fbclid',
    'pid',
    'lid',
    'marketplace',
    'store',
    'srno',
    'otracker',
    'iid',
    'ssid',
  ];
  for (const k of junk) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

/**
 * Clean a title or supplier name taken from scraped markdown.
 *
 * Markdown converters escape `#` as `\#`, and listing headings arrive as things
 * like `\#\# 1-48 of 414 results`. Left alone, that ends up on a supplier card.
 */
export function cleanScrapedName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let s = raw
    .replace(/\\([#*_`~[\]()])/g, '$1') // unescape markdown
    .replace(/^[#*\s>|-]+/, '') // leading heading/list markers
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Pagination and result-count headings are not names.
  if (/^\d+\s*(-|–)\s*\d+\s+of\b/i.test(s)) return null;
  if (/^results?\b/i.test(s)) return null;
  if (/^\d+$/.test(s)) return null;
  if (s.length < 2) return null;

  return s.slice(0, 200);
}

/** Supplier name from a hostname, when the page does not give a better one. */
export function supplierNameFromHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const core = host.split('.')[0];
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return 'Unknown supplier';
  }
}
