import AppShell from "@/components/AppShell";
import { requireUser, isBoardObserver, isServiceAdvisor } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";
import { isActiveInterviewer } from "@/lib/ats";
import { isDemoMode } from "@/lib/demo";
import DemoModeBanner from "@/components/DemoModeBanner";

// Layout for all authenticated app screens. Redirects to /login when there is
// no valid manager session, and provides the persistent nav shell.
export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Board observers never see Fleet, so skip the (branch-scoped) GPS badge for them.
  const [unread, isInterviewer, demoMode] = await Promise.all([
    unreadCount(user.id).catch(() => 0),
    isActiveInterviewer(user.id).catch(() => false),
    isDemoMode().catch(() => false),
  ]);
  return (
    <AppShell
      managerName={user.name}
      isAdmin={user.role === "admin"}
      isEmployee={user.role === "employee"}
      isSeniorLeadership={user.seniorLeadership}
      isHrAccess={user.hrAccess}
      isInterviewer={isInterviewer}
      isBoardObserver={isBoardObserver(user)}
      isSalesDirector={user.accessLevel === "sales_director" && user.role !== "admin"}
      isServiceAdvisor={isServiceAdvisor(user)}
      unread={unread}
    >
      {demoMode ? <DemoModeBanner isAdmin={user.role === "admin"} /> : null}
      {children}
    </AppShell>
  );
}
