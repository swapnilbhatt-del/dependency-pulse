"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/admin/actions";

const LINKS = [
  { href: "/admin", label: "Repositories" },
  { href: "/admin/evaluate", label: "Adoption Check" },
  { href: "/admin/runs", label: "Runs" },
  { href: "/admin/recipients", label: "Recipients" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line">
      <nav aria-label="Admin" className="-mb-px flex overflow-x-auto">
        {LINKS.map((l) => {
          const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold no-underline border-b-2 ${active ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <form action={logoutAction} className="pb-1">
        <button type="submit" className="btn btn-ghost btn-sm">
          Sign out
        </button>
      </form>
    </div>
  );
}
