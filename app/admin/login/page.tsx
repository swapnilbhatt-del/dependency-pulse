import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { IconCheck, PulseLine } from "@/components/icons";
import { LogoMark } from "@/components/logo";
import { isAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main id="main" className="mx-auto grid max-w-6xl gap-0 px-4 sm:px-6 py-10 lg:grid-cols-2 lg:py-16">
      <section aria-label="About the admin area" className="masthead hidden rounded-l-3xl p-10 lg:block">
        <PulseLine className="pulse-line" />
        <div className="relative">
          <span className="text-mast-ink">
            <LogoMark size={36} />
          </span>
          <p className="mt-8 font-display text-5xl leading-[1.02] text-mast-ink">Curate what Keerthi reads on Monday.</p>
          <ul className="mt-8 space-y-3 text-mast-ink-2">
            {["Add, pause or annotate repositories. No code, no redeploy.", "Preview the digest from live data before it goes out.", "See every run, every repo’s status, and every send."].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 text-[var(--mast-ok)]">
                  <IconCheck />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card flex flex-col justify-center p-6 sm:p-10 lg:rounded-l-none lg:rounded-r-3xl">
        <span className="lg:hidden">
          <LogoMark size={36} />
        </span>
        <h1 className="mt-4 lg:mt-0 font-display text-[2.4rem] leading-tight">Sign in to manage Dependency Pulse</h1>
        <p className="mt-2 text-sm text-ink-2">The public digest and archive need no sign-in.</p>
        <LoginForm />
      </section>
    </main>
  );
}
