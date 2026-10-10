"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Card, btn } from "@/components/ui";
import ComposeThread from "@/components/ComposeThread";

type Alert = {
  id: string;
  type: string;
  message: string;
  severity: string;
  status: string;
  createdAt: string;
  productName: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  price_increase: "Price increase",
  duplicate_invoice: "Duplicate invoice",
  negative_stock: "Negative stock",
  quantity_spike: "Quantity spike",
  low_stock: "Low stock / reorder",
  savings: "Cost-saving opportunity",
};

// Inline-SVG path per alert type (24x24, stroke, currentColor) so each alert reads
// at a glance instead of a wall of text.
const TYPE_ICON: Record<string, string> = {
  price_increase: "M3 17l6-6 4 4 7-7M14 8h7v7", // upward trend
  duplicate_invoice: "M8 8h10v12H8zM6 16H4V4h10v2", // stacked pages
  negative_stock: "M12 9v4m0 4h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L14 3.9a2 2 0 00-3.4 0z", // warning triangle
  quantity_spike: "M3 3v18h18M7 15l3-4 3 3 4-6", // chart jump
  low_stock: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4", // open box
  savings: "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", // dollar sign
};
const FALLBACK_ICON = "M12 9v4m0 4h.01M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L14 3.9a2 2 0 00-3.4 0z";

// Severity → accent color set for the icon tile + card left border.
const SEV_STYLE: Record<string, { border: string; tile: string; label: string }> = {
  critical: { border: "#dc2626", tile: "bg-red-100 text-red-700", label: "text-red-700" },
  warning: { border: "#d97706", tile: "bg-amber-100 text-amber-700", label: "text-amber-700" },
  info: { border: "#2563eb", tile: "bg-blue-100 text-blue-700", label: "text-blue-700" },
};
const sevStyle = (s: string) => SEV_STYLE[s] ?? SEV_STYLE.info;

function TypeIcon({ type, severity }: { type: string; severity: string }) {
  const st = sevStyle(severity);
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${st.tile}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d={TYPE_ICON[type] ?? FALLBACK_ICON} />
      </svg>
    </span>
  );
}

export default function AlertsClient({
  alerts,
  thresholdPct,
  show,
  isAdmin = false,
}: {
  alerts: Alert[];
  thresholdPct: string;
  show: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(thresholdPct);

  const openCount = alerts.filter((a) => a.status === "open" || a.status === "acknowledged").length;

  async function clearAll() {
    if (!confirm(`Dismiss all ${openCount} open inventory alert(s)? They move to "dismissed" and won't reopen on the next check.`)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismissAll" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote(`Cleared ${data.dismissed ?? 0} alert(s).`);
        router.refresh();
      } else {
        setNote(data.error ?? "Failed to clear alerts.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runChecks() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/alerts/run", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const savings = data.savingsTotal ?? 0;
        setNote(
          data.total === 0
            ? "Checks ran — nothing new flagged."
            : `Checks ran — ${data.total} flag(s) refreshed` +
              (savings > 0 ? `, including ${savings} cost-saving opportunity(ies).` : ".")
        );
        router.refresh();
      } else {
        setNote(data.error ?? "Failed to run checks.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    router.refresh();
  }

  async function saveThreshold() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "price_increase_threshold_pct", value: threshold }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(res.ok ? "Threshold saved." : (data.error ?? "Failed to save."));
    } finally {
      setBusy(false);
    }
  }

  function setShow(v: string) {
    router.push(v === "active" ? pathname : `${pathname}?show=${v}`);
  }

  return (
    <>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <button onClick={runChecks} disabled={busy} className={btn.primary}>
            {busy ? "Running…" : "Run checks now"}
          </button>
          {isAdmin && openCount > 0 ? (
            <button onClick={clearAll} disabled={busy} className={btn.secondary} data-testid="clear-all-alerts">
              {busy ? "Working…" : `Clear all ${openCount}`}
            </button>
          ) : null}
          <label className="text-xs font-medium text-muted">
            Price-increase threshold (%)
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-24 rounded-lg border border-line px-2 py-2 text-sm text-ink"
              />
              <button onClick={saveThreshold} disabled={busy} className={btn.secondary}>
                Save
              </button>
            </div>
          </label>
          <div className="ml-auto flex gap-1 text-xs">
            {["active", "dismissed", "all"].map((v) => (
              <button
                key={v}
                onClick={() => setShow(v)}
                className={`rounded-full px-3 py-1.5 font-medium capitalize ${
                  show === v ? "bg-emerald-grad text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {note ? <p className="mt-3 text-sm text-brand-700">{note}</p> : null}
      </Card>

      {alerts.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {(["critical", "warning", "info"] as const).map((sev) => {
            const n = alerts.filter((a) => a.severity === sev).length;
            if (!n) return null;
            const st = sevStyle(sev);
            return (
              <span key={sev} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${st.tile}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.border }} />
                {n} {sev}
              </span>
            );
          })}
        </div>
      ) : null}

      {alerts.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          {show === "active" ? "No active alerts. Everything looks in order." : "Nothing here."}
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const st = sevStyle(a.severity);
            return (
            <Card key={a.id} className="p-3 border-l-4" style={{ borderLeftColor: st.border }}>
              <div className="flex items-start gap-3">
                <TypeIcon type={a.type} severity={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium text-ink">{TYPE_LABEL[a.type] ?? a.type}</span>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${st.label}`}>{a.severity}</span>
                  </div>
                  <div className="text-sm text-ink">{a.message}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {a.productName ? `${a.productName} · ` : ""}
                    {new Date(a.createdAt).toLocaleString()}
                    {a.status !== "open" ? ` · ${a.status}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <ComposeThread
                    variant="link"
                    label="Discuss"
                    context={{
                      type: "alert",
                      id: a.id,
                      label: `${TYPE_LABEL[a.type] ?? a.type}${a.productName ? ` · ${a.productName}` : ""}`,
                      href: "/alerts",
                      subject: `Re: ${TYPE_LABEL[a.type] ?? a.type}${a.productName ? ` — ${a.productName}` : ""}`,
                    }}
                  />
                  {a.status !== "acknowledged" && a.status !== "dismissed" ? (
                    <button onClick={() => setStatus(a.id, "acknowledged")} className="text-xs font-medium text-brand-700 hover:underline">
                      Acknowledge
                    </button>
                  ) : null}
                  {a.status !== "dismissed" ? (
                    <button onClick={() => setStatus(a.id, "dismissed")} className="text-xs font-medium text-slate-500 hover:underline">
                      Dismiss
                    </button>
                  ) : (
                    <button onClick={() => setStatus(a.id, "open")} className="text-xs font-medium text-brand-700 hover:underline">
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
