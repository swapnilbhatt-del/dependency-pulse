import { describe, expect, it } from "vitest";
import { emailSchema, parseBulkInput, parseRepoInput } from "@/lib/repos/normalize";

describe("parseRepoInput", () => {
  it.each([
    ["stripe/stripe-node", "stripe/stripe-node"],
    ["  panva/jose  ", "panva/jose"],
    ["https://github.com/vercel/next.js", "vercel/next.js"],
    ["https://github.com/vercel/next.js/", "vercel/next.js"],
    ["https://github.com/prisma/prisma.git", "prisma/prisma"],
    ["github.com/expressjs/express", "expressjs/express"],
    ["http://www.github.com/nodejs/node/releases/tag/v24.0.0", "nodejs/node"],
    ["git@github.com:auth0/node-jsonwebtoken.git", "auth0/node-jsonwebtoken"],
    ["drizzle-team/drizzle-orm.git", "drizzle-team/drizzle-orm"],
  ])("%s → %s", (input, expected) => {
    const r = parseRepoInput(input);
    expect(r.ok && r.fullName).toBe(expected);
  });

  it.each([
    [""],
    ["stripe"],
    ["https://gitlab.com/a/b"],
    ["-bad/repo"],
    ["owner/re po"],
    ["owner/.."],
    ["a".repeat(301)],
    ["https://github.com/onlyowner"],
  ])("rejects %j", (input) => {
    expect(parseRepoInput(input).ok).toBe(false);
  });
});

describe("parseBulkInput", () => {
  it("validates each line and skips comments and blanks", () => {
    const out = parseBulkInput("stripe/stripe-node\n\n# comment\nnot valid\nhttps://github.com/panva/jose\n");
    expect(out.map((l) => [l.line, l.result.ok])).toEqual([
      [1, true],
      [4, false],
      [5, true],
    ]);
  });
});

describe("emailSchema", () => {
  it("normalizes and validates", () => {
    expect(emailSchema.parse("  Keerthi@Example.com ")).toBe("keerthi@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});
