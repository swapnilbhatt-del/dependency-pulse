import { describe, expect, it } from "vitest";
import { checkBearer, createSessionToken, safeEqual, verifySessionToken } from "@/lib/auth/token";

const SECRET = "x".repeat(43);

describe("session token", () => {
  it("round-trips and expires", () => {
    const t = createSessionToken(SECRET, 60, 1_000_000);
    expect(verifySessionToken(t, SECRET, 1_000_000 + 59_000)).toBe(true);
    expect(verifySessionToken(t, SECRET, 1_000_000 + 61_000)).toBe(false);
  });
  it("rejects tampering and wrong secrets", () => {
    const t = createSessionToken(SECRET, 60);
    const [data, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", iat: 0, exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${mac}`, SECRET)).toBe(false);
    expect(verifySessionToken(`${data}.${mac}x`, SECRET)).toBe(false);
    expect(verifySessionToken(t, "y".repeat(43))).toBe(false);
    expect(verifySessionToken(undefined, SECRET)).toBe(false);
  });
  it("refuses short secrets", () => {
    expect(() => createSessionToken("short", 60)).toThrow();
  });
});

describe("constant-time helpers", () => {
  it("safeEqual", () => {
    expect(safeEqual("correct horse battery", "correct horse battery")).toBe(true);
    expect(safeEqual("correct horse battery", "correct horse batterY")).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
  it("cron bearer check", () => {
    expect(checkBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(checkBearer(`Bearer wrong`, SECRET)).toBe(false);
    expect(checkBearer(null, SECRET)).toBe(false);
    expect(checkBearer(`Bearer `, undefined)).toBe(false);
  });
});
