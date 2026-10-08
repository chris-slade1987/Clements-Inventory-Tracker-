"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

export default function FixAllButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function fixAll() {
    if (!confirm("Set EVERY login to its employee-profile email + password clements123 + active? Use this to get everyone able to sign in. (People who already changed their own password will be reset back to clements123.)")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/management/login-audit/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "all" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(data.error ?? "Failed."); return; }
      setMsg(`Done — ${data.fixed}/${data.total} logins set to profile email + clements123.${data.errors?.length ? ` ${data.errors.length} had issues.` : ""}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={fixAll} disabled={busy} className={btn.primary}>
          {busy ? "Fixing all logins…" : "Reset ALL logins → profile email + clements123"}
        </button>
        <span className="text-xs text-amber-800">
          One click: every account becomes its profile email with password <span className="font-mono">clements123</span>, active. Fixes everyone at once.
        </span>
      </div>
      {msg ? <p className="mt-2 text-sm font-medium text-emerald-700">{msg}</p> : null}
    </div>
  );
}
