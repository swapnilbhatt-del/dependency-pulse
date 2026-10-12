/**
 * Non-regression guard for the live Monday digest. Fixed inputs → the exact
 * model, email HTML and plain text are compared with files committed before
 * the Adoption Check work began. Any change to digest output fails here.
 * To accept an intentional change: pnpm vitest run -u tests/unit/digest-golden.test.ts
 */
import { describe, expect, it } from "vitest";
import { buildDigest } from "@/lib/digest/build";
import type { RepoOutcome } from "@/lib/digest/model";
import { renderEmailHtml } from "@/lib/digest/render-email";
import { renderEmailText } from "@/lib/digest/render-text";
import { analysis, classified, release, repo } from "../fixtures/factory";

function goldenModel() {
  const stripe = repo({ id: 1, fullName: "stripe/stripe-node", category: "payments", priority: "critical" });
  const jose = repo({ id: 2, fullName: "panva/jose", category: "auth" });
  const prisma = repo({ id: 3, fullName: "prisma/orm", category: "data" });
  const quiet = repo({ id: 4, fullName: "expressjs/express", category: "platform" });
  const gone = repo({ id: 5, fullName: "gone/repo", category: "tooling" });
  const releases = [
    classified(release({ repoId: 2, repoFullName: "panva/jose", tagName: "v6.2.13", githubReleaseId: 11, publishedAt: new Date("2026-10-09T10:00:00Z"), body: "Fixes CVE-2026-1234 in JWE decryption." }), analysis({ one_line_summary: "Fixes a JWE decryption vulnerability.", affected_area: "authentication" }), jose),
    ...[15, 16, 17].map((n) =>
      classified(
        release({ repoId: 3, repoFullName: "prisma/orm", tagName: `v8.0.0-rc.${n}`, githubReleaseId: 100 + n, prerelease: true, publishedAt: new Date(`2026-10-0${n - 9}T00:00:00Z`), body: `Removed legacy option ${n}.` }),
        analysis({ is_breaking_change: true, breaking_evidence: `Removed legacy option ${n}`, one_line_summary: `Release candidate ${n}.` }),
        prisma,
      ),
    ),
    classified(release({ repoId: 1, repoFullName: "stripe/stripe-node", tagName: "v19.2.0", githubReleaseId: 21, publishedAt: new Date("2026-10-07T00:00:00Z"), body: "Adds new webhook event types." }), analysis({ one_line_summary: "Adds new webhook event types." }), stripe),
  ];
  const outcomes: RepoOutcome[] = [
    { repo: stripe, status: "ok", error: null, releaseCount: 1, usedTagFallback: false },
    { repo: jose, status: "ok", error: null, releaseCount: 1, usedTagFallback: false },
    { repo: prisma, status: "ok", error: null, releaseCount: 3, usedTagFallback: false },
    { repo: quiet, status: "ok", error: null, releaseCount: 0, usedTagFallback: false },
    { repo: gone, status: "not_found", error: null, releaseCount: 0, usedTagFallback: false },
  ];
  return buildDigest({
    isoWeek: "2026-W42",
    weekOf: new Date("2026-10-12T00:00:00Z"),
    window: { start: new Date("2026-10-05T03:30:00Z"), end: new Date("2026-10-12T03:30:00Z") },
    generatedAt: new Date("2026-10-12T03:31:00Z"),
    timezoneLabel: "Asia/Kolkata",
    baseUrl: "https://dependency-pulse.vercel.app",
    releases,
    repoOutcomes: outcomes,
    advisoryOnly: [],
    aiFallbacks: 0,
  });
}

describe("live digest golden output (non-regression)", () => {
  const model = goldenModel();
  it("digest model is unchanged", async () => {
    await expect(JSON.stringify(model, null, 2)).toMatchFileSnapshot("./__golden__/digest-model.json");
  });
  it("email HTML is unchanged", async () => {
    await expect(renderEmailHtml(model)).toMatchFileSnapshot("./__golden__/digest-email.html");
  });
  it("email plain text is unchanged", async () => {
    await expect(renderEmailText(model)).toMatchFileSnapshot("./__golden__/digest-email.txt");
  });
});
