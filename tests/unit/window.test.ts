import { describe, expect, it } from "vitest";
import { capPerRepo, classifyAgainstHistory, filterReleases, releaseKey } from "@/lib/filter/filter";
import { computeWindow, isInWindow, isoWeek, mondayOf, scheduledRunTime } from "@/lib/filter/window";
import { release } from "../fixtures/factory";

const RUN = new Date("2026-10-12T03:30:00Z");

describe("computeWindow", () => {
  it("covers exactly the 7 days ending at run time", () => {
    const w = computeWindow(RUN);
    expect(w.start.toISOString()).toBe("2026-10-05T03:30:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-12T03:30:00.000Z");
  });

  it("is inclusive at window_start", () => {
    const w = computeWindow(RUN);
    expect(isInWindow(new Date("2026-10-05T03:30:00.000Z"), w)).toBe(true);
    expect(isInWindow(new Date("2026-10-05T03:29:59.999Z"), w)).toBe(false);
  });

  it("is inclusive at window_end and excludes the future", () => {
    const w = computeWindow(RUN);
    expect(isInWindow(new Date("2026-10-12T03:30:00.000Z"), w)).toBe(true);
    expect(isInWindow(new Date("2026-10-12T03:30:00.001Z"), w)).toBe(false);
  });

  it("is timezone-independent (offset timestamps resolve to the same instant)", () => {
    const w = computeWindow(RUN);
    expect(isInWindow(new Date("2026-10-05T09:00:00+05:30"), w)).toBe(true); // == 03:30Z
    expect(isInWindow(new Date("2026-10-05T08:59:59+05:30"), w)).toBe(false);
  });

  it("supports a configurable length", () => {
    expect(computeWindow(RUN, 14).start.toISOString()).toBe("2026-09-28T03:30:00.000Z");
  });
});

describe("scheduledRunTime", () => {
  it("snaps a late Hobby-plan invocation back to the scheduled slot", () => {
    expect(scheduledRunTime(new Date("2026-10-12T04:21:00Z")).toISOString()).toBe("2026-10-12T03:30:00.000Z");
  });
  it("returns the previous week's slot before Monday's slot", () => {
    expect(scheduledRunTime(new Date("2026-10-12T03:29:00Z")).toISOString()).toBe("2026-10-05T03:30:00.000Z");
  });
  it("handles mid-week times", () => {
    expect(scheduledRunTime(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-12T03:30:00.000Z");
  });
  it("consecutive windows tile without gaps or overlaps", () => {
    const a = computeWindow(scheduledRunTime(new Date("2026-10-05T04:50:00Z")));
    const b = computeWindow(scheduledRunTime(new Date("2026-10-12T03:31:00Z")));
    expect(a.end.getTime()).toBe(b.start.getTime());
  });
});

describe("isoWeek", () => {
  it.each([
    ["2026-10-12T03:30:00Z", "2026-W42"],
    ["2026-01-01T00:00:00Z", "2026-W01"],
    ["2027-01-01T00:00:00Z", "2026-W53"],
    ["2024-12-30T00:00:00Z", "2025-W01"],
  ])("%s → %s", (iso, week) => expect(isoWeek(new Date(iso))).toBe(week));

  it("mondayOf returns the Monday of the ISO week", () => {
    expect(mondayOf(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(mondayOf(new Date("2026-10-18T23:00:00Z")).toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});

describe("filterReleases", () => {
  const w = computeWindow(RUN);

  it("excludes drafts", () => {
    const r = filterReleases([release({ draft: true })], w);
    expect(r.included).toHaveLength(0);
    expect(r.excluded.draft).toBe(1);
  });

  it("keeps prereleases", () => {
    const r = filterReleases([release({ prerelease: true, tagName: "v2.0.0-rc.1" })], w);
    expect(r.included[0].prerelease).toBe(true);
  });

  it("drops releases outside the window, keeps the boundary", () => {
    const r = filterReleases(
      [
        release({ githubReleaseId: 1, tagName: "a", publishedAt: new Date("2026-10-05T03:30:00Z") }),
        release({ githubReleaseId: 2, tagName: "b", publishedAt: new Date("2026-10-05T03:29:59Z") }),
        release({ githubReleaseId: 3, tagName: "c", publishedAt: new Date("2026-10-13T00:00:00Z") }),
      ],
      w,
    );
    expect(r.included.map((x) => x.tagName)).toEqual(["a"]);
    expect(r.excluded.outOfWindow).toBe(2);
  });

  it("dedupes by GitHub release id and by repo+tag, newest first", () => {
    const r = filterReleases(
      [
        release({ githubReleaseId: 1, tagName: "v1", publishedAt: new Date("2026-10-06T00:00:00Z") }),
        release({ githubReleaseId: 1, tagName: "v1-dup", publishedAt: new Date("2026-10-06T00:00:00Z") }),
        release({ githubReleaseId: 2, tagName: "v1", publishedAt: new Date("2026-10-06T00:00:00Z") }),
        release({ githubReleaseId: 3, tagName: "v2", publishedAt: new Date("2026-10-09T00:00:00Z") }),
      ],
      w,
    );
    expect(r.included.map((x) => x.tagName)).toEqual(["v2", "v1"]);
    expect(r.excluded.duplicate).toBe(2);
  });

  it("keeps a release with an empty body (notes unavailable)", () => {
    const r = filterReleases([release({ body: "", notesAvailable: false })], w);
    expect(r.included[0].notesAvailable).toBe(false);
  });

  it("keeps tag-fallback entries and labels them as tags", () => {
    const r = filterReleases([release({ source: "tag", githubReleaseId: null, tagName: "v3.1.0" })], w);
    expect(r.included[0].source).toBe("tag");
  });
});

describe("capPerRepo", () => {
  it("shows the latest 3 and returns the rest as earlier", () => {
    const items = [1, 2, 3, 4, 5].map((d) => ({ publishedAt: new Date(`2026-10-0${d + 4}T00:00:00Z`), id: d }));
    const { shown, earlier } = capPerRepo(items, 3);
    expect(shown.map((i) => i.id)).toEqual([5, 4, 3]);
    expect(earlier.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe("classifyAgainstHistory (change-aware)", () => {
  it("new, already reported, and updated", () => {
    const r = release();
    expect(classifyAgainstHistory(r, new Map())).toBe("new");
    expect(classifyAgainstHistory(r, new Map([[releaseKey(r), r.bodyHash]]))).toBe("already_reported");
    expect(classifyAgainstHistory(r, new Map([[releaseKey(r), "different"]]))).toBe("updated");
  });
});
