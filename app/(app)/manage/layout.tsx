import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ManageTabs from "./ManageTabs";

export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Admins get the full Manage area; HR (hrAccess) reaches ONLY the product
  // confirm queue (the individual admin-only pages guard themselves as well).
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  if (!isAdmin && !user.hrAccess) redirect("/dashboard");

  const toConfirm = await prisma.product.count({ where: { confirmed: false, active: true } });

  return (
    <>
      <PageHeader
        title="Inventory Administration"
        subtitle="Product catalog, stock imports, the new-product confirm queue, and technicians — plus user access. Removing an item deactivates it; history is kept."
      />
      <ManageTabs isAdmin={isAdmin} toConfirm={toConfirm} />
      {children}
    </>
  );
}
