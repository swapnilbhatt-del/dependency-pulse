import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/login-form";
import { LogoMark } from "@/components/logo";
import { isAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin sign in", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return (
    <main id="main" className="mx-auto flex max-w-sm flex-col px-4 pt-16 sm:pt-24">
      <LogoMark size={36} />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in to manage Dependency Pulse</h1>
      <p className="mt-2 text-sm text-ink-2">Add or remove tracked repositories, manage recipients, and run the digest. The public digest and archive need no sign-in.</p>
      <LoginForm />
    </main>
  );
}
