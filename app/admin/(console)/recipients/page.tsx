import type { Metadata } from "next";
import { RecipientsManager } from "@/components/admin/recipients-manager";
import { listRecipients } from "@/lib/delivery/recipients";
import { defaultRecipients } from "@/lib/env";

export const metadata: Metadata = { title: "Recipients" };
export const dynamic = "force-dynamic";

export default async function RecipientsPage() {
  const rows = await listRecipients();
  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-[2.5rem] leading-tight">Recipients</h1>
      <p className="mt-1 mb-6 text-sm text-ink-2">Who gets the Monday email. Each person receives their own copy; addresses are never shown on public pages.</p>
      <RecipientsManager rows={rows.filter((r) => r.active).map((r) => ({ id: r.id, email: r.email, addedAt: r.addedAt.toISOString() }))} envDefaults={defaultRecipients()} />
    </div>
  );
}
