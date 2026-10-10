"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { ACCESS_LEVELS, accessLevelLabel } from "@/lib/access-levels";

// Super-admin access editor on the employee profile — the same actions the org
// chart offers, surfaced here so access rights can be managed where you're looking
// at the person. If the employee has a login, pick their access level; if not,
// "Grant login" creates a sign-in at their work email (shared default password)
// and sets the level in one step.
export default function AccessRightsCard({
  employeeId,
  userId,
  accessLevel,
  employeeName,
}: {
  employeeId: string;
  userId: string | null;
  accessLevel: string | null;
  employeeName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function setLevel(level: string) {
    setBusy(true); setMsg(null); setErr(null);
    const res = await fetch("/api/management/access-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, accessLevel: level }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? "Could not update access.");
    setMsg(`Access set to ${accessLevelLabel(level)}.`);
    router.refresh();
  }

  async function grant(level: string) {
    if (!level) return;
    setBusy(true); setMsg(null); setErr(null);
    const res = await fetch("/api/management/grant-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, accessLevel: level }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(d.error ?? "Could not create the login.");
    setMsg(`Login created (${d.email}) with password clements123 — ${accessLevelLabel(level)} access.`);
    router.refresh();
  }

  return (
    <Card className="p-4 mb-5">
      <div className="mb-1 text-sm font-medium text-ink">Access rights</div>
      {userId ? (
        <>
          <p className="mb-2 text-xs text-muted">Current: <span className="font-medium text-ink">{accessLevelLabel(accessLevel)}</span>. Changing it updates what {employeeName.split(" ")[0]} can see and do across the portal.</p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Access level</span>
            <select
              value={accessLevel ?? ""}
              disabled={busy}
              onChange={(e) => e.target.value && setLevel(e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface"
            >
              <option value="" disabled>— set —</option>
              {ACCESS_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">{employeeName.split(" ")[0]} has <span className="font-medium text-ink">no sign-in account</span>. Grant one at their work email (shared default password <span className="font-mono">clements123</span> to reset) and set the access level.</p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Grant login</span>
            <select
              value=""
              disabled={busy}
              onChange={(e) => grant(e.target.value)}
              className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink bg-surface"
            >
              <option value="">— no login · grant —</option>
              {ACCESS_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          </label>
        </>
      )}
      {msg ? <p className="mt-2 text-xs font-medium text-emerald-700">{msg}</p> : null}
      {err ? <p className="mt-2 text-xs font-medium text-red-600">{err}</p> : null}
    </Card>
  );
}
