import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-[46rem] px-4 sm:px-6 pt-16">
      <p className="eyebrow">404</p>
      <h1 className="mt-2 text-2xl font-semibold">That page does not exist</h1>
      <p className="mt-2 text-ink-2 measure">If you followed a link to a weekly digest, that week may not have been generated yet.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/archive" className="btn btn-primary">
          Browse the archive
        </Link>
        <Link href="/" className="btn btn-secondary">
          Go to the latest digest
        </Link>
      </div>
    </main>
  );
}
