import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { appBaseUrl } from "@/lib/env";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "600"], display: "swap" });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl()),
  title: { default: "Upstream Weekly", template: "%s · Upstream Weekly" },
  description: "A Monday digest of new releases across the open-source dependencies your product relies on, with security fixes and breaking changes first.",
  applicationName: "Upstream Weekly",
  openGraph: {
    type: "website",
    siteName: "Upstream Weekly",
    title: "Upstream Weekly",
    description: "Weekly release digest: security fixes and breaking changes first, everything else in five minutes.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#111316" },
  ],
};

// Applies the saved theme before first paint to avoid a flash. Wrapped in try/catch: storage can be unavailable.
const themeScript = `try{var t=localStorage.getItem("dp-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* next/script attaches the request nonce on admin pages (strict CSP); public pages allow it via 'unsafe-inline'. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
      </head>
      <body className="min-h-dvh flex flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
