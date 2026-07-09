import { EmptyState, PageHeader } from "@/components/ui";

export default function CheckOutPage() {
  return (
    <>
      <PageHeader
        title="Check-Out"
        subtitle="Disperse products from a warehouse to a technician's truck."
      />
      <EmptyState
        title="Check-out coming next"
        hint="Pick a warehouse and technician, add products by search or barcode scan, and confirm to move stock onto the truck."
      />
    </>
  );
}
