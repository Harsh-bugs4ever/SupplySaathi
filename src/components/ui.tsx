'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { ConstraintOutcome, RequirementPriority } from '@/lib/domain/types';

/**
 * Shared interface primitives.
 *
 * The constraint chip is the load-bearing one: it is how the whole product
 * keeps its promise that "unknown" and "failed" never look alike. Each state
 * gets its own colour AND its own glyph, so the distinction survives both
 * greyscale printing and colour-blindness.
 */

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
};

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className = '',
  title,
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-45 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'px-3 py-1.5 text-[13px]',
    md: 'px-4 py-2.5 text-[14px]',
  };
  const variants = {
    primary: 'bg-primary text-paper hover:bg-primary-hover active:scale-[0.99] lift',
    secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-paper paper-edge',
    ghost: 'text-ink-soft hover:text-ink hover:bg-surface-sunk',
    danger: 'bg-surface text-danger-ink border border-danger/35 hover:bg-danger-wash',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ── Constraint chips ────────────────────────────────────────────────────────

const OUTCOME_STYLE: Record<
  ConstraintOutcome,
  { bg: string; text: string; border: string; glyph: string; label: string }
> = {
  met: {
    bg: 'bg-primary-wash',
    text: 'text-primary',
    border: 'border-primary/25',
    glyph: '✓',
    label: 'Met',
  },
  unknown: {
    bg: 'bg-warning-wash',
    text: 'text-warning-ink',
    border: 'border-warning/35',
    glyph: '?',
    label: 'Unknown',
  },
  failed: {
    bg: 'bg-danger-wash',
    text: 'text-danger-ink',
    border: 'border-danger/30',
    glyph: '✕',
    label: 'Not met',
  },
  not_applicable: {
    bg: 'bg-surface-sunk',
    text: 'text-ink-faint',
    border: 'border-line',
    glyph: '–',
    label: 'N/A',
  },
};

export function ConstraintChip({
  outcome,
  label,
  priority,
  onClick,
  title,
}: {
  outcome: ConstraintOutcome;
  label: string;
  priority?: RequirementPriority;
  onClick?: () => void;
  title?: string;
}) {
  const s = OUTCOME_STYLE[outcome];
  const Tag = onClick ? 'button' : 'span';

  return (
    <Tag
      onClick={onClick}
      title={title ?? `${s.label}: ${label}`}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] leading-tight ${s.bg} ${s.text} ${s.border} ${
        onClick ? 'cursor-pointer hover:brightness-97 transition' : ''
      }`}
    >
      <span aria-hidden className="font-bold opacity-80">
        {s.glyph}
      </span>
      <span className="truncate">{label}</span>
      {priority === 'preference' && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">pref</span>
      )}
      {/* The glyph carries the meaning visually; this carries it to a screen reader. */}
      <span className="sr-only">({s.label})</span>
    </Tag>
  );
}

/** Requirement chip for the brief card, before any candidate is evaluated. */
export function RequirementChip({
  label,
  priority,
}: {
  label: string;
  priority: RequirementPriority;
}) {
  const must = priority === 'must_have';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
        must ? 'border-ink/15 bg-surface text-ink' : 'border-line bg-surface-sunk text-ink-soft'
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${must ? 'bg-primary' : 'bg-ink-faint'}`}
      />
      {label}
      <span className="text-[10px] uppercase tracking-wide opacity-55">
        {must ? 'must' : 'prefer'}
      </span>
    </span>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}) {
  return (
    <Tag className={`rounded-xl border border-line bg-surface paper-edge ${className}`}>
      {children}
    </Tag>
  );
}

export function SectionHeading({
  children,
  action,
  count,
}: {
  children: ReactNode;
  action?: ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        {children}
        {count !== undefined && <span className="num text-[12px] text-ink-faint">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────────

/**
 * Right-hand contextual drawer, and the mobile sheet it becomes.
 *
 * Focus is moved into the panel on open and Escape closes it, because this is
 * where evidence is read and it must be reachable without a mouse.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      ) ?? []).filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[4px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-arrive fixed z-50 flex flex-col border-line bg-surface
                   inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t
                   sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-t-none sm:border-l"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h3 className="display text-[17px] text-ink">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-[12px] text-ink-faint">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-m-1 shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-sunk hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="scroll-slim flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </>
  );
}

// ── Status pill ─────────────────────────────────────────────────────────────

export function StatePill({ state }: { state: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-surface-sunk text-ink-soft border-line',
    NEEDS_CLARIFICATION: 'bg-warning-wash text-warning-ink border-warning/35',
    RESEARCHING: 'bg-primary-wash text-primary border-primary/25',
    EVALUATING: 'bg-primary-wash text-primary border-primary/25',
    SHORTLIST_READY: 'bg-accent/45 text-ink border-accent-deep',
    OUTREACH_DRAFTED: 'bg-surface text-ink border-line-strong',
    AWAITING_APPROVAL: 'bg-warning-wash text-warning-ink border-warning/35',
    SENDING: 'bg-primary-wash text-primary border-primary/25',
    OUTREACH_COMPLETE: 'bg-primary text-paper border-primary',
    PARTIAL_RESULTS: 'bg-warning-wash text-warning-ink border-warning/35',
    FAILED: 'bg-danger-wash text-danger-ink border-danger/30',
    CANCELLED: 'bg-surface-sunk text-ink-faint border-line',
  };
  const live = ['RESEARCHING', 'EVALUATING', 'SENDING'].includes(state);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${
        map[state] ?? map.DRAFT
      }`}
    >
      {live && <span className="animate-pulse-soft h-1.5 w-1.5 rounded-full bg-current" />}
      {state.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

// ── Field ───────────────────────────────────────────────────────────────────

/**
 * A labelled value. `unknown` renders visibly as unknown rather than blank or
 * zero, which is the difference between an honest table and a misleading one.
 */
export function Field({
  label,
  value,
  mono = false,
  onEvidence,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  onEvidence?: () => void;
}) {
  const unknown = value === null || value === undefined || value === '';

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[12px] text-ink-soft">{label}</dt>
      <dd
        className={`min-w-0 text-right text-[13px] ${
          unknown ? 'text-warning-ink' : `text-ink ${mono ? 'num' : ''}`
        }`}
      >
        {unknown ? (
          <span className="inline-flex items-center gap-1 italic">Not stated</span>
        ) : (
          value
        )}
        {onEvidence && !unknown && (
          <button
            onClick={onEvidence}
            title="Show the evidence for this value"
            className="ml-1.5 align-middle text-ink-faint transition hover:text-primary"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
              <path
                d="M8 7.2v3.6M8 5.2v.9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="sr-only">Evidence for {label}</span>
          </button>
        )}
      </dd>
    </div>
  );
}

// ── Banner ──────────────────────────────────────────────────────────────────

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: 'bg-surface border-line text-ink-soft',
    warning: 'bg-warning-wash border-warning/35 text-warning-ink',
    danger: 'bg-danger-wash border-danger/30 text-danger-ink',
    success: 'bg-primary-wash border-primary/25 text-primary',
  };
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] ${tones[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
