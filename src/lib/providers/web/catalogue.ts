/**
 * Curated supplier catalogue.
 *
 * The fallback for when no search capability is configured. Rather than
 * inventing listings — which would be the one unforgivable failure for a
 * sourcing tool — the agent retrieves real, public category pages from known
 * bakery-packaging suppliers and extracts whatever is genuinely there.
 *
 * These are seed pages for discovery, not claims about products. Nothing enters
 * a shortlist unless it was read from the page at run time, and every entry
 * carries the retrieval timestamp.
 *
 * Coverage is intentionally narrow: the first version supports bakery packaging
 * in India well, rather than every category badly.
 */

export interface CatalogueEntry {
  supplier: string;
  /** Public category or search page to start from. */
  url: string;
  region: string;
  category: 'bakery_packaging';
  note: string;
}

/**
 * Each entry was live-checked on 2026-09-13 and returned readable content.
 * The public web moves, so a stale entry is expected over time — that is why a
 * failed retrieval is reported as a retrieval failure and never as a statement
 * about product availability, and why `npm run doctor` exists.
 */
export const SUPPLIER_CATALOGUE: CatalogueEntry[] = [
  {
    supplier: 'Amazon.in',
    url: 'https://www.amazon.in/s?k=cake+box+10x10x5+inch',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Retail listings that state dimensions and pack counts explicitly. Verified: returns results.',
  },
  {
    supplier: 'Flipkart',
    url: 'https://www.flipkart.com/search?q=cake%20box%2010%20inch',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Retail listings with pack sizes. Verified: returns results.',
  },
  {
    supplier: 'IndiaMART (search)',
    url: 'https://dir.indiamart.com/search.mp?ss=cake+box',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'B2B marketplace; sellers publish minimum order quantities. Content is JS-heavy, so a browser retry often helps.',
  },
  {
    supplier: 'TradeIndia',
    url: 'https://www.tradeindia.com/manufacturers/cake-boxes.html',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Manufacturer directory, useful for volume quotes.',
  },
  {
    supplier: 'JioMart',
    url: 'https://www.jiomart.com/search/cake%20box',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Retail listings. Thin without a browser render.',
  },
];

/**
 * Seed URLs for a case, most specific first.
 *
 * A user-supplied URL always leads: it is the one page we know is relevant.
 */
export function seedUrlsForCase(opts: {
  originalProductUrl?: string | null;
  city?: string;
  limit: number;
}): string[] {
  const seeds: string[] = [];
  if (opts.originalProductUrl) seeds.push(opts.originalProductUrl);

  const local = opts.city
    ? SUPPLIER_CATALOGUE.filter((c) => c.url.toLowerCase().includes(opts.city!.toLowerCase()))
    : [];
  const rest = SUPPLIER_CATALOGUE.filter((c) => !local.includes(c));

  for (const entry of [...local, ...rest]) {
    if (seeds.length >= opts.limit) break;
    if (!seeds.includes(entry.url)) seeds.push(entry.url);
  }

  return seeds.slice(0, opts.limit);
}
