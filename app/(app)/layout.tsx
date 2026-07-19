import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";
import { isActiveInterviewer } from "@/lib/ats";

// Layout for all authenticated app screens. Redirects to /login when there is
// no valid manager session, and provides the persistent nav shell.
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [unread, isInterviewer] = await Promise.all([
    unreadCount(user.id).catch(() => 0),
    isActiveInterviewer(user.id).catch(() => false),
  ]);
  return (
    <AppShell
      managerName={user.name}
      isAdmin={user.role === "admin"}
      isEmployee={user.role === "employee"}
      isSeniorLeadership={user.seniorLeadership}
      isHrAccess={user.hrAccess}
      isInterviewer={isInterviewer}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
