import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DigestView } from "@/components/digest/digest-view";
import type { DigestModel } from "@/lib/digest/model";
import { getPipelineRun } from "@/lib/pipeline/store";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: PageProps<"/admin/preview/[runId]">) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(runId)) notFound();
  const run = await getPipelineRun(runId);
  const model = run?.previewModelJson as DigestModel | null | undefined;
  if (!model) notFound();
  return (
    <div className="-mx-4 sm:-mx-6">
      <DigestView
        d={model}
        previewNote={
          <div className="mt-2 rounded-[10px] border border-review-line bg-review-bg p-3 text-sm text-ink" role="note">
            Preview only. This digest was not emailed or published. <Link href="/admin/runs">Back to runs</Link>
          </div>
        }
      />
    </div>
  );
}
