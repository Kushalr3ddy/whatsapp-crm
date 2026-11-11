'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A `<details>` whose body is built only once it has been opened.
 *
 * A Contacts page has dozens of rows, and every row's opened panel holds forms (add a tag, do-not-contact,
 * and one input per custom field). Drawn up front they made the page about 3,600 elements and 800 inputs that
 * the browser had to build and hydrate before showing anything, although almost no row is ever opened.
 * The summary line is always there; the panel appears the moment the row is opened, and stays once it has.
 * A row opened before the page finished starting up (a fast click, or a script) is caught on startup, since the
 * browser's `toggle` event would have fired before anything was listening.
 */
export function LazyDetails({ summary, summaryClassName, children, className }: {
  summary: ReactNode; summaryClassName?: string; children: ReactNode; className?: string;
}) {
  const [opened, setOpened] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (ref.current?.open === true) setOpened(true); }, []);
  return (
    <details ref={ref} className={className} onToggle={(e) => { if (e.currentTarget.open) setOpened(true); }}>
      <summary className={summaryClassName}>{summary}</summary>
      {opened && children}
    </details>
  );
}
