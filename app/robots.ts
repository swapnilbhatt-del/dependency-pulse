import type { MetadataRoute } from "next";
import { appBaseUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    sitemap: `${appBaseUrl()}/sitemap.xml`,
  };
}
