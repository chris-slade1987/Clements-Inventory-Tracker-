import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";

// Layout for all authenticated app screens. Redirects to /login when there is
// no valid manager session, and provides the persistent nav shell.
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <AppShell managerName={user.name} isAdmin={user.role === "admin"} isEmployee={user.role === "employee"}>
      {children}
    </AppShell>
  );
}
