import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { requireUser, isBoardObserver, isServiceAdvisor, isFieldOpsDirector, homePath, passwordChangeOverdue, PASSWORD_GRACE_MS, PASSWORD_POLICY_ENFORCED } from "@/lib/auth";
import { unreadCount } from "@/lib/threads";
import { isActiveInterviewer } from "@/lib/ats";
import { canManageAccessRights, effectiveGrantsForUser } from "@/lib/access";
import { matchPathToItem } from "@/lib/access-paths";
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

  // Forced default-password change. The pathname arrives as a request header set
  // by proxy.ts (the layout can't otherwise see the URL). Once a user who is still
  // on the shared default password is past their 72h grace window, every app page
  // is redirected to /account until they set their own password — EXCEPT /account
  // itself, so there is never a redirect loop and they can always reach the form.
  // The whole forced-change policy is gated OFF until PASSWORD_POLICY_ENFORCED=1
  // (no email provider yet). While off, everyone just uses the shared default and
  // is never redirected or nagged.
  const path = (await headers()).get("x-pathname") ?? "";
  const onAccount = path === "/account" || path.startsWith("/account/");
  if (PASSWORD_POLICY_ENFORCED && passwordChangeOverdue(user) && !onAccount) {
    redirect("/account");
  }
  // Before the deadline: a gentle reminder banner (never blocks).
  const passwordDueInMs =
    PASSWORD_POLICY_ENFORCED && user.mustChangePassword && user.firstLoginAt
      ? user.firstLoginAt.getTime() + PASSWORD_GRACE_MS - Date.now()
      : null;
  const passwordReminderHours =
    passwordDueInMs !== null && passwordDueInMs > 0 ? Math.ceil(passwordDueInMs / 3_600_000) : null;

  // Board observers never see Fleet, so skip the (branch-scoped) GPS badge for them.
  const [unread, isInterviewer, demoMode, grants] = await Promise.all([
    unreadCount(user.id).catch(() => 0),
    isActiveInterviewer(user.id).catch(() => false),
    isDemoMode().catch(() => false),
    effectiveGrantsForUser(user).catch(() => ({})),
  ]);

  // Access Rights enforcement. Admins (super admin, team-scoped admin, the
  // field-ops director) are never gated. For everyone else, if the page maps to a
  // catalog item their effective grants don't include, send them to a page they
  // can reach. Unmapped paths are never blocked; the target is loop-safe (falls
  // back to /account, which every level can open). Existing per-page guards stay
  // in place underneath this.
  const grantedKeys = Object.keys(grants).filter((k) => (grants as Record<string, unknown>)[k]);
  if (user.role !== "admin" && path) {
    const item = matchPathToItem(path);
    if (item && !(grants as Record<string, unknown>)[item]) {
      let target = homePath(user);
      const targetItem = matchPathToItem(target);
      if (targetItem && !(grants as Record<string, unknown>)[targetItem]) target = "/account";
      // Carry a flash so the shell can explain the redirect instead of silently
      // dropping the user on a different page (AppShell reads ?denied client-side
      // and strips it). The target is a clean path, so just append the param.
      if (path !== target) redirect(`${target}?denied=${encodeURIComponent(item)}`);
    }
  }
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
      isFieldOpsDirector={isFieldOpsDirector(user)}
      canManageAccessRights={canManageAccessRights(user)}
      grantedKeys={grantedKeys}
      unread={unread}
    >
      {demoMode ? <DemoModeBanner isAdmin={user.role === "admin"} /> : null}
      {passwordReminderHours !== null && !onAccount ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">
            You&apos;re using the default password. Please set your own
            {passwordReminderHours <= 72 ? ` — due in ${passwordReminderHours}h` : ""}.
          </span>
          <a href="/account" className="font-semibold underline underline-offset-2">
            Set password
          </a>
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
