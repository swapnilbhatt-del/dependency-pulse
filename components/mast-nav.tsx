import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

/** Header row used inside dark mastheads (home, digest, Adoption Check). */
export function MastNav({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-14 items-center justify-between gap-2 border-b border-[var(--mast-line)]">
      <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold no-underline" aria-label="Upstream Weekly home">
        <LogoMark />
        <span className="hidden sm:inline tracking-tight">Upstream Weekly</span>
      </Link>
      <div className="flex items-center no-print">
        <NavLinks compactEvaluate />
        <ThemeToggle />
        {children}
      </div>
    </div>
  );
}
