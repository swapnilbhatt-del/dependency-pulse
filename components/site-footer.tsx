import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer border-t border-line mt-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 text-sm text-ink-3 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <p>Releases only: issues, pull requests, comments, commits and stars are never included.</p>
        <p className="flex gap-4">
          <Link href="/archive">Archive</Link>
          <Link href="/admin">Manage repositories</Link>
        </p>
      </div>
    </footer>
  );
}
