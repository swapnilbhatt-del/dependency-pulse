import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Header row used inside dark mastheads (home, digest). */
export function MastNav({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-14 items-center justify-between gap-2 border-b border-[var(--mast-line)]">
      <Link href="/" className="flex min-h-11 items-center gap-2 font-semibold no-underline" aria-label="Dependency Pulse home">
        <LogoMark />
        <span className="hidden sm:inline tracking-tight">Dependency Pulse</span>
      </Link>
      <div className="flex items-center no-print">
        <nav aria-label="Primary" className="flex items-center">
          <Link href="/archive" className="btn btn-ghost btn-sm min-h-11">
            Archive
          </Link>
          <Link href="/admin" className="btn btn-ghost btn-sm min-h-11">
            Admin
          </Link>
        </nav>
        <ThemeToggle />
        {children}
      </div>
    </div>
  );
}
