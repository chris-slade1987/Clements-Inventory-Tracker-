import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import ManageTabs from "./ManageTabs";

export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Manage"
        subtitle="Catalog and people. Removing an item deactivates it — history is kept."
      />
      <ManageTabs />
      {children}
    </>
  );
}
