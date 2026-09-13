import { parseDimensionString, detectSurface } from '../../domain/units';
import type {
  ProviderHealth,
  ReasoningProvider,
  ReasoningRequest,
  ReasoningResult,
} from '../types';
import type { ExtractedProduct, ParsedBrief, SearchPlan, DraftedQuote } from './schemas';

/**
 * Rule-based ReasoningProvider.
 *
 * Used in demo mode, and as the fallback when DeepSeek is not configured or is
 * unreachable. It handles the same tasks with regular expressions instead of a
 * model: less capable on messy prose, but deterministic, free, and offline.
 *
 * This exists so the product has an honest answer to "what happens when the
 * model is down" that is not "the app stops working". Its output is labelled in
 * the UI as rule-based so nobody mistakes it for model interpretation.
 */
export class DeterministicProvider implements ReasoningProvider {
  readonly kind = 'rule-based';

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.kind,
      configured: true,
      checkedAt: new Date().toISOString(),
      capabilities: [
        {
          name: 'chat_completions',
          available: true,
          detail: 'Deterministic rule-based extraction. No network, no model.',
        },
      ],
    };
  }

  async complete<T>(req: ReasoningRequest<T>): Promise<ReasoningResult<T>> {
    const handler = HANDLERS[req.task];
    if (!handler) {
      throw new Error(`Rule-based provider has no implementation for task "${req.task}".`);
    }

    const produced = handler(req.user);
    const validated = req.validate(produced);
    if (!validated.ok) {
      throw new Error(`Rule-based ${req.task} produced invalid output: ${validated.error}`);
    }

    return {
      value: validated.value,
      raw: JSON.stringify(produced),
      model: this.kind,
      retried: false,
    };
  }
}

type Handler = (input: string) => unknown;

const HANDLERS: Record<string, Handler> = {
  parse_brief: parseBrief,
  plan_search: planSearch,
  extract_product: extractProduct,
  draft_quote: draftQuote,
};

// ── Brief parsing ───────────────────────────────────────────────────────────

function parseBrief(input: string): ParsedBrief {
  const text = input.toLowerCase();

  const qty = text.match(/\b(\d[\d,]{1,8})\s*(units?|pcs|pieces|boxes|box|cartons?)\b/);
  const qtyAlt = text.match(/\bneed\s+(\d[\d,]{1,8})\b/);
  const units = qty ? intOf(qty[1]) : qtyAlt ? intOf(qtyAlt[1]) : null;

  const dims = parseDimensionString(input);

  const budget = text.match(/(?:budget|under|below|max(?:imum)?)\D{0,12}?([₹$€£]|rs\.?|inr|usd)?\s*(\d[\d,]{2,9})/);
  const currency = budget ? currencyFrom(budget[1] ?? '') : 'INR';

  const city = matchCity(input);

  const materials: string[] = [];
  for (const m of ['kraft', 'corrugated', 'cardboard', 'paperboard', 'recycled', 'compostable', 'plastic']) {
    if (text.includes(m)) materials.push(m);
  }

  const certifications: string[] = [];
  for (const c of ['fssai', 'fda', 'lfgb', 'iso 22000', 'bis']) {
    if (text.includes(c)) certifications.push(c);
  }

  const preferences: string[] = [];
  if (/\brecycl/.test(text)) preferences.push('Recycled or recyclable material');
  if (/\blocal\b/.test(text)) preferences.push('Local supplier');
  if (/\beco|sustainab|compostab/.test(text)) preferences.push('Environmentally responsible packaging');

  const deadlinePhrase =
    input.match(
      /\b(by\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|next week|end of week|in \d+ days?|\d{4}-\d{2}-\d{2}|\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?)\b/i,
    )?.[0] ?? null;

  const clarifications: ParsedBrief['clarifications'] = [];
  if (!units) {
    clarifications.push({
      question: 'How many units do you need in total?',
      reason: 'Pack sizes and minimum orders cannot be checked without a quantity.',
    });
  }
  if (!dims) {
    clarifications.push({
      question: 'What dimensions does the product need to be?',
      reason: 'Dimensions are the main filter for rejecting incompatible listings.',
    });
  }

  return {
    title: buildTitle(units, dims, input),
    productName: extractProductName(input),
    quantity: units ? { units, partialOk: /\bpartial\b/.test(text) } : null,
    dimensions: dims
      ? { ...dims, surface: dims.surface === 'unspecified' ? 'external' : dims.surface }
      : null,
    material: materials,
    certifications,
    foodContactRequired: /\bfood[- ]?(contact|safe|grade)\b|\bdirect food\b/.test(text),
    delivery: city ? { city, postalCode: matchPostal(input), country: 'IN' } : null,
    deadlinePhrase,
    budget: budget ? { maxAmount: intOf(budget[2]), currency, scope: 'merchandise' } : null,
    substitutionsOk: !/\bno substitut/.test(text),
    preferences,
    clarifications,
  };
}

function buildTitle(units: number | null, dims: ReturnType<typeof parseDimensionString>, input: string): string {
  const noun = extractProductName(input) ?? 'Replacement supply';
  const parts = [units ? `${units}` : null, noun, dims ? `${dims.length}x${dims.width}x${dims.height}${dims.unit}` : null];
  return parts.filter(Boolean).join(' ').slice(0, 120);
}

function extractProductName(input: string): string | null {
  const m = input.match(/\b(cake box(?:es)?|cake carton(?:s)?|pastry box(?:es)?|bakery box(?:es)?|cupcake box(?:es)?|box(?:es)?)\b/i);
  return m ? m[0].toLowerCase() : null;
}

const KNOWN_CITIES = [
  'pune', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad', 'chennai',
  'kolkata', 'ahmedabad', 'surat', 'jaipur', 'nashik', 'nagpur', 'indore',
];

function matchCity(input: string): string | null {
  const lower = input.toLowerCase();
  // Prefer an explicit "to <city>" / "in <city>" phrasing before falling back.
  const explicit = lower.match(/\b(?:to|in|at|deliver(?:ed)? to)\s+([a-z]{3,20})\b/);
  if (explicit && KNOWN_CITIES.includes(explicit[1])) return titleCase(explicit[1]);
  const found = KNOWN_CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(lower));
  return found ? titleCase(found) : null;
}

function matchPostal(input: string): string | null {
  return input.match(/\b(\d{6})\b/)?.[1] ?? null;
}

// ── Search planning ─────────────────────────────────────────────────────────

function planSearch(input: string): SearchPlan {
  const dims = parseDimensionString(input);
  const product = extractProductName(input) ?? 'packaging';
  const city = matchCity(input);

  const queries = [
    `${product} ${dims ? `${dims.length}x${dims.width}x${dims.height} ${dims.unit}` : ''} food grade supplier`.trim(),
    `${product} wholesale ${city ?? 'India'} bulk price`,
    `food grade ${product} manufacturer minimum order`,
  ];

  return {
    queries: queries.filter((q) => q.length >= 3).slice(0, 4),
    reasoning: 'Rule-based plan: product and size, then a regional wholesale query, then manufacturers.',
  };
}

// ── Product extraction ──────────────────────────────────────────────────────

/**
 * Extract product facts from page text.
 *
 * Each field returns both the value and the excerpt it came from, matching the
 * schema the model is held to. A field with no matching excerpt stays null,
 * which becomes "unknown" downstream rather than a default.
 */
function extractProduct(input: string): ExtractedProduct {
  // The prompt wraps page content in a fence; work on the content only.
  const content = input.includes('<<<PAGE_CONTENT>>>')
    ? input.split('<<<PAGE_CONTENT>>>')[1]?.split('<<<END_PAGE_CONTENT>>>')[0] ?? input
    : input;

  const lines = content.split('\n');
  const lower = content.toLowerCase();

  const fact = <T>(value: T | null, excerpt: string | null) => ({
    value: value ?? null,
    excerpt: value === null ? null : excerpt,
  });

  // Pack size: "pack of 25", "50 boxes per pack", "Pack size | 50"
  const packMatch =
    content.match(/pack\s*(?:of|size)?\s*[:|]?\s*(\d{1,5})\s*(?:boxes|units|pcs|pieces)?/i) ??
    content.match(/(\d{1,5})\s*(?:boxes|units|pcs|pieces)\s*per\s*pack/i);
  const unitsPerPack = packMatch ? intOf(packMatch[1]) : null;

  // Price: "Rs. 750 per pack", "₹410", "Price | Rs 890"
  const priceMatch = content.match(
    /(?:price|cost|rate)?\s*[:|]?\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  const priceAmount = priceMatch ? floatOf(priceMatch[1]) : null;

  // Minimum order, in packs.
  const moqMatch = content.match(
    /minimum\s*order\s*(?:quantity)?\s*[:|]?\s*(\d{1,6})\s*(packs?|units?|boxes|cartons?)?/i,
  );
  let minOrderPacks: number | null = null;
  if (moqMatch) {
    const n = intOf(moqMatch[1]);
    const unit = (moqMatch[2] ?? 'packs').toLowerCase();
    // A MOQ quoted in units has to be converted to packs before it is comparable.
    minOrderPacks = unit.startsWith('pack')
      ? n
      : unitsPerPack
        ? Math.ceil(n / unitsPerPack)
        : null;
  }

  const incMatch = content.match(/multiples?\s*of\s*[:|]?\s*(\d{1,4})\s*(packs?)?/i);

  // Dimensions, and the internal/external conflict case.
  const conflicts: string[] = [];
  const internalLine = lines.find((l) => /internal|inner|inside/i.test(l) && /\d+\s*[x×]\s*\d+/.test(l));
  const externalLine = lines.find((l) => /external|outer|outside/i.test(l) && /\d+\s*[x×]\s*\d+/.test(l));
  const anyDimLine = lines.find((l) => /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*\d+/.test(l));

  let dimensions = null as ExtractedProduct['dimensions']['value'];
  let dimExcerpt: string | null = null;

  if (internalLine && externalLine) {
    // Both stated and different: record the conflict and report the internal
    // figure, which is the one that determines whether a cake fits.
    conflicts.push(
      `Page states both internal (${internalLine.trim()}) and external (${externalLine.trim()}) dimensions.`,
    );
    const parsed = parseDimensionString(internalLine);
    if (parsed) {
      dimensions = { ...parsed, surface: 'internal' as const };
      dimExcerpt = internalLine.trim();
    }
  } else {
    const src = externalLine ?? internalLine ?? anyDimLine ?? null;
    if (src) {
      const parsed = parseDimensionString(src);
      if (parsed) {
        const surface = detectSurface(src);
        dimensions = { ...parsed, surface };
        dimExcerpt = src.trim();
      }
    }
  }

  const materialLine = lines.find((l) => /material/i.test(l) && l.length < 200);

  // Food-contact: a line naming an actual standard is far more informative than
  // one that merely says "food grade", and several pages contain both. Prefer
  // the standard so the constraint layer can distinguish a cited certification
  // from a bare marketing claim.
  const foodCandidates = lines.filter((l) =>
    /food[- ]?(safe|grade|contact)|fssai|fda|lfgb|en\s*1935|is\s*2771|iso\s*22000|brc/i.test(l),
  );
  const foodLine =
    foodCandidates.find((l) => /fssai|fda|lfgb|en\s*1935|is\s*2771|iso\s*22000|brc/i.test(l)) ??
    foodCandidates[0];

  // Shipping information is routinely spread over several lines ("dispatched in
  // 2-3 days" on one, "we deliver pan-India" on another). Taking only the first
  // match loses the half that answers whether they reach the buyer's city, so
  // the relevant lines are joined.
  const shippingLines = lines.filter(
    (l) => /shipping|delivery|deliver|courier|dispatch|ships?\b/i.test(l) && l.trim().length < 300,
  );
  const shippingLine = shippingLines.length
    ? shippingLines.slice(0, 4).map((l) => cleanLine(l)).join(' ').slice(0, 300)
    : undefined;
  const leadLine = lines.find((l) =>
    /(dispatch|ship|delivery|deliver).{0,30}\d+\s*(-|to|–)?\s*\d*\s*(business |working )?(day|hour)/i.test(l),
  );

  const supplierName = guessSupplier(content);

  return {
    isProductPage: Boolean(unitsPerPack || priceAmount || dimensions),
    supplierName,
    productTitle: lines.find((l) => l.startsWith('# '))?.replace(/^#\s*/, '').trim() ?? null,
    imageUrl: content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/)?.[1] ?? null,
    contactEmail: content.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null,

    unitsPerPack: fact(unitsPerPack, packMatch?.[0]?.trim() ?? null),
    pricePerPack: fact(
      priceAmount !== null ? { amount: priceAmount, currency: 'INR' } : null,
      priceMatch?.[0]?.trim() ?? null,
    ),
    minOrderPacks: fact(minOrderPacks, moqMatch?.[0]?.trim() ?? null),
    orderIncrementPacks: fact(incMatch ? intOf(incMatch[1]) : null, incMatch?.[0]?.trim() ?? null),
    dimensions: fact(dimensions, dimExcerpt),
    material: fact(materialLine ? cleanLine(materialLine) : null, materialLine?.trim() ?? null),
    foodContactClaim: fact(foodLine ? cleanLine(foodLine) : null, foodLine?.trim() ?? null),
    shippingInfo: fact(shippingLine ?? null, shippingLines[0]?.trim() ?? null),
    leadTimeInfo: fact(leadLine ? cleanLine(leadLine) : null, leadLine?.trim() ?? null),
    conflicts,
  };
}

function guessSupplier(content: string): string | null {
  const email = content.match(/[\w.+-]+@([\w-]+)\./)?.[1];
  if (email) return titleCase(email.replace(/[-_]/g, ' '));
  const brand = content.match(/^#\s*(.+)$/m)?.[1];
  return brand ? brand.split(/[—|-]/)[0].trim().slice(0, 60) : null;
}

// ── Quote drafting ──────────────────────────────────────────────────────────

/**
 * A plain, complete request for quote. Deliberately unembellished: the value is
 * in asking every open question, not in the prose.
 */
function draftQuote(input: string): DraftedQuote {
  const get = (tag: string) =>
    input.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';

  const supplier = get('supplier') || 'Supplier';
  const product = get('product') || 'the product listed';
  const quantity = get('quantity');
  const specs = get('specs');
  const destination = get('destination');
  const deadline = get('deadline');
  const unknowns = get('unknowns')
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  const business = get('business') || 'our bakery';
  const sourceUrl = get('sourceUrl');

  const questions = [
    ...unknowns.map((u) => `Please confirm: ${u}`),
    'What is the total delivered price including shipping and applicable taxes?',
    'What is your lead time for dispatch, and the expected delivery date to our address?',
    'Can you share documentation for food-contact suitability?',
  ];

  const body = [
    `Hello ${supplier},`,
    '',
    `I am writing from ${business}. Our regular supplier has fallen through and we are sourcing a replacement urgently.`,
    '',
    `We are interested in: ${product}`,
    sourceUrl ? `Listing we reviewed: ${sourceUrl}` : '',
    '',
    'Our requirement:',
    quantity ? `- Quantity: ${quantity}` : '',
    specs ? `- Specification: ${specs}` : '',
    destination ? `- Delivery to: ${destination}` : '',
    deadline ? `- Required arrival: ${deadline}` : '',
    '',
    'Could you please confirm the following:',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'If you can meet the date, please send a formal quotation with your payment terms.',
    '',
    'Thank you,',
    business,
  ]
    .filter((l) => l !== '')
    .join('\n');

  return {
    subject: `Request for quotation — ${product}${quantity ? ` (${quantity})` : ''}`.slice(0, 160),
    body,
    questions: questions.slice(0, 8),
  };
}

// ── Small helpers ───────────────────────────────────────────────────────────

function intOf(s: string): number {
  return parseInt(s.replace(/,/g, ''), 10);
}
function floatOf(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}
function cleanLine(l: string): string {
  return l
    .replace(/^[-*|\s]+/, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 300);
}
function currencyFrom(sym: string): string {
  const s = sym.toLowerCase();
  if (s.includes('$')) return 'USD';
  if (s.includes('€')) return 'EUR';
  if (s.includes('£')) return 'GBP';
  return 'INR';
}
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
