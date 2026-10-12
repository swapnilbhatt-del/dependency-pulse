import { DIGEST_SCHEDULE, WINDOW_DAYS } from "@/lib/config";
import type { TimeWindow } from "@/lib/types";

const DAY_MS = 86_400_000;

/**
 * The lookback window: start = runTime - days (inclusive), end = runTime (inclusive).
 * Pure UTC arithmetic on epoch milliseconds, so it is timezone-independent.
 */
export function computeWindow(runTime: Date, days: number = WINDOW_DAYS): TimeWindow {
  return { start: new Date(runTime.getTime() - days * DAY_MS), end: new Date(runTime.getTime()) };
}

export function isInWindow(at: Date, window: TimeWindow): boolean {
  const t = at.getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}

/**
 * The most recent scheduled slot at or before `now` (UTC). Cron invocations use
 * this as the run time so consecutive weekly windows tile exactly even when the
 * platform fires the job late (Vercel Hobby fires anywhere within the hour).
 */
export function scheduledRunTime(now: Date, schedule = DIGEST_SCHEDULE): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), schedule.hour, schedule.minute));
  const deltaDays = (d.getUTCDay() - schedule.weekday + 7) % 7;
  let slot = d.getTime() - deltaDays * DAY_MS;
  if (slot > now.getTime()) slot -= 7 * DAY_MS;
  return new Date(slot);
}

/** ISO-8601 week label (e.g. "2026-W42") of a UTC instant. */
export function isoWeek(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Monday (UTC date) of the ISO week containing `at`. */
export function mondayOf(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dayNum - 1));
  return d;
}

export const ISO_WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
