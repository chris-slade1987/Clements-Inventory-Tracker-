import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { userCanAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { pendingProductRequestCount } from "@/lib/product-requests";
import ManageTabs from "./ManageTabs";

export const dynamic = "force-dynamic";

export default async function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Catalog management (Products, Stock Import, Catalog Review, Requests) is now
  // super-admin-only (Chris, Julie, April). Team-scoped admins still reach the
  // non-catalog tools in this area (Technicians, Users & Access); every catalog
  // page also self-guards with isSuperAdmin. HR no longer has a catalog surface.
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  if (!isAdmin) {
    // Non-admins (e.g. branch managers) may open the READ-ONLY product profile
    // VIEW at /manage/products/[id] — but nothing else under /manage. The view page
    // self-guards and renders its own header, so skip the admin Inventory
    // Administration chrome. Everything else (list, edit, other tabs) stays
    // super-admin-only via the redirect below.
    const path = ((await headers()).get("x-pathname") ?? "").replace(/\/$/, "");
    const isProductView = /^\/manage\/products\/[^/]+$/.test(path) && !path.endsWith("/edit");
    if (isProductView && (await userCanAccess(user, "product-profile"))) {
      return <>{children}</>;
    }
    redirect("/dashboard");
  }
  const superAdmin = isSuperAdmin(user);

  const [toConfirm, toRequests] = await Promise.all([
    prisma.product.count({ where: { confirmed: false, active: true } }),
    superAdmin ? pendingProductRequestCount() : Promise.resolve(0),
  ]);

  return (
    <>
      <PageHeader
        title="Inventory Administration"
        subtitle="Product catalog, stock imports, the new-product confirm queue, and technicians — plus user access. Removing an item deactivates it; history is kept."
      />
      <ManageTabs isAdmin={isAdmin} superAdmin={superAdmin} toConfirm={toConfirm} toRequests={toRequests} />
      {children}
    </>
  );
}
