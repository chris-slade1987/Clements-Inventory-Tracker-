import { EmptyState, PageHeader } from "@/components/ui";

export default function CheckInPage() {
  return (
    <>
      <PageHeader
        title="Check-In"
        subtitle="Receive products into a warehouse from a distributor invoice."
      />
      <EmptyState
        title="Invoice check-in coming next"
        hint="Upload a distributor invoice (PDF or photo), the AI reader extracts the line items, you review and confirm, and stock is added to the warehouse."
      />
    </>
  );
}
