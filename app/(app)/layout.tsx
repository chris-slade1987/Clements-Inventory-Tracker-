import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";

// Layout for all authenticated app screens. Redirects to /login when there is
// no valid manager session, and provides the persistent nav shell.
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const unread = await unreadCount(user.id).catch(() => 0);
  return (
    <AppShell
      managerName={user.name}
      isAdmin={user.role === "admin"}
      isEmployee={user.role === "employee"}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
