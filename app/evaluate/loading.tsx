export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 sm:px-6 pt-10 min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the watchlist…</span>
      <div className="skeleton h-3 w-32" />
      <div className="skeleton mt-3 h-12 w-80 max-w-full" />
      <div className="skeleton mt-4 h-4 w-full max-w-2xl" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="flex justify-between">
              <div className="skeleton h-5 w-48" />
              <div className="skeleton h-8 w-16" />
            </div>
            <div className="skeleton mt-4 h-6 w-40 rounded-full" />
            <div className="skeleton mt-4 h-4 w-full" />
            <div className="skeleton mt-2 h-4 w-5/6" />
          </div>
        ))}
      </div>
    </main>
  );
}
