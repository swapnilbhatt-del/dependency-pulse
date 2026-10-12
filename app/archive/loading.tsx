export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-[46rem] px-4 sm:px-6 pt-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading digest…</span>
      <div className="skeleton h-3 w-48" />
      <div className="skeleton mt-4 h-9 w-4/5" />
      <div className="skeleton mt-3 h-4 w-2/3" />
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px rounded-[10px] overflow-hidden border border-line">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface p-4 min-h-[96px]">
            <div className="skeleton h-9 w-10" />
            <div className="skeleton mt-3 h-3 w-16" />
          </div>
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card mt-4 p-5">
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton mt-3 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-3/4" />
        </div>
      ))}
    </main>
  );
}
