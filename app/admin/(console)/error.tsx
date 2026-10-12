"use client";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const dbMissing = /DATABASE_URL/.test(error.message);
  return (
    <div className="card p-6" role="alert">
      <h1 className="text-xl font-semibold">This admin page could not load</h1>
      <p className="mt-2 text-ink-2 measure">
        {dbMissing ? "The database is not configured. Set DATABASE_URL, run pnpm db:migrate, then reload." : "The server hit an error while loading data. Check /api/health, then try again."}
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </p>
      <button type="button" className="btn btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
