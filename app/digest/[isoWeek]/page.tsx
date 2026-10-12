import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DigestView } from "@/components/digest/digest-view";
import { MastNav } from "@/components/mast-nav";
import { PrintButton } from "@/components/print-button";
import { fmtWeekOf } from "@/lib/digest/format";
import { getDigestModel, listDigests } from "@/lib/digest/queries";
import { ISO_WEEK_PATTERN } from "@/lib/filter/window";

export const revalidate = 300;

/**
 * Every existing week is prerendered at build time, so no reader pays for a
 * first render after a deploy. New weeks render on first request and are then
 * cached (ISR); the cron route also warms them right after sending.
 */
export async function generateStaticParams(): Promise<{ isoWeek: string }[]> {
  try {
    return (await listDigests(52)).map((d) => ({ isoWeek: d.isoWeek }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps<"/digest/[isoWeek]">): Promise<Metadata> {
  const { isoWeek } = await params;
  if (!ISO_WEEK_PATTERN.test(isoWeek)) return { title: "Digest not found" };
  const d = await getDigestModel(isoWeek).catch(() => null);
  if (!d) return { title: "Digest not found" };
  const title = `Week of ${fmtWeekOf(d.weekOf)}`;
  const description = `${d.statusLine}. ${d.counts.reposChecked} repositories checked.`;
  return {
    title,
    description,
    alternates: { canonical: `/digest/${isoWeek}` },
    openGraph: { title: `Upstream Weekly · ${title}`, description, type: "article", url: `/digest/${isoWeek}` },
  };
}

export default async function DigestPage({ params }: PageProps<"/digest/[isoWeek]">) {
  const { isoWeek } = await params;
  if (!ISO_WEEK_PATTERN.test(isoWeek)) notFound();
  const d = await getDigestModel(isoWeek);
  if (!d) notFound();
  const toolbar = (
    <MastNav>
      <PrintButton />
    </MastNav>
  );
  return (
    <main id="main">
      <DigestView d={d} toolbar={toolbar} />
    </main>
  );
}
