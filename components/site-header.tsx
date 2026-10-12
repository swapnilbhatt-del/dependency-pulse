"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  // Home and digest pages carry their own header inside the dark masthead.
  const path = usePathname();
  if (path === "/" || path.startsWith("/digest/")) return null;
  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 h-14">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink no-underline min-h-11" aria-label="Upstream Weekly home">
          <LogoMark />
          <span className="hidden sm:inline tracking-tight">Upstream Weekly</span>
        </Link>
        <div className="flex items-center gap-1">
          <nav aria-label="Primary" className="flex items-center">
            <Link href="/archive" className="btn btn-ghost btn-sm min-h-11">
              Archive
            </Link>
            <Link href="/evaluate" className="btn btn-ghost btn-sm min-h-11">
              Evaluate
            </Link>
            <Link href="/admin" className="btn btn-ghost btn-sm min-h-11">
              Admin
            </Link>
          </nav>
          <div className="site-actions">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
