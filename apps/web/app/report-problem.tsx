'use client';

import { usePathname } from 'next/navigation';

/**
 * The GitHub issue form to open. The repository is public; the form (`.github/ISSUE_TEMPLATE/bug.yml`) is the one anyone can fill in.
 * Changing the repository for a white-labelled copy means changing this one line.
 */
const REPORT_URL = 'https://github.com/Kushalr3ddy/whatsapp-crm/issues/new';

/**
 * "Report a problem": opens the bug form on GitHub in a new tab with the screen already filled in, so the person only has to say what
 * happened. Nothing personal is attached (no contact, number, message or session) and nothing is sent until they press submit there.
 */
export function ReportProblem() {
  const pathname = usePathname();

  /** Builds the pre-filled form address from this screen and whether this is a local or a deployed copy. */
  function open(): void {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    const q = new URLSearchParams({
      template: 'bug.yml',
      where: pathname,
      env: local ? 'My own machine (dev)' : 'A deployed copy (prod)'
    });
    window.open(`${REPORT_URL}?${q.toString()}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button" onClick={open}
      title="Opens a form on GitHub with this screen filled in. Nothing is sent until you press submit there."
      className="btn btn-ghost btn-sm w-full whitespace-nowrap"
    >
      Report a problem
    </button>
  );
}
