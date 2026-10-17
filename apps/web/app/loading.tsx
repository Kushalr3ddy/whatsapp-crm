/** Shown while a page's data loads: grey blocks in the shape of the page, so nothing jumps when it arrives. */
export default function Loading() {
  return (
    <main className="page" aria-busy="true" aria-label="Loading">
      <div className="sk mb-2 h-8 w-56" />
      <div className="sk mb-8 h-4 w-96 max-w-full" />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="sk h-24" />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="sk h-56" />
        <div className="sk h-56" />
      </div>
    </main>
  );
}
