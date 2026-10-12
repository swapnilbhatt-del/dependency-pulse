export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6 pt-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the comparison…</span>
      <div className="skeleton h-4 w-40" />
      <div className="skeleton mt-3 h-12 w-64" />
      <div className="card mt-6 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="grid grid-cols-[9rem_1fr_1fr] gap-4 border-t border-line p-4 first:border-t-0">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
