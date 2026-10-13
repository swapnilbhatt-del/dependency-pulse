import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/admin-nav";
import { ToastProvider } from "@/components/toast";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <ToastProvider>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6" data-area="admin">
        <AdminNav />
        <main id="main" className="pt-6">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
