"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto max-w-[46rem] px-4 sm:px-6 pt-16" role="alert">
      <p className="eyebrow">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-semibold">This page could not be loaded</h1>
      <p className="mt-2 text-ink-2 measure">
        The server hit an error while loading the data. Try again; if it keeps happening, check the health endpoint at /api/health.
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </p>
      <button type="button" className="btn btn-primary mt-6" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
