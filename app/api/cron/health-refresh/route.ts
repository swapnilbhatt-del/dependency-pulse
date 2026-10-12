import { revalidatePath } from "next/cache";
import { after, NextResponse, type NextRequest } from "next/server";
import { checkBearer } from "@/lib/auth/token";
import { env } from "@/lib/env";
import { healthDeps } from "@/lib/health/deps";
import { refreshAll } from "@/lib/health/refresh";
import { errorMessage, log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Hobby maximum; the run works to a 230 s budget and continues itself.

const MAX_HOPS = 8;

/**
 * Weekly health refresh (Monday 04:30 UTC, one hour after the digest).
 * Requires "Authorization: Bearer $CRON_SECRET". Resumable: if candidates
 * remain when the budget runs out, it re-invokes itself with ?continue=<runId>.
 */
export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization"), env("CRON_SECRET"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cont = req.nextUrl.searchParams.get("continue");
  const hop = Number(req.nextUrl.searchParams.get("hop") ?? 0);
  if (cont !== null && (!/^[0-9a-f-]{36}$/.test(cont) || !Number.isInteger(hop) || hop < 1 || hop > MAX_HOPS)) return NextResponse.json({ error: "Invalid continuation" }, { status: 400 });

  const result = await refreshAll(healthDeps(), cont ? { trigger: "continue", continueRunId: cont } : { trigger: "cron" });
  revalidatePath("/evaluate");
  revalidatePath("/evaluate/[slug]", "page");
  if (result.status === "continue") {
    if (hop + 1 > MAX_HOPS) log.error("health.max_hops", { run_id: result.runId });
    else {
      const url = new URL(req.nextUrl.pathname, req.nextUrl.origin);
      url.searchParams.set("continue", result.runId);
      url.searchParams.set("hop", String(hop + 1));
      after(async () => {
        try {
          await fetch(url, { headers: { authorization: `Bearer ${env("CRON_SECRET")}` }, signal: AbortSignal.timeout(280_000) });
        } catch (err) {
          log.error("health.continuation_failed", { run_id: result.runId, error: errorMessage(err) });
        }
      });
    }
  }
  return NextResponse.json({ runId: result.runId, status: result.status, isoWeek: result.isoWeek, remaining: result.remaining, results: result.progress.results }, { status: result.status === "failed" ? 500 : 200 });
}
