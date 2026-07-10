"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Card, btn } from "@/components/ui";

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
};

export default function AlertsClient({
  alerts,
  thresholdPct,
  show,
}: {
  alerts: Alert[];
  thresholdPct: string;
  show: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(thresholdPct);

  async function runChecks() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/alerts/run", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote(
          data.total === 0
            ? "Checks ran — no new anomalies."
            : `Checks ran — ${data.total} anomaly flag(s) refreshed.`
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
                  show === v ? "bg-emerald-grad text-[#05271c]" : "bg-slate-100 text-slate-600"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {note ? <p className="mt-3 text-sm text-brand-700">{note}</p> : null}
      </Card>

      {alerts.length === 0 ? (
        <Card className="p-8 text-center text-muted">
          {show === "active" ? "No active alerts. Everything looks in order." : "Nothing here."}
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <Card key={a.id} className="p-3">
              <div className="flex items-start gap-3">
                <SeverityBadge severity={a.severity} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">{a.message}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {TYPE_LABEL[a.type] ?? a.type}
                    {a.productName ? ` · ${a.productName}` : ""} ·{" "}
                    {new Date(a.createdAt).toLocaleString()}
                    {a.status !== "open" ? ` · ${a.status}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
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
          ))}
        </div>
      )}
    </>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${map[severity] ?? map.info}`}>
      {severity}
    </span>
  );
}
