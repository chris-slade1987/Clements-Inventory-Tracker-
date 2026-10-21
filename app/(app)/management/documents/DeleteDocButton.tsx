"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Remove a filed document. `kind` picks the right API: vehicle docs + pending
// intake go to /api/fleet/document; branch docs (leases/licenses) go to
// /api/branch/document. Both take { action:"delete", id }.
export default function DeleteDocButton({ id, label = "Remove", kind = "vehicle" }: { id: string; label?: string; kind?: "vehicle" | "branch" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm("Remove this document? This can't be undone.")) return;
    setBusy(true);
    const endpoint = kind === "branch" ? "/api/branch/document" : "/api/fleet/document";
    await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
    setBusy(false);
    router.refresh();
  }
  return <button onClick={remove} disabled={busy} className="text-xs text-muted hover:text-red-600">{busy ? "…" : label}</button>;
}
