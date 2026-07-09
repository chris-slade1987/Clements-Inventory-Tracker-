import { EmptyState, PageHeader } from "@/components/ui";

export default function ReconcilePage() {
  return (
    <>
      <PageHeader
        title="Reconcile"
        subtitle="Fix mistakes with a full audit trail."
      />
      <EmptyState
        title="Reconcile & adjustments coming next"
        hint="Search every stock movement, reverse or adjust entries with a reason, and keep a complete who-changed-what history."
      />
    </>
  );
}
