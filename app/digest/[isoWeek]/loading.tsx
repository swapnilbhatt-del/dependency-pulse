/** Mirrors the digest layout (dark masthead, stat tiles, section nav, cards) so nothing jumps when data arrives. */
export default function Loading() {
  const bar = "rounded-md bg-[rgb(255_255_255/0.09)] animate-pulse motion-reduce:animate-none";
  return (
    <main id="main" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading digest…</span>
      <header className="masthead">
        <div className="relative mx-auto max-w-[60rem] px-4 sm:px-6 pb-16">
          <div className="flex h-14 items-center justify-between border-b border-[var(--mast-line)]">
            <div className={`${bar} h-6 w-36`} />
            <div className={`${bar} h-6 w-44`} />
          </div>
          <div className={`${bar} mt-8 h-3 w-72 max-w-full`} />
          <div className={`${bar} mt-5 h-4 w-40`} />
          <div className={`${bar} mt-3 h-12 sm:h-16 w-4/5`} />
          <div className={`${bar} mt-4 h-5 w-64 max-w-full`} />
          <div className="mt-7 grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="stat-tile">
                <div className={`${bar} h-12 w-12`} />
                <div className={`${bar} mt-3 h-3 w-20`} />
                <div className={`${bar} mt-4 h-1 w-full`} />
              </div>
            ))}
          </div>
          <div className={`${bar} mt-4 h-3 w-80 max-w-full`} />
        </div>
      </header>
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[60rem] gap-2 px-4 sm:px-6 py-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-7 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-[50rem] px-4 sm:px-6">
        <div className="glance mt-8 p-6">
          <div className="skeleton h-3 w-40" />
          <div className="skeleton mt-4 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-5/6" />
          <div className="skeleton mt-2 h-4 w-2/3" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="card mt-6 overflow-hidden">
            <div className="card-head-neutral h-11" />
            <div className="p-5">
              <div className="flex gap-3">
                <div className="skeleton h-8 w-8 rounded-lg" />
                <div className="skeleton h-5 w-56" />
              </div>
              <div className="skeleton mt-4 h-4 w-full" />
              <div className="skeleton mt-2 h-16 w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
