import { EmptyState, PageHeader } from "@/components/ui";

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Anomalies flagged by the automated checks."
      />
      <EmptyState
        title="Anomaly alerts coming next"
        hint="Price increases, duplicate invoices, negative stock, and quantity spikes will surface here to acknowledge or dismiss."
      />
    </>
  );
}
