import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Pure functions (no Next.js imports) so they are usable in proxy.ts and tests.
 */
export const SESSION_COOKIE = "dp_admin";

interface Payload {
  sub: "admin";
  iat: number;
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSessionToken(secret: string, ttlSeconds: number, nowMs = Date.now()): string {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  const payload: Payload = { sub: "admin", iat: Math.floor(nowMs / 1000), exp: Math.floor(nowMs / 1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string | undefined, nowMs = Date.now()): boolean {
  if (!token || !secret || secret.length < 32) return false;
  const [data, mac] = token.split(".");
  if (!data || !mac) return false;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Payload;
    return p.sub === "admin" && typeof p.exp === "number" && p.exp * 1000 > nowMs;
  } catch {
    return false;
  }
}

/** Constant-time comparison independent of input length (both sides hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function checkBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  return safeEqual(header, `Bearer ${secret}`);
}
