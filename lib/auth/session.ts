import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db/client";
import { createSessionToken, safeEqual, SESSION_COOKIE, verifySessionToken } from "@/lib/auth/token";
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SECONDS, SESSION_TTL_SECONDS } from "@/lib/config";
import { env } from "@/lib/env";

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value, env("SESSION_SECRET"));
}

/** Server-side guard for admin pages and actions. Never trust the proxy alone. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function startSession(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(env("SESSION_SECRET") ?? "", SESSION_TTL_SECONDS), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

async function clientKey(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(`login:${ip}`).digest("hex").slice(0, 32);
}

export type LoginResult = { ok: true } | { ok: false; error: string; retryAfterSeconds?: number };

/** Rate-limited, constant-time password check. Counts are stored in Postgres so they hold across serverless instances. */
export async function attemptLogin(password: string): Promise<LoginResult> {
  const expected = env("ADMIN_PASSWORD");
  if (!expected || !env("SESSION_SECRET")) return { ok: false, error: "Admin login is not configured on the server (ADMIN_PASSWORD / SESSION_SECRET)." };
  const key = await clientKey();
  const db = getDb();
  const [row] = await db
    .insert(schema.loginAttempts)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: schema.loginAttempts.key,
      set: {
        count: sql`case when ${schema.loginAttempts.windowStart} < now() - make_interval(secs => ${LOGIN_WINDOW_SECONDS}) then 1 else ${schema.loginAttempts.count} + 1 end`,
        windowStart: sql`case when ${schema.loginAttempts.windowStart} < now() - make_interval(secs => ${LOGIN_WINDOW_SECONDS}) then now() else ${schema.loginAttempts.windowStart} end`,
      },
    })
    .returning();
  if (row.count > LOGIN_MAX_ATTEMPTS) {
    const retry = Math.max(1, Math.ceil((row.windowStart.getTime() + LOGIN_WINDOW_SECONDS * 1000 - Date.now()) / 1000));
    return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute${retry > 60 ? "s" : ""}.`, retryAfterSeconds: retry };
  }
  if (!safeEqual(password, expected)) {
    const left = LOGIN_MAX_ATTEMPTS - row.count;
    return { ok: false, error: left > 0 ? `That password is not correct. ${left} attempt${left === 1 ? "" : "s"} left.` : "That password is not correct. Login is now paused for 15 minutes." };
  }
  await db.delete(schema.loginAttempts).where(eq(schema.loginAttempts.key, key));
  await startSession();
  return { ok: true };
}
