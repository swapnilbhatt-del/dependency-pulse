import type { MetadataRoute } from "next";
import { listDigests } from "@/lib/digest/queries";
import { appBaseUrl } from "@/lib/env";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appBaseUrl();
  const digests = await listDigests().catch(() => []);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/archive`, changeFrequency: "weekly", priority: 0.8 },
    ...digests.map((d) => ({ url: `${base}/digest/${d.isoWeek}`, lastModified: new Date(d.generatedAt), changeFrequency: "yearly" as const, priority: 0.6 })),
  ];
}
