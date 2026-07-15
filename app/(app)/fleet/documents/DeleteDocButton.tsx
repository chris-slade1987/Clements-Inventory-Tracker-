"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteDocButton({ id, label = "Remove" }: { id: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm("Remove this document? This can't be undone.")) return;
    setBusy(true);
    await fetch("/api/fleet/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    setBusy(false);
    router.refresh();
  }
  return <button onClick={remove} disabled={busy} className="text-xs text-muted hover:text-red-600">{busy ? "…" : label}</button>;
}
