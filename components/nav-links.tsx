"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/archive", label: "Archive", active: (p: string) => p.startsWith("/archive") || p.startsWith("/digest") },
  { href: "/evaluate", label: "Evaluate", active: (p: string) => p.startsWith("/evaluate") },
  { href: "/admin", label: "Admin", active: (p: string) => p.startsWith("/admin") },
] as const;

/** Primary navigation; marks the current section with aria-current. */
export function NavLinks({ compactEvaluate = false }: { compactEvaluate?: boolean }) {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Primary" className="flex items-center">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={l.active(path) ? "page" : undefined}
          className={`nav-link btn btn-ghost btn-sm min-h-11 ${compactEvaluate && l.href === "/evaluate" ? "hidden sm:inline-flex" : ""}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
