/**
 * Demo-mode fixtures.
 *
 * These are invented pages for fictional suppliers. They exist so the whole
 * workflow can be reviewed without credentials and without touching a real
 * business. Every one is written to exercise a specific decision the agent has
 * to get right:
 *
 *   boxcraft      a plausible match: dimensions stated, pack size stated
 *   punepack      pack-size conversion: sold in 25s, so 500 needs 20 packs
 *   bulkbox       minimum order far above the requirement -> hard failure
 *   greenleaf     no delivery information at all -> unknown, not a pass
 *   metrocartons  internal vs external dimensions conflict -> unknown
 *   silentsupply  retrieval failure -> says nothing about the product
 *
 * The fixture URLs use .invalid, a reserved TLD that can never resolve, so a
 * misconfiguration can never cause a real request to a real company.
 */

export interface FixturePage {
  url: string;
  title: string;
  markdown: string;
  /** When set, the fixture fetcher reports a retrieval failure instead. */
  failure?: string;
  contactEmail?: string;
}

export const FIXTURE_PAGES: FixturePage[] = [
  {
    url: 'https://boxcraft.example.invalid/products/cake-box-10x10x5',
    title: 'Premium Cake Box 10 x 10 x 5 inch — White Kraft',
    contactEmail: 'sales@boxcraft.example.invalid',
    markdown: `# Premium Cake Box 10 x 10 x 5 inch — White Kraft

**Product code:** BC-CB-1005

Sturdy white kraft cake box with a hinged lid, suitable for 1 kg cakes.

## Specifications

| Attribute | Value |
| --- | --- |
| External dimensions | 10 x 10 x 5 inches |
| Material | 300 GSM food-grade virgin kraft paperboard |
| Food contact | Manufactured to FSSAI food-contact requirements; certificate available on request |
| Colour | White |
| Pack size | 50 boxes per pack |
| Price | Rs. 720 per pack of 50 |
| Minimum order | 2 packs |

## Delivery

Dispatched within 2-3 business days from our Pune warehouse.
We deliver pan-India through registered courier partners.
Shipping charges are calculated at checkout based on destination.

## About

BoxCraft Packaging has supplied bakery packaging since 2011.
Contact: sales@boxcraft.example.invalid
`,
  },

  {
    url: 'https://punepack.example.invalid/bakery/cake-boxes-10-inch',
    title: 'Cake Box 10x10x5 in (Pack of 25) | PunePack',
    contactEmail: 'orders@punepack.example.invalid',
    markdown: `# Cake Box 10x10x5 in (Pack of 25)

PunePack bakery packaging — locally manufactured in Pune.

- **Size:** 10 x 10 x 5 inches (outer)
- **Sold in:** packs of 25 units
- **Price:** Rs. 380 per pack
- **Minimum order:** 4 packs
- **Orders placed in multiples of:** 4 packs
- **Material:** Recycled kraft board, 280 GSM
- **Food safe:** Yes, food grade

## Shipping

Free delivery within Pune city limits on orders above Rs. 2,000.
Same-day dispatch for orders placed before 2 PM.

Enquiries: orders@punepack.example.invalid
`,
  },

  {
    url: 'https://bulkbox.example.invalid/wholesale/cake-cartons',
    title: 'Wholesale Cake Cartons 10x10x5 — BulkBox Industrial',
    contactEmail: 'wholesale@bulkbox.example.invalid',
    markdown: `# Wholesale Cake Cartons 10 x 10 x 5 inch

Industrial wholesale pricing for high-volume bakeries.

**Specifications**
- Outer dimensions: 10 x 10 x 5 inches
- Material: Food-grade corrugated board
- Certification: IS 2771 / FSSAI compliant
- Pack size: 100 cartons per pack
- Price: Rs. 1,150 per pack of 100
- **Minimum order quantity: 50 packs (5,000 cartons)**

Delivery in 5-7 working days across Maharashtra.

Bulk enquiries: wholesale@bulkbox.example.invalid
`,
  },

  {
    url: 'https://greenleaf.example.invalid/eco-cake-box-10in',
    title: 'GreenLeaf Eco Cake Box 10 inch',
    contactEmail: 'hello@greenleaf.example.invalid',
    markdown: `# GreenLeaf Eco Cake Box — 10 inch

100% recycled, compostable cake packaging for conscious bakeries.

- Dimensions: 10 x 10 x 5 inches
- Material: 100% recycled kraft, compostable coating
- Pack: 40 boxes
- Price: Rs. 590 per pack
- Minimum order: 1 pack

Food safe for direct contact with baked goods.

*Contact us for delivery options.*

hello@greenleaf.example.invalid
`,
  },

  {
    url: 'https://metrocartons.example.invalid/cake-box-series/mc-1005',
    title: 'Metro Cartons MC-1005 Cake Box',
    contactEmail: 'sales@metrocartons.example.invalid',
    markdown: `# Metro Cartons MC-1005 Cake Box

Professional bakery carton, series MC.

## Dimensions

Internal usable dimensions: 10 x 10 x 5 inches
External dimensions: 10.5 x 10.5 x 5.25 inches

Please note the internal measurement when sizing your product.

## Commercial

- Material: Duplex board, 320 GSM, food-grade lamination
- Pack size: 50 units
- Price: Rs. 770 per pack
- Minimum order: 2 packs
- Dispatch: 4 business days
- Delivery: Mumbai, Pune, Nashik and Nagpur

sales@metrocartons.example.invalid
`,
  },

  {
    url: 'https://silentsupply.example.invalid/products/cake-box-premium',
    title: 'SilentSupply Premium Cake Box',
    failure:
      'The supplier page did not respond within the time limit. This is a retrieval failure and says nothing about whether the product is available.',
    markdown: '',
  },
];

/** The page used when the demo brief supplies an "original product URL". */
export const FIXTURE_ORIGINAL_PRODUCT: FixturePage = {
  url: 'https://oldsupplier.example.invalid/cake-box-10x10x5-standard',
  title: 'Standard Cake Box 10x10x5 — OUT OF STOCK',
  markdown: `# Standard Cake Box 10 x 10 x 5 inch

## OUT OF STOCK — restocking date not confirmed

This was your previous supplier's listing.

- External dimensions: 10 x 10 x 5 inches
- Material: 300 GSM food-grade kraft
- Pack size: 50 boxes
- Last listed price: Rs. 720 per pack of 50
- Minimum order: 1 pack

We apologise for the inconvenience. Please check back later.
`,
};

export function findFixture(url: string): FixturePage | null {
  const normalize = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  const target = normalize(url);
  if (normalize(FIXTURE_ORIGINAL_PRODUCT.url) === target) return FIXTURE_ORIGINAL_PRODUCT;
  return FIXTURE_PAGES.find((p) => normalize(p.url) === target) ?? null;
}

/** Stands in for search results in demo mode. */
export const FIXTURE_SEARCH_RESULTS = FIXTURE_PAGES.map((p) => ({
  url: p.url,
  title: p.title,
  snippet: p.markdown.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.slice(0, 160) ?? '',
}));
