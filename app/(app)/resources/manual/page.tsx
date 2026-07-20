import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { getDocument, MANUAL_SLUG } from "@/lib/policy-docs";
import Markdown, { extractHeadings } from "@/components/Markdown";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manager Operating Manual — Clements Command & Control" };

export default async function ManualPage() {
  const user = await requireUser();
  // Manager-only reference — employees and board observers don't see it.
  if (user.role === "employee" || isBoardObserver(user)) redirect(homePath(user));

  const doc = await getDocument(MANUAL_SLUG);
  if (!doc) {
    return (
      <>
        <PageHeader title="Manager Operating Manual" />
        <EmptyState title="Manual not available yet" hint="The manager manual has not been published to the portal." />
      </>
    );
  }

  const toc = extractHeadings(doc.body, [2]);

  return (
    <>
      <PageHeader title={doc.title} subtitle={doc.effective ?? undefined} />
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* TOC — sticky sidebar on desktop, collapsible list on mobile */}
        <nav className="lg:w-64 lg:shrink-0 lg:sticky lg:top-6">
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Contents</div>
            <details open className="lg:hidden">
              <summary className="cursor-pointer text-sm font-medium text-ink">Jump to a section</summary>
              <TocList toc={toc} />
            </details>
            <div className="hidden lg:block">
              <TocList toc={toc} />
            </div>
          </Card>
        </nav>

        <Card className="flex-1 p-5 md:p-8 min-w-0">
          <Markdown className="max-w-none">{doc.body}</Markdown>
        </Card>
      </div>
    </>
  );
}

function TocList({ toc }: { toc: { text: string; slug: string }[] }) {
  return (
    <ul className="mt-1 space-y-1 max-h-[70vh] overflow-y-auto pr-1">
      {toc.map((h) => (
        <li key={h.slug}>
          <a href={`#${h.slug}`} className="block rounded px-2 py-1 text-sm text-slate-600 hover:bg-brand-50 hover:text-emerald-800">
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
