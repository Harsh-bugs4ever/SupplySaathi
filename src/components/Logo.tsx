/**
 * Saathi, the SupplySaathi mascot.
 *
 * A friendly cartoon ghost carrying a parcel. The metaphor is the point: your
 * supplier vanished, so a helpful ghost goes and finds the box for you.
 * ("Saathi" means companion.)
 *
 * Drawn as inline SVG rather than an image file so it inherits currentColor,
 * stays crisp at every size, and costs no extra request.
 */

export function GhostMark({
  size = 40,
  className = '',
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="SupplySaathi"
    >
      {/* Body: a rounded dome with a scalloped hem. */}
      <path
        d="M32 5c-11.6 0-21 9.4-21 21v25.6c0 2.2 2.6 3.4 4.3 2l3.4-2.9a3.2 3.2 0 0 1 4.2 0l2.9 2.5a3.2 3.2 0 0 0 4.2 0l2.9-2.5a3.2 3.2 0 0 1 4.2 0l2.9 2.5a3.2 3.2 0 0 0 4.2 0l3.4-2.9c1.7-1.4 4.3-.2 4.3 2V26c0-11.6-9.4-21-21-21Z"
        fill="currentColor"
      />

      {/* Eyes. Kept wide-set and simple so the face reads at 20px in the nav. */}
      <ellipse cx="24" cy="25" rx="3.4" ry="4.2" fill="var(--color-surface)" />
      <ellipse cx="40" cy="25" rx="3.4" ry="4.2" fill="var(--color-surface)" />
      <circle cx="24.8" cy="26" r="1.5" fill="var(--color-ink)" />
      <circle cx="40.8" cy="26" r="1.5" fill="var(--color-ink)" />

      {/* A small smile. */}
      <path
        d="M28.5 33.5c1 1.4 2.2 2.1 3.5 2.1s2.5-.7 3.5-2.1"
        stroke="var(--color-surface)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />

      {/* The parcel it is delivering, tucked under one arm. */}
      <g transform="translate(37.5 34.5) rotate(-8)">
        <rect width="19" height="15" rx="2" fill="var(--color-accent)" />
        <path d="M9.5 0v15" stroke="var(--color-primary)" strokeWidth="1.6" opacity="0.85" />
        <path d="M0 5.4h19" stroke="var(--color-primary)" strokeWidth="1.6" opacity="0.85" />
      </g>

      {animated && (
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 0; 0 -1.6; 0 0"
          dur="3.2s"
          repeatCount="indefinite"
        />
      )}
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <GhostMark size={compact ? 26 : 34} className="text-primary shrink-0" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="display text-[19px] text-ink">
            Supply<span className="text-primary">Saathi</span>
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            Sourcing rescue
          </span>
        </span>
      )}
    </span>
  );
}

/** Large friendly mascot for empty states. */
export function GhostEmpty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <GhostMark size={72} className="text-line-strong" animated />
      <p className="mt-5 max-w-sm text-[15px] font-medium text-ink-soft">{message}</p>
      {hint && <p className="mt-1.5 max-w-sm text-[13px] text-ink-faint">{hint}</p>}
    </div>
  );
}
