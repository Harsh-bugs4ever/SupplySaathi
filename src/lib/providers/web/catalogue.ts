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

export const SUPPLIER_CATALOGUE: CatalogueEntry[] = [
  {
    supplier: 'IndiaMART',
    url: 'https://dir.indiamart.com/impcat/cake-boxes.html',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Large B2B marketplace listing many cake-box manufacturers with MOQ and contact details.',
  },
  {
    supplier: 'IndiaMART (Pune)',
    url: 'https://dir.indiamart.com/pune/cake-boxes.html',
    region: 'IN-MH',
    category: 'bakery_packaging',
    note: 'Pune-local sellers, relevant when delivery time matters.',
  },
  {
    supplier: 'Bakerskart',
    url: 'https://www.bakerskart.com/collections/cake-boxes',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Bakery supplies retailer with published pack sizes and prices.',
  },
  {
    supplier: 'Bakemate / Bakery Mart',
    url: 'https://bakerymart.in/product-category/packaging/cake-box/',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Retailer with per-pack pricing.',
  },
  {
    supplier: 'TradeIndia',
    url: 'https://www.tradeindia.com/manufacturers/cake-boxes.html',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'B2B directory; useful for manufacturers quoting at volume.',
  },
  {
    supplier: 'Amazon Business India',
    url: 'https://www.amazon.in/s?k=cake+box+10x10x5+inch',
    region: 'IN',
    category: 'bakery_packaging',
    note: 'Retail listings with explicit dimensions and pack counts.',
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
