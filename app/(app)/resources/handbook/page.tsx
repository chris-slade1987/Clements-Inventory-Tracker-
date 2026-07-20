import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getDocument, latestAckForUser, latestAckForEmployee, HANDBOOK_SLUG } from "@/lib/policy-docs";
import Markdown from "@/components/Markdown";
import HandbookAck from "./HandbookAck";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee Handbook — Clements Command & Control" };

export default async function HandbookPage() {
  const user = await requireUser();
  const doc = await getDocument(HANDBOOK_SLUG);

  if (!doc) {
    return (
      <>
        <PageHeader title="Employee Handbook" />
        <EmptyState title="Handbook not available yet" hint="The handbook has not been published to the portal. Please check back shortly." />
      </>
    );
  }

  // A reader may have acknowledged via their login (userId) or, before they had
  // one, via an employee-tied link/onboarding ack. Take the most recent of the two.
  const [byUser, byEmp] = await Promise.all([
    latestAckForUser(doc.id, user.id),
    user.employeeId ? latestAckForEmployee(doc.id, user.employeeId) : Promise.resolve(null),
  ]);
  const ack = [byUser, byEmp]
    .filter((a): a is NonNullable<typeof a> => !!a)
    .sort((a, b) => b.acknowledgedAt.getTime() - a.acknowledgedAt.getTime())[0] ?? null;

  return (
    <>
      <PageHeader title={doc.title} subtitle={doc.effective ?? undefined} />
      <div className="mb-5">
        <HandbookAck
          slug={doc.slug}
          version={doc.version}
          acknowledgedVersion={ack?.version ?? null}
          acknowledgedAt={ack?.acknowledgedAt ? ack.acknowledgedAt.toISOString() : null}
          defaultName={user.name}
        />
      </div>
      <Card className="p-5 md:p-8">
        <Markdown className="max-w-none">{doc.body}</Markdown>
      </Card>
    </>
  );
}
