'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GhostMark, Wordmark } from './Logo';

/**
 * Navigation.
 *
 * Desktop: a slim left rail. Mobile: a bottom bar, so the primary action stays
 * under the thumb — this is a tool someone uses standing in a kitchen with one
 * hand free, not only at a desk.
 */

const ITEMS = [
  {
    href: '/',
    label: 'New case',
    icon: (
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    ),
  },
  {
    href: '/cases',
    label: 'Cases',
    icon: (
      <>
        <rect x="3.2" y="4.5" width="13.6" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.2 8.2h13.6M7.5 4.5v11.5" stroke="currentColor" strokeWidth="1.5" />
      </>
    ),
  },
  {
    href: '/profile',
    label: 'Business',
    icon: (
      <>
        <circle cx="10" cy="7.2" r="2.8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.5 16.2c0-2.8 2.5-4.6 5.5-4.6s5.5 1.8 5.5 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: (
      <>
        <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 3.2v1.6M10 15.2v1.6M16.8 10h-1.6M4.8 10H3.2M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

export function Nav({ mode }: { mode: 'demo' | 'live' }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Desktop rail */}
      <nav className="app-rail hidden shrink-0 border-r border-line bg-surface lg:flex lg:w-[228px] lg:flex-col">
        <div className="px-5 py-5">
          <Link href="/" className="block">
            <Wordmark />
          </Link>
        </div>

        <div className="px-6 pb-3 pt-8 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Workspace</div>
        <ul className="flex-1 space-y-2 px-3">
          {ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-3 text-[14px] transition ${
                    active
                      ? 'bg-primary font-medium text-paper shadow-sm'
                      : 'text-ink-soft hover:bg-surface-sunk hover:text-ink'
                  }`}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                    {item.icon}
                  </svg>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-line px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] text-ink-faint">
            <span
              className={`h-1.5 w-1.5 rounded-full ${mode === 'live' ? 'bg-primary' : 'bg-warning'}`}
              aria-hidden
            />
            <span className="uppercase tracking-[0.1em]">{mode} default</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Evidence behind every recommendation.
          </p>
        </div>
      </nav>

      {/* Mobile header */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Link href="/">
          <Wordmark />
        </Link>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
            mode === 'live'
              ? 'border-primary/25 bg-primary-wash text-primary'
              : 'border-warning/35 bg-warning-wash text-warning-ink'
          }`}
        >
          {mode}
        </span>
      </header>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface lg:hidden">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition ${
                active ? 'text-primary' : 'text-ink-faint'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export { GhostMark };
