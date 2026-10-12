import { after, NextResponse, type NextRequest } from "next/server";
import { checkBearer } from "@/lib/auth/token";
import { env } from "@/lib/env";
import { ISO_WEEK_PATTERN } from "@/lib/filter/window";
import { errorMessage, log } from "@/lib/log";
import { productionDeps } from "@/lib/pipeline/deps";
import { runWeeklyDigest, type RunResult } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Must be a literal. Vercel Hobby maximum; see README → Scheduling.

const MAX_HOPS = 6;

/**
 * Scheduler Endpoint. Vercel Cron calls GET with "Authorization: Bearer $CRON_SECRET".
 * If classification work remains when the invocation budget runs out, the
 * route schedules a follow-up invocation of itself (?continue=<isoWeek>&hop=n),
 * which resumes from the database cache.
 */
export async function GET(req: NextRequest) {
  if (!checkBearer(req.headers.get("authorization"), env("CRON_SECRET"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cont = req.nextUrl.searchParams.get("continue");
  const hop = Number(req.nextUrl.searchParams.get("hop") ?? 0);
  if (cont !== null && (!ISO_WEEK_PATTERN.test(cont) || !Number.isInteger(hop) || hop < 1 || hop > MAX_HOPS)) {
    return NextResponse.json({ error: "Invalid continuation" }, { status: 400 });
  }

  const scheduleNext = (result: RunResult) => {
    if (result.status !== "continue") return;
    if (hop + 1 > MAX_HOPS) {
      log.error("cron.max_hops", { iso_week: result.isoWeek });
      return;
    }
    const url = new URL(req.nextUrl.pathname, req.nextUrl.origin);
    url.searchParams.set("continue", result.isoWeek);
    url.searchParams.set("hop", String(hop + 1));
    after(async () => {
      try {
        const res = await fetch(url, { headers: { authorization: `Bearer ${env("CRON_SECRET")}` }, signal: AbortSignal.timeout(15_000) });
        log.info("cron.continuation_scheduled", { iso_week: result.isoWeek, hop: hop + 1, status: res.status });
      } catch (err) {
        log.error("cron.continuation_failed", { iso_week: result.isoWeek, error: errorMessage(err) });
      }
    });
  };

  if (cont !== null) {
    // Acknowledge immediately; do the work after the response so the caller's fetch returns fast.
    after(async () => {
      const result = await runWeeklyDigest(productionDeps(), { trigger: "continue", isoWeek: cont });
      scheduleNext(result);
    });
    return NextResponse.json({ accepted: true, continue: cont, hop }, { status: 202 });
  }

  const result = await runWeeklyDigest(productionDeps(), { trigger: "cron" });
  scheduleNext(result);
  const { status } = result;
  const body = "model" in result ? { ...result, model: undefined } : result;
  return NextResponse.json(body, { status: status === "failed" ? 500 : 200 });
}
