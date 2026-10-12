import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { audit } from "@/lib/audit";
import { defaultRecipients } from "@/lib/env";
import { emailSchema } from "@/lib/repos/normalize";

export type RecipientRow = typeof schema.recipients.$inferSelect;

export async function listRecipients(): Promise<RecipientRow[]> {
  return getDb().select().from(schema.recipients).orderBy(asc(schema.recipients.addedAt));
}

/** Active recipients from the database; DIGEST_RECIPIENTS is the default when the table has none. */
export async function effectiveRecipients(): Promise<{ emails: string[]; source: "database" | "env_default" }> {
  const rows = await listRecipients();
  const active = rows.filter((r) => r.active).map((r) => r.email);
  if (active.length) return { emails: active, source: "database" };
  return { emails: defaultRecipients(), source: "env_default" };
}

export async function addRecipient(raw: string): Promise<{ ok: true; row: RecipientRow } | { ok: false; error: string }> {
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  const email = parsed.data;
  const [row] = await getDb()
    .insert(schema.recipients)
    .values({ email })
    .onConflictDoUpdate({ target: schema.recipients.email, set: { active: true } })
    .returning();
  await audit("recipient.add", "recipient", { domain: email.split("@")[1] });
  return { ok: true, row };
}

export async function removeRecipient(id: number): Promise<{ ok: boolean }> {
  const [row] = await getDb().delete(schema.recipients).where(eq(schema.recipients.id, id)).returning();
  if (row) await audit("recipient.remove", "recipient", { domain: row.email.split("@")[1] });
  return { ok: Boolean(row) };
}
