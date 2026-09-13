import type { DimensionSurface, ExtractedDimensions, LengthUnit } from './types';

/**
 * Length handling.
 *
 * Everything is compared in millimetres internally. Conversion factors are
 * exact by definition (1 in === 25.4 mm), so there is no estimation here.
 */

const TO_MM: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

export function toMm(value: number, unit: LengthUnit): number {
  return value * TO_MM[unit];
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / TO_MM[unit];
}

export function formatLength(value: number, unit: LengthUnit): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}

export function formatDimensions(d: ExtractedDimensions): string {
  const surface = d.surface === 'unspecified' ? '' : ` (${d.surface})`;
  return `${trim(d.length)} x ${trim(d.width)} x ${trim(d.height)} ${d.unit}${surface}`;
}

function trim(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DimensionComparison {
  /** True when all three axes are within tolerance. */
  matches: boolean;
  /** True when the two measurements describe different surfaces. */
  surfaceMismatch: boolean;
  perAxis: Array<{ axis: 'length' | 'width' | 'height'; requiredMm: number; actualMm: number; deltaPct: number; withinTolerance: boolean }>;
}

/**
 * Compare a candidate's dimensions against a requirement.
 *
 * Axes are sorted before comparison, because "10 x 10 x 5" and "5 x 10 x 10"
 * describe the same box; suppliers are inconsistent about ordering.
 *
 * We do NOT attempt to reconcile internal against external measurements. A box
 * whose internal dimensions are 10 x 10 x 5 is a different product from one
 * whose external dimensions are 10 x 10 x 5, and the difference matters when a
 * cake has to fit. When the surfaces differ we report `surfaceMismatch` and
 * leave the decision to the constraint layer, which downgrades it to unknown.
 */
export function compareDimensions(
  required: { length: number; width: number; height: number; unit: LengthUnit; surface: DimensionSurface; tolerancePct: number },
  actual: ExtractedDimensions,
): DimensionComparison {
  const reqSorted = [required.length, required.width, required.height]
    .map((v) => toMm(v, required.unit))
    .sort((a, b) => b - a);
  const actSorted = [actual.length, actual.width, actual.height]
    .map((v) => toMm(v, actual.unit))
    .sort((a, b) => b - a);

  const axes: Array<'length' | 'width' | 'height'> = ['length', 'width', 'height'];
  const perAxis = reqSorted.map((requiredMm, i) => {
    const actualMm = actSorted[i];
    const deltaPct = requiredMm === 0 ? 0 : ((actualMm - requiredMm) / requiredMm) * 100;
    return {
      axis: axes[i],
      requiredMm,
      actualMm,
      deltaPct,
      withinTolerance: Math.abs(deltaPct) <= required.tolerancePct,
    };
  });

  const surfaceMismatch =
    required.surface !== 'unspecified' &&
    actual.surface !== 'unspecified' &&
    required.surface !== actual.surface;

  return {
    matches: perAxis.every((a) => a.withinTolerance),
    surfaceMismatch,
    perAxis,
  };
}

/**
 * Parse a free-text dimension string such as:
 *   "10 x 10 x 5 inches", "254 x 254 x 127 mm", "10x10x5in (internal)"
 * Returns null rather than guessing when the string is not clearly a triple.
 */
export function parseDimensionString(input: string): ExtractedDimensions | null {
  const text = input.toLowerCase();
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/,
  );
  if (!match) return null;

  const [, l, w, h] = match;
  const after = text.slice(match.index! + match[0].length);
  const unit = detectUnit(after) ?? detectUnit(text) ?? 'in';
  const surface = detectSurface(text);

  return {
    length: Number(l),
    width: Number(w),
    height: Number(h),
    unit,
    surface,
  };
}

export function detectUnit(text: string): LengthUnit | null {
  if (/\b(mm|millimet(er|re)s?)\b/.test(text)) return 'mm';
  if (/\b(cm|centimet(er|re)s?)\b/.test(text)) return 'cm';
  if (/\b(in|ins|inch|inches|")\b/.test(text) || text.includes('"')) return 'in';
  return null;
}

export function detectSurface(text: string): DimensionSurface {
  if (/\b(internal|inner|inside|id\b|usable)\b/.test(text)) return 'internal';
  if (/\b(external|outer|outside|od\b|overall)\b/.test(text)) return 'external';
  return 'unspecified';
}
