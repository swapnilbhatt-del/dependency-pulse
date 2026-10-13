import { MastheadSkeleton } from "@/components/page-masthead";

export default function Loading() {
  return (
    <main id="main" className="min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <MastheadSkeleton maxW="max-w-4xl" label="Loading the archive…" />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-8 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card p-5">
            <div className="skeleton h-6 w-56" />
            <div className="skeleton mt-3 h-3 w-72 max-w-full" />
            <div className="skeleton mt-4 h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </main>
  );
}
