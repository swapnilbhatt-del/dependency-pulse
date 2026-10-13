import { MastheadSkeleton } from "@/components/page-masthead";

export default function Loading() {
  return (
    <main id="main" className="min-h-[100dvh]" aria-busy="true" aria-live="polite">
      <MastheadSkeleton maxW="max-w-4xl" label="Loading the report…">
        <div className="flex justify-end">
          <div className="h-[132px] w-[132px] rounded-full border-[10px] border-[rgb(255_255_255/0.1)]" />
        </div>
      </MastheadSkeleton>
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="glance mt-8 p-6">
          <div className="skeleton h-3 w-40" />
          <div className="skeleton mt-4 h-4 w-full" />
          <div className="skeleton mt-2 h-4 w-5/6" />
          <div className="skeleton mt-2 h-4 w-2/3" />
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-4">
              <div className="skeleton h-5 w-40" />
              <div className="skeleton mt-3 h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
