import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { HeaderThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 h-14">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink no-underline min-h-11" aria-label="Dependency Pulse home">
          <LogoMark />
          <span className="tracking-tight">Dependency Pulse</span>
        </Link>
        <div className="flex items-center gap-1">
          <nav aria-label="Primary" className="flex items-center">
            <Link href="/archive" className="btn btn-ghost btn-sm min-h-11">
              Archive
            </Link>
            <Link href="/admin" className="btn btn-ghost btn-sm min-h-11">
              Admin
            </Link>
          </nav>
          <div className="site-actions">
            <HeaderThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
