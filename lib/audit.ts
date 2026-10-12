import "server-only";
import { getDb, schema } from "@/db/client";
import { errorMessage, log } from "@/lib/log";

/** Admin audit log: every repo add/edit/delete, recipient change, and manual send. */
export async function audit(action: string, target: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await getDb().insert(schema.adminAuditLog).values({ action, target, detailJson: detail });
  } catch (err) {
    log.error("audit.write_failed", { action, target, error: errorMessage(err) });
  }
}
