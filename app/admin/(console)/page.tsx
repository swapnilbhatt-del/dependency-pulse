import type { Metadata } from "next";
import { RepoManager, type RepoView } from "@/components/admin/repo-manager";
import { listRepos } from "@/lib/repos/service";

export const metadata: Metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default async function AdminReposPage() {
  const rows = await listRepos();
  const repos: RepoView[] = rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    category: r.category,
    priority: r.priority,
    notes: r.notes,
    enabled: r.enabled,
    lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
  }));
  return <RepoManager initial={repos} />;
}
