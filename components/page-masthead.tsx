import { MastNav } from "@/components/mast-nav";

const I = (i: number) => ({ ["--i" as string]: i });

/**
 * Dark masthead for secondary public pages (archive, compare, 404): nav row,
 * eyebrow, headline, lede, and an optional panel on the right. Animates in
 * from first paint with the shared .enter / .enter-soft classes.
 */
export function PageMasthead({
  eyebrow,
  title,
  lede,
  breadcrumb,
  actions,
  aside,
  maxW = "max-w-5xl",
  glow = "rgb(94 234 212 / 0.16)",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  maxW?: string;
  glow?: string;
}) {
  return (
    <header className="masthead" style={{ ["--mast-glow" as string]: glow }}>
      <div className={`relative mx-auto ${maxW} px-4 sm:px-6 pb-10 sm:pb-14`}>
        <MastNav />
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="mt-6 text-sm text-mast-ink-2 enter" style={I(0)}>
            {breadcrumb}
          </nav>
        )}
        <div className={`${breadcrumb ? "mt-5" : "mt-8 sm:mt-12"} grid items-end gap-8 ${aside ? "lg:grid-cols-[1.05fr_1fr]" : ""}`}>
          <div className="min-w-0">
            <p className="eyebrow !text-[var(--mast-ok)] enter" style={I(0)}>
              {eyebrow}
            </p>
            <h1 className="mt-3 font-display text-[2.7rem] sm:text-[3.9rem] leading-[0.98] text-mast-ink enter-soft" style={I(1)}>
              {title}
            </h1>
            {lede && (
              <p className="mt-4 max-w-xl text-mast-ink-2 enter-soft" style={I(2)}>
                {lede}
              </p>
            )}
            {actions && (
              <div className="mt-6 flex flex-wrap gap-3 enter" style={I(3)}>
                {actions}
              </div>
            )}
          </div>
          {aside && (
            <div className="min-w-0 enter" style={I(3)}>
              {aside}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Loading state that keeps the real nav row and the masthead's shape, so nothing jumps. */
export function MastheadSkeleton({ maxW = "max-w-5xl", label, children }: { maxW?: string; label: string; children?: React.ReactNode }) {
  const bar = "rounded-md bg-[rgb(255_255_255/0.09)] animate-pulse motion-reduce:animate-none";
  return (
    <header className="masthead">
      <span className="sr-only">{label}</span>
      <div className={`relative mx-auto ${maxW} px-4 sm:px-6 pb-10 sm:pb-14`}>
        <MastNav />
        <div className="mt-8 sm:mt-12 grid items-end gap-8 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <div className={`${bar} h-3 w-32`} />
            <div className={`${bar} mt-4 h-12 w-4/5 max-w-md`} />
            <div className={`${bar} mt-4 h-4 w-full max-w-lg`} />
            <div className={`${bar} mt-2 h-4 w-2/3 max-w-sm`} />
          </div>
          {children ?? (
            <div className="grid grid-cols-3 gap-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="stat-tile !min-h-0">
                  <div className={`${bar} h-9 w-10`} />
                  <div className={`${bar} mt-3 h-3 w-16`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Light card placeholders for the content below a masthead. */
export function CardSkeletons({ n = 4, cols = "md:grid-cols-2" }: { n?: number; cols?: string }) {
  return (
    <div className={`grid gap-4 ${cols}`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card p-5">
          <div className="flex justify-between gap-4">
            <div className="skeleton h-5 w-48" />
            <div className="skeleton h-14 w-14 rounded-full" />
          </div>
          <div className="skeleton mt-4 h-6 w-40 rounded-full" />
          <div className="skeleton mt-4 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-5/6" />
        </div>
      ))}
    </div>
  );
}
