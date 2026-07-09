import { EmptyState, PageHeader } from "@/components/ui";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Purchased vs. dispersed vs. on-hand, per warehouse and product."
      />
      <EmptyState
        title="Reports & export coming next"
        hint="Filter by warehouse, product, and date range, then export to CSV / Excel."
      />
    </>
  );
}
