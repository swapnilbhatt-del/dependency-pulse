import { describe, expect, it } from "vitest";
import { licenseStatus } from "@/lib/health/collect";
import { normalizeSpdx } from "@/lib/health/osi-licenses";

describe("OSI license check", () => {
  it("accepts GitHub's deprecated GNU identifiers", () => {
    for (const id of ["GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0"]) expect(licenseStatus(id), id).toBe("osi");
  });
  it("maps the '+' form to -or-later", () => {
    expect(normalizeSpdx("LGPL-2.1+")).toBe("LGPL-2.1-or-later");
    expect(licenseStatus("GPL-2.0+")).toBe("osi");
  });
  it("leaves current identifiers alone and still rejects non-OSI licenses", () => {
    expect(normalizeSpdx("MIT")).toBe("MIT");
    expect(licenseStatus("BUSL-1.1")).toBe("non_osi");
    expect(licenseStatus("NOASSERTION")).toBe("unknown");
    expect(licenseStatus(null)).toBe("none");
  });
});
