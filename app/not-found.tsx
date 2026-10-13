import Link from "next/link";
import { PageMasthead } from "@/components/page-masthead";

export default function NotFound() {
  return (
    <main id="main">
      <PageMasthead
        eyebrow="404"
        title="That page does not exist"
        lede="If you followed a link to a weekly digest, that week may not have been generated yet. If it was a library report, the candidate may have been archived."
        glow="rgb(195 202 211 / 0.12)"
        actions={
          <>
            <Link href="/archive" className="btn btn-primary !bg-[#f3f5f7] !text-[#0d1117] hover:!bg-white">
              Browse the archive
            </Link>
            <Link href="/evaluate" className="btn btn-secondary !bg-transparent !text-mast-ink !border-[var(--mast-line)] hover:!bg-[rgb(255_255_255/0.08)]">
              Open Adoption Check
            </Link>
            <Link href="/" className="btn btn-secondary !bg-transparent !text-mast-ink !border-[var(--mast-line)] hover:!bg-[rgb(255_255_255/0.08)]">
              Go to the latest digest
            </Link>
          </>
        }
      />
    </main>
  );
}
