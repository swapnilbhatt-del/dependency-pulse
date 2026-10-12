export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="skeleton h-8 w-64" />
      <div className="skeleton mt-2 h-4 w-96 max-w-full" />
      <div className="card mt-6 p-5">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton mt-4 h-11 w-full" />
      </div>
      <div className="card mt-6 divide-y divide-line">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <div className="skeleton h-4 w-56" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
            <div className="skeleton ml-auto h-6 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
