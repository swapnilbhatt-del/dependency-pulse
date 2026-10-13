import { CardSkeletons, MastheadSkeleton } from "@/components/page-masthead";

export default function Loading() {
  return (
    <main id="main" className="min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <MastheadSkeleton label="Loading the watchlist…" />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8">
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-9 w-24 rounded-full" />
          ))}
        </div>
        <div className="mt-6">
          <CardSkeletons n={4} />
        </div>
      </div>
    </main>
  );
}
