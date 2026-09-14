import { describe, it, expect } from 'vitest';
import {
  looksLikeListingPage,
  looksLikeProductUrl,
  extractProductLinks,
  cleanScrapedName,
  supplierNameFromHost,
} from '@/lib/agent/listing';

/**
 * Listing pages must never become candidates.
 *
 * Splicing a price from one search result onto a pack size from another
 * produces a product that does not exist — the single worst failure mode for a
 * sourcing tool, and one a live run actually hit before this was added.
 */

describe('product URLs are recognised', () => {
  it.each([
    'https://www.amazon.in/Cake-Box-10x10x5/dp/B0ABCD1234',
    'https://www.flipkart.com/cake-box-white/p/itm123456789',
    'https://www.indiamart.com/proddetail/cake-box-22896618.html',
    'https://shop.example.com/products/cake-box-10-inch',
  ])('treats %s as a product', (url) => {
    expect(looksLikeProductUrl(url)).toBe(true);
  });

  it.each([
    'https://www.amazon.in/s?k=cake+box',
    'https://www.flipkart.com/search?q=cake%20box',
    'https://dir.indiamart.com/impcat/cake-boxes.html',
    'https://shop.example.com/collections/cake-boxes',
  ])('treats %s as a listing', (url) => {
    expect(looksLikeProductUrl(url)).toBe(false);
    expect(looksLikeListingPage('', url)).toBe(true);
  });
});

describe('a product page is not misread as a listing', () => {
  it('ignores listing-shaped furniture on a real product page', () => {
    // Reviews carousels and "customers also bought" put these words on nearly
    // every product page.
    const markdown = `# Premium Cake Box 10x10x5
Price: Rs 720. Pack of 50.
Sort by relevance
Filter by rating
Customers also bought`;
    expect(
      looksLikeListingPage(markdown, 'https://www.flipkart.com/cake-box/p/itm999'),
    ).toBe(false);
  });

  it('needs two independent signals for an ambiguous URL', () => {
    const one = 'Filter by size';
    const two = 'Showing 1 to 24\nSort by price and popularity';
    expect(looksLikeListingPage(one, 'https://shop.example.com/x')).toBe(false);
    expect(looksLikeListingPage(two, 'https://shop.example.com/x')).toBe(true);
  });

  it('detects an explicit result count', () => {
    expect(
      looksLikeListingPage('1-48 of 414 results for "cake box"', 'https://shop.example.com/x'),
    ).toBe(true);
  });
});

describe('harvesting product links from a listing', () => {
  const listing = `# Results
[Cake Box 10x10x5 inch Pack of 50](https://shop.example.com/products/cake-box-10)
[Bakery Carton 12 inch](https://shop.example.com/products/carton-12)
[Next](https://shop.example.com/search?page=2)
[Privacy policy](https://shop.example.com/policy/privacy)
[Some other shop](https://other.example.com/products/box)`;

  it('keeps plausible product links only', () => {
    const links = extractProductLinks(listing, 'https://shop.example.com/search?q=box');
    expect(links).toContain('https://shop.example.com/products/cake-box-10');
    expect(links).toContain('https://shop.example.com/products/carton-12');
  });

  it('drops pagination, policy pages and other hosts', () => {
    const links = extractProductLinks(listing, 'https://shop.example.com/search?q=box');
    expect(links.some((l) => l.includes('page=2'))).toBe(false);
    expect(links.some((l) => l.includes('privacy'))).toBe(false);
    expect(links.some((l) => l.includes('other.example.com'))).toBe(false);
  });

  it('ranks links carrying dimensions above vaguer ones', () => {
    const links = extractProductLinks(listing, 'https://shop.example.com/search?q=box');
    expect(links[0]).toBe('https://shop.example.com/products/cake-box-10');
  });

  it('respects the limit', () => {
    expect(extractProductLinks(listing, 'https://shop.example.com/search', 1)).toHaveLength(1);
  });

  it('strips tracking parameters so one product is not counted twice', () => {
    const md = `[Cake Box 10x10](https://shop.example.com/products/box?ref=abc&utm_source=x&size=10)`;
    const [link] = extractProductLinks(md, 'https://shop.example.com/search');
    expect(link).not.toContain('ref=');
    expect(link).not.toContain('utm_source');
    // A genuine product parameter must survive.
    expect(link).toContain('size=10');
  });

  it('refuses links that fail the URL guard', () => {
    const md = `[Cake Box 10x10](http://localhost:3000/products/box)`;
    expect(extractProductLinks(md, 'http://localhost:3000/search')).toHaveLength(0);
  });
});

describe('cleaning scraped names', () => {
  it('unescapes markdown that leaked from the converter', () => {
    expect(cleanScrapedName('\#\# Premium Cake Box')).toBe('Premium Cake Box');
  });

  it('rejects pagination headings outright', () => {
    expect(cleanScrapedName('\#\# 1-48 of 414 results for"cake box"')).toBeNull();
    expect(cleanScrapedName('Results for cake box')).toBeNull();
    expect(cleanScrapedName('42')).toBeNull();
  });

  it('keeps a real title', () => {
    expect(cleanScrapedName('**BoxCraft Premium Cake Box**')).toBe('BoxCraft Premium Cake Box');
  });

  it('handles null input', () => {
    expect(cleanScrapedName(null)).toBeNull();
  });

  it('falls back to the hostname for a supplier name', () => {
    expect(supplierNameFromHost('https://www.boxcraft.example.com/p/1')).toBe('Boxcraft');
  });
});
