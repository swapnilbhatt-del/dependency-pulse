"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

/** Pages that open on a dark masthead carry their own header row (MastNav). */
function hasMasthead(path: string): boolean {
  // Vercel's background (ISR) re-render of "/" reports the path as "/index".
  if (path === "/" || path === "/index") return true;
  if (path.startsWith("/digest/") || path === "/archive") return true;
  return path === "/evaluate" || path.startsWith("/evaluate/");
}

export function SiteHeader() {
  const path = usePathname() ?? "";
  // globals.css also hides this header on any page with a .masthead, as a backstop.
  if (hasMasthead(path)) return null;
  return (
    <header className="site-header border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 sm:px-6 h-14">
        <Link href="/" className="flex items-center gap-2 font-semibold text-ink no-underline min-h-11" aria-label="Upstream Weekly home">
          <LogoMark />
          <span className="hidden sm:inline tracking-tight">Upstream Weekly</span>
        </Link>
        <div className="flex items-center gap-1">
          <NavLinks />
          <div className="site-actions">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
