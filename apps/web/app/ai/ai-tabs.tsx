'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The two tabs inside the AI tab: the assistant itself, and the settings for which AI provider, key and model it uses. */
export function AiTabs() {
  const path = usePathname();
  const tab = (href: string, label: string) => {
    const active = href === '/ai' ? path === '/ai' || path.startsWith('/ai/t/') : path.startsWith(href);
    return (
      <Link
        href={href} aria-current={active ? 'page' : undefined}
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'}`}
      >
        {label}
      </Link>
    );
  };
  return <nav aria-label="AI sections" className="mt-4 flex gap-1 border-b border-border pb-2">{tab('/ai', 'Assistant')}{tab('/ai/settings', 'AI settings')}</nav>;
}
