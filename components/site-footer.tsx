import Link from "next/link";
import { LogoMark } from "@/components/logo";

const METHOD = "https://github.com/swapnilbhatt-del/upstream-weekly/blob/main/docs/HEALTH_METHOD.md";
const REPO = "https://github.com/swapnilbhatt-del/upstream-weekly";

export function SiteFooter() {
  return (
    <footer className="site-footer border-t border-line mt-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 py-10 text-sm sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2 font-semibold text-ink">
            <LogoMark /> Upstream Weekly
          </p>
          <p className="mt-3 max-w-sm text-ink-3">The releases that matter, every Monday, and a health check before you adopt a new library. Releases only: issues, pull requests, comments, commits and stars are never included.</p>
        </div>
        <nav aria-label="Footer: product">
          <p className="eyebrow">Product</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link href="/">Latest digest</Link>
            </li>
            <li>
              <Link href="/archive">Archive</Link>
            </li>
            <li>
              <Link href="/evaluate">Adoption Check</Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Footer: more">
          <p className="eyebrow">More</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link href={METHOD}>How verdicts are calculated</Link>
            </li>
            <li>
              <Link href={REPO}>Source on GitHub</Link>
            </li>
            <li>
              <Link href="/admin">Admin</Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
