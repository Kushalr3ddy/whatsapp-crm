/** Shown when no chat is chosen. The list lives in the layout, so this is just the hint. */
export default function NoThreadSelected() {
  return (
    <div className="ib-empty">
      <h2>Pick a chat</h2>
      <p>Choose one on the left to read it and reply.</p>
    </div>
  );
}
