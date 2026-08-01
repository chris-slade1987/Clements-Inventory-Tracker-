import AppShell from "@/components/AppShell";
import { requireUser, isBoardObserver, scopedBranch } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";
import { isActiveInterviewer } from "@/lib/ats";
import { openGpsAlertCount } from "@/lib/gps-detect";
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
  const [unread, isInterviewer, gpsAlertCount, demoMode] = await Promise.all([
    unreadCount(user.id).catch(() => 0),
    isActiveInterviewer(user.id).catch(() => false),
    isBoardObserver(user) ? Promise.resolve(0) : openGpsAlertCount(scopedBranch(user, null) ?? undefined).catch(() => 0),
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
      unread={unread}
      gpsAlertCount={gpsAlertCount}
    >
      {demoMode ? <DemoModeBanner isAdmin={user.role === "admin"} /> : null}
      {children}
    </AppShell>
  );
}
