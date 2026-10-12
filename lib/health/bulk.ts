/** Bulk import line format: owner/name or URL, optional "npm:pkg" or "pypi:pkg", optional "| intended use". */
export function parseCandidateLine(raw: string): { repo: string; ecosystem: "npm" | "pypi" | null; packageName: string | null; intendedUse: string } {
  const [left, ...use] = raw.split("|");
  const parts = left.trim().split(/\s+/);
  const pkg = parts.slice(1).find((p) => /^(npm|pypi):/i.test(p));
  const [eco, name] = pkg ? [pkg.split(":")[0].toLowerCase() as "npm" | "pypi", pkg.slice(pkg.indexOf(":") + 1)] : [null, null];
  return { repo: parts[0] ?? "", ecosystem: eco, packageName: name, intendedUse: use.join("|").trim().slice(0, 300) };
}

