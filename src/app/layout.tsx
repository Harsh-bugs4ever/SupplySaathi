import type { Metadata, Viewport } from 'next';
import { config } from '@/lib/config/env';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'SupplySaathi — sourcing rescue',
  description:
    'Your supplier fell through. Your business shouldn’t. Find replacement suppliers, understand the tradeoffs, and get quote requests ready — with evidence behind every recommendation.',
};

export const viewport: Viewport = {
  themeColor: '#F5F3EC',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath d='M32 5c-11.6 0-21 9.4-21 21v25.6c0 2.2 2.6 3.4 4.3 2l3.4-2.9a3.2 3.2 0 0 1 4.2 0l2.9 2.5a3.2 3.2 0 0 0 4.2 0l2.9-2.5a3.2 3.2 0 0 1 4.2 0l2.9 2.5a3.2 3.2 0 0 0 4.2 0l3.4-2.9c1.7-1.4 4.3-.2 4.3 2V26c0-11.6-9.4-21-21-21Z' fill='%23285943'/%3E%3Cellipse cx='24' cy='25' rx='3.4' ry='4.2' fill='%23FFFEFA'/%3E%3Cellipse cx='40' cy='25' rx='3.4' ry='4.2' fill='%23FFFEFA'/%3E%3C/svg%3E"
        />
      </head>
      <body className="min-h-screen">
        {/* Demo mode is announced permanently and unmissably. A viewer must
            never be in doubt about whether the data in front of them is real. */}
        {config.mode === 'demo' && (
          <div className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-center text-[12px] font-medium text-white">
            <span aria-hidden>●</span>
            Demo mode — sample supplier data; no real outreach.
          </div>
        )}

        <div className="flex min-h-screen flex-col lg:flex-row">
          <Nav mode={config.mode} />
          <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
