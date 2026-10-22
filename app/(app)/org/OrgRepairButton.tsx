"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Super-admin "Apply corporate roles & fix top of chart" action. Runs the seeds in
// the live runtime (the deploy-time seed doesn't persist to prod) and reports what
// landed, then refreshes the chart. Mirrors the Training Center reseed button.
export default function OrgRepairButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/org/repair", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setErr(data.error ? `${data.error}${data.stack ? ` — ${data.stack}` : ""}` : "Failed.");
        return;
      }
      setMsg(
        `Applied role details to ${data.roles?.matched ?? 0} people (${data.roles?.failed ?? 0} failed), pinned ${data.roots?.cleared ?? 0} leader(s) to the top. Refreshing…`,
      );
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setBusy(false);
      setErr("Network error.");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-brand-800">
          Corporate role details &amp; top-of-chart not showing? Apply them now:
        </span>
        <button onClick={run} disabled={busy} className={`${btn.primary} px-3 py-1.5 text-xs`}>
          {busy ? "Applying…" : "Apply corporate roles & fix top"}
        </button>
      </div>
      {msg ? <p className="mt-2 text-[12px] font-medium text-brand-700">{msg}</p> : null}
      {err ? <p className="mt-2 text-[12px] text-red-600 break-words" role="alert">{err}</p> : null}
    </div>
  );
}
