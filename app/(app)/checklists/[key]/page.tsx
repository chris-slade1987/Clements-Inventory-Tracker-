import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import {
  getTemplateByKey,
  completionFor,
  parseItems,
  parseItemResults,
  periodKeyFor,
  periodLabelFor,
  attestationText,
} from "@/lib/checklists";
import ChecklistRun from "./ChecklistRun";

export const dynamic = "force-dynamic";

export default async function ChecklistRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const user = await requireUser();

  const template = await getTemplateByKey(key);
  if (!template || !template.active) notFound();

  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? (branchLocked(user) ? null : BRANCHES[0].key);
  if (!branch) notFound();

  const now = new Date();
  const periodKey = periodKeyFor(template.cadence, now);
  const periodLabel = periodLabelFor(template.cadence, now);

  const items = parseItems(template.items);
  const existing = await completionFor(template.id, branch, periodKey);
  const canSign = user.role === "manager" || user.role === "admin";
  const attestation = attestationText(user.name, periodLabel, branch);

  return (
    <>
      <div className="mb-3">
        <Link href={`/checklists?branch=${branch}`} className="text-sm text-brand-300 hover:underline">← All checklists</Link>
      </div>
      <PageHeader
        title={template.title}
        subtitle={`${branchLabel(branch)} · ${periodLabel}`}
      />
      <ChecklistRun
        templateId={template.id}
        intro={template.intro}
        branch={branch}
        periodKey={periodKey}
        periodLabel={periodLabel}
        items={items}
        attestation={attestation}
        canSign={canSign}
        defaultName={user.name}
        existing={
          existing
            ? {
                signedName: existing.signedName,
                attestation: existing.attestation,
                createdAt: existing.createdAt.toISOString(),
                itemResults: parseItemResults(existing.itemResults),
              }
            : null
        }
      />
    </>
  );
}
