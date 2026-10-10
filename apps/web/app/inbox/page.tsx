/** Shown when no thread is selected. The list lives in the layout, so this is just a hint. */
export default function NoThreadSelected() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="avatar size-14" aria-hidden>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
      <div>
        <p className="font-medium">Select a conversation</p>
        <p className="mt-0.5 text-sm text-muted">Pick a thread on the left to read and reply.</p>
      </div>
    </div>
  );
}
