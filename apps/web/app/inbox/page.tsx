/** Shown when no thread is selected. The list lives in the layout, so this is just a hint. */
export default function NoThreadSelected() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-muted">Select a conversation.</p>
    </div>
  );
}
