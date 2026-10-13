import { MastheadSkeleton } from "@/components/page-masthead";

export default function Loading() {
  return (
    <main id="main" className="min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <MastheadSkeleton maxW="max-w-6xl" label="Loading the comparison…" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8">
        <div className="card overflow-hidden">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid grid-cols-[9rem_1fr_1fr] gap-4 border-t border-line p-4 first:border-t-0">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
