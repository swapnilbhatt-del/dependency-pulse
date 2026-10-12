import type { Dimension } from "@/lib/health/config";

export const DIMENSION_LABEL: Record<Dimension, string> = {
  security: "Security posture",
  vulnerabilities: "Known vulnerabilities",
  maintenance: "Maintenance",
  cadence: "Release cadence",
  responsiveness: "Responsiveness",
  maintainerDepth: "Maintainer depth",
  governance: "Governance and licensing",
  ci: "CI health",
  adoption: "Adoption",
};

export const ADOPTION_STATUS_LABEL = { evaluating: "Evaluating", adopted: "Adopted", rejected: "Rejected", parked: "Parked" } as const;
export const BACKING_LABEL = { "company-backed": "Company-backed", "foundation-backed": "Foundation-backed", individual: "Individual", unknown: "Unknown" } as const;
