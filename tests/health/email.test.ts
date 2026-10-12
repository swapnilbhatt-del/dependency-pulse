import { describe, expect, it } from "vitest";
import { pickEmailItems } from "@/lib/health/email";
import type { Verdict } from "@/lib/health/types";

const cand = (id: number, fullName: string) => ({ id, fullName, slug: fullName.replace("/", "--") });
const snap = (verdict: Verdict, overallScore: number | null, reason = `${verdict} reason`) => ({ verdict, overallScore, reasonsJson: [{ tag: "concern", text: reason }] });

describe("email watchlist selection", () => {
  const candidates = [cand(1, "z/healthy"), cand(2, "b/watch"), cand(3, "a/watch"), cand(4, "c/risky"), cand(5, "d/insufficient"), cand(6, "e/unchecked")];
  const snaps = new Map([
    [1, snap("healthy", 90)],
    [2, snap("watch", 70)],
    [3, snap("watch", 60)],
    [4, snap("risky", 40, "No release in a year.")],
    [5, snap("insufficient", null)],
  ]);
  const items = pickEmailItems(candidates, snaps, "https://example.test");

  it("keeps only Risky and Watch, Risky first, then by name", () => {
    expect(items.map((i) => i.name)).toEqual(["c/risky", "a/watch", "b/watch"]);
  });
  it("carries the verdict label, score, top reason and report link", () => {
    expect(items[0]).toEqual({ name: "c/risky", verdict: "Risky", score: 40, reason: "No release in a year.", url: "https://example.test/evaluate/c--risky" });
  });
  it("returns nothing when every candidate is Healthy", () => {
    expect(pickEmailItems([cand(1, "z/healthy")], new Map([[1, snap("healthy", 90)]]), "https://example.test")).toEqual([]);
  });
});
