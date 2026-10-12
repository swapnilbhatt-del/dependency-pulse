export default function Loading() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 sm:px-6 pt-8 min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the report…</span>
      <div className="skeleton h-4 w-48" />
      <div className="card mt-4 flex justify-between gap-6 p-6">
        <div className="flex-1">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton mt-3 h-10 w-72 max-w-full" />
          <div className="skeleton mt-4 h-7 w-44 rounded-full" />
        </div>
        <div className="skeleton h-14 w-28" />
      </div>
      <div className="glance mt-8 p-6">
        <div className="skeleton h-3 w-40" />
        <div className="skeleton mt-4 h-4 w-full" />
        <div className="skeleton mt-2 h-4 w-5/6" />
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton mt-3 h-4 w-24" />
          </div>
        ))}
      </div>
    </main>
  );
}
