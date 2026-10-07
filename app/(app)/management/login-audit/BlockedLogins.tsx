"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

export type BlockedRow = {
  id: string;
  name: string;
  email: string;
  access: string;
  active: boolean;
  pwOk: boolean;
  reason: string;
  employee: string | null;
};

export default function BlockedLogins({ rows }: { rows: BlockedRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function fix(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/management/login-audit/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Could not fix."); return; }
      setDone((d) => ({ ...d, [id]: "Reset to clements123 + activated" }));
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      {error ? <p className="px-4 py-2 text-sm text-red-600">{error}</p> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email (log in with THIS)</th>
            <th className="px-3 py-2 font-medium">Access</th>
            <th className="px-3 py-2 font-medium">Why blocked</th>
            <th className="px-4 py-2 font-medium text-right">Fix</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2">{r.name}{r.employee && r.employee !== r.name ? <span className="text-[11px] text-muted"> · {r.employee}</span> : null}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.email}</td>
              <td className="px-3 py-2 text-muted">{r.access}</td>
              <td className="px-3 py-2 text-red-600 text-xs">{!r.active ? "INACTIVE" : ""}{!r.active && !r.pwOk ? " · " : ""}{!r.pwOk ? "password ≠ clements123" : ""}</td>
              <td className="px-4 py-2 text-right">
                {done[r.id] ? (
                  <span className="text-xs font-medium text-emerald-600">{done[r.id]}</span>
                ) : (
                  <button onClick={() => fix(r.id)} disabled={busyId === r.id} className={btn.secondary}>
                    {busyId === r.id ? "Fixing…" : "Reset + activate"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
