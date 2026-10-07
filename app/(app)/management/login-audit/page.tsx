import { redirect } from "next/navigation";
import { PageHeader, Card } from "@/components/ui";
import { requireUser, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BlockedLogins from "./BlockedLogins";

export const dynamic = "force-dynamic";

// Admin-only live login audit: for every login account, show its email, access
// level, active flag, and whether the shared default password `clements123`
// currently works — so a "can't log in" report can be diagnosed against the REAL
// production data instead of guessing. Accounts that cannot sign in are listed
// first with the reason.
export default async function LoginAuditPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");

  const users = await prisma.user.findMany({
    include: { employee: { select: { name: true, status: true } } },
    orderBy: { name: "asc" },
  });

  const rows = users.map((u) => {
    const pwOk = verifyPassword("clements123", u.passwordHash);
    const canLogin = u.active && pwOk;
    const reason = !u.active ? "INACTIVE" : !pwOk ? "password ≠ clements123" : "";
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      access: u.accessLevel ?? u.role ?? "—",
      active: u.active,
      pwOk,
      canLogin,
      reason,
      employee: u.employee?.name ?? null,
    };
  });
  const blocked = rows.filter((r) => !r.canLogin).sort((a, b) => a.email.localeCompare(b.email));
  const ok = rows.filter((r) => r.canLogin).sort((a, b) => a.email.localeCompare(b.email));

  return (
    <>
      <PageHeader
        title="Login audit"
        subtitle={`${rows.length} accounts · ${ok.length} can sign in with clements123 · ${blocked.length} cannot`}
      />

      {blocked.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-red-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-red-700">Cannot sign in with clements123 — click “Reset + activate” to fix</div>
          <BlockedLogins rows={blocked.map((r) => ({ id: r.id, name: r.name, email: r.email, access: r.access, active: r.active, pwOk: r.pwOk, reason: r.reason, employee: r.employee }))} />
        </Card>
      ) : (
        <Card className="p-4 mb-5 text-sm text-emerald-700">Every account can sign in with clements123.</Card>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">All accounts</div>
        <Table rows={ok} />
      </Card>
    </>
  );
}

function Table({ rows, showReason = false }: { rows: { id: string; name: string; email: string; access: string; active: boolean; pwOk: boolean; canLogin: boolean; reason: string; employee: string | null }[]; showReason?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Access</th>
            <th className="px-3 py-2 font-medium text-center">Active</th>
            <th className="px-3 py-2 font-medium text-center">clements123</th>
            {showReason ? <th className="px-3 py-2 font-medium">Why blocked</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2">{r.name}{r.employee && r.employee !== r.name ? <span className="text-[11px] text-muted"> · {r.employee}</span> : null}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
              <td className="px-3 py-2 text-muted">{r.access}</td>
              <td className="px-3 py-2 text-center">{r.active ? <span className="text-emerald-600">yes</span> : <span className="text-red-600 font-semibold">NO</span>}</td>
              <td className="px-3 py-2 text-center">{r.pwOk ? <span className="text-emerald-600">✓</span> : <span className="text-red-600">✗</span>}</td>
              {showReason ? <td className="px-3 py-2 text-red-600 text-xs">{r.reason}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
