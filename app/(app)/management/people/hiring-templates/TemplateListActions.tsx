"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TemplateListActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function call(action: string, extra: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(action);
    const res = await fetch("/api/hiring/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok && action === "template.duplicate" && data.id) { router.push(`/management/people/hiring-templates/${data.id}`); return; }
    router.refresh();
  }

  return (
    <>
      <button onClick={() => call("template.duplicate", {})} disabled={busy !== null} className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50">
        {busy === "template.duplicate" ? "…" : "Duplicate"}
      </button>
      <button
        onClick={() => call("template.setActive", { active: !active }, active ? "Deactivate this template? Jobs assigned it will fall back to the role/default template." : undefined)}
        disabled={busy !== null}
        className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-50"
      >
        {busy === "template.setActive" ? "…" : active ? "Deactivate" : "Reactivate"}
      </button>
    </>
  );
}
