'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The two tabs of the AI assistant: the templates (the home of the page) and the AI provider with the on/off switch. */
export function AiTabs() {
  const path = usePathname();
  const tab = (href: string, label: string) => {
    const active = href === '/ai' ? path === '/ai' || path.startsWith('/ai/t/') || path === '/ai/new' : path.startsWith(href);
    return (
      <Link
        href={href} aria-current={active ? 'page' : undefined}
        className={`inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}
      >
        {label}
      </Link>
    );
  };
  return <nav aria-label="AI sections" className="mt-4 flex gap-1 border-b border-border">{tab('/ai', 'Templates')}{tab('/ai/settings', 'AI provider')}</nav>;
}
