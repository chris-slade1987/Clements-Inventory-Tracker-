"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, btn } from "@/components/ui";

type Diag = Record<string, unknown>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 mb-4">
      <div className="text-sm font-semibold text-ink mb-2">{title}</div>
      {children}
    </Card>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-80 overflow-auto rounded-lg bg-black/5 p-3 text-[11px] leading-relaxed text-ink whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function GpsSetupClient() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");

  const loadDiag = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/gps/diagnostics", { cache: "no-store" });
      setDiag(await res.json());
    } catch (e) {
      setMsg(`Diagnostics failed: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDiag();
  }, [loadDiag]);

  async function confirm(url?: string) {
    setMsg(null);
    try {
      const res = await fetch("/api/gps/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(url ? { action: "confirm", url } : { action: "confirm" }),
      });
      const data = await res.json();
      setMsg(res.ok ? `Confirm GET → HTTP ${data.status ?? "?"} at ${data.url ?? "?"}` : `Confirm failed: ${data.error ?? res.status}`);
      loadDiag();
    } catch (e) {
      setMsg(`Confirm failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  async function runSync() {
    setMsg(null);
    try {
      const res = await fetch("/api/gps/sync", { method: "POST" });
      const data = await res.json();
      setMsg(`Sync → ${JSON.stringify(data)}`);
      loadDiag();
    } catch (e) {
      setMsg(`Sync failed: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  const configured = diag?.configured === true;

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2">
        <button className={btn.primary} onClick={loadDiag} disabled={loading}>{loading ? "Running…" : "Re-run diagnostics"}</button>
        <button className={btn.secondary} onClick={runSync}>Run REST sync</button>
        <button className={btn.secondary} onClick={() => confirm()}>Confirm subscription (auto)</button>
      </div>

      {msg ? <div className="mb-4 rounded-lg border border-line bg-black/[0.03] px-3 py-2 text-xs text-ink break-all">{msg}</div> : null}

      <Section title="Confirm subscription manually">
        <p className="text-xs text-muted mb-2">
          Verizon&rsquo;s first webhook message contains a <code>SubscribeURL</code>. Confirming = visiting it.
          The auto button uses the latest one we received; or paste one here.
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="https://…SubscribeURL…"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
          />
          <button className={btn.primary} onClick={() => confirm(manualUrl)} disabled={!manualUrl.trim()}>Visit URL</button>
        </div>
      </Section>

      {!configured ? (
        <Section title="Verizon credentials">
          <p className="text-xs text-muted">Not configured in this environment (no VERIZON_* env vars) — the live REST test is skipped here. It runs in production where the credentials are set.</p>
        </Section>
      ) : null}

      {diag ? (
        <Section title="Raw diagnostics">
          <p className="text-xs text-muted mb-1">Look at <code>vehicles.firstRaw</code> (field names + vehicle number), and <code>statusHistory_*</code> (whether history returns rows and if they normalize). <code>local.realPositions</code> is what the map shows.</p>
          <Json value={diag} />
        </Section>
      ) : null}
    </div>
  );
}
