"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Opt = {
  key: string;
  name: string;
  email: string | null;
  branch: string | null;
  group: string;
  userId: string | null;
  employeeId: string | null;
};

/**
 * Start an internal discussion. Renders a trigger (button or link) that opens a
 * modal to pick recipients + write the first message. Pass `context` to tag the
 * thread to the item being discussed (a reminder, alert, employee, or vehicle)
 * and pre-fill the subject.
 */
export default function ComposeThread({
  variant = "secondary",
  label = "Message",
  context,
  className,
  onSent,
}: {
  variant?: "primary" | "secondary" | "link";
  label?: string;
  context?: { type?: string; id?: string; label?: string; href?: string; subject?: string };
  className?: string;
  onSent?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(context?.subject ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && opts === null) {
      fetch("/api/threads/recipients")
        .then((r) => r.json())
        .then((d) => setOpts(d.options ?? []))
        .catch(() => setOpts([]));
    }
  }, [open, opts]);

  function toggle(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function addGroup(pred: (o: Opt) => boolean) {
    if (!opts) return;
    setPicked((prev) => {
      const next = new Set(prev);
      opts.filter(pred).forEach((o) => next.add(o.key));
      return next;
    });
  }

  function reset() {
    setPicked(new Set());
    setSubject(context?.subject ?? "");
    setMessage("");
    setError(null);
    setQ("");
  }

  async function send() {
    if (picked.size === 0) return setError("Choose at least one person.");
    if (!subject.trim()) return setError("Add a subject.");
    if (!message.trim()) return setError("Write a message.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        subject,
        message,
        recipients: [...picked],
        contextType: context?.type ?? "general",
        contextId: context?.id,
        contextLabel: context?.label,
        contextHref: context?.href,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not send.");
    setOpen(false);
    reset();
    onSent?.();
    router.refresh();
  }

  const trigger =
    variant === "link" ? (
      <button onClick={() => setOpen(true)} className={className ?? "text-xs font-medium text-brand-700 hover:underline"}>
        {label}
      </button>
    ) : (
      <button onClick={() => setOpen(true)} className={className ?? btn[variant]}>
        {label}
      </button>
    );

  const groups = ["Leadership & HR", "Managers", "Employees"];
  const filtered = (opts ?? []).filter((o) =>
    q.trim() ? o.name.toLowerCase().includes(q.trim().toLowerCase()) : true,
  );

  return (
    <>
      {trigger}
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">New message</h3>
              <button onClick={() => { setOpen(false); reset(); }} className="text-muted hover:text-ink text-xl leading-none">×</button>
            </div>
            {context?.label ? (
              <div className="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800">
                Re: <span className="font-medium">{context.label}</span>
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Send to</label>
                <div className="flex gap-2 text-[11px]">
                  <button type="button" onClick={() => addGroup((o) => o.group === "Leadership & HR")} className="text-brand-700 hover:underline">+ HR/Leadership</button>
                  <button type="button" onClick={() => addGroup((o) => o.group === "Managers")} className="text-brand-700 hover:underline">+ Managers</button>
                </div>
              </div>
              {picked.size > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...picked].map((k) => {
                    const o = (opts ?? []).find((x) => x.key === k);
                    return (
                      <span key={k} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-800">
                        {o?.name ?? k}
                        <button onClick={() => toggle(k)} className="text-brand-600 hover:text-brand-900">×</button>
                      </span>
                    );
                  })}
                </div>
              ) : null}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people…"
                className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
              <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {opts === null ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">Loading people…</p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted">No matches.</p>
                ) : (
                  groups.map((g) => {
                    const rows = filtered.filter((o) => o.group === g);
                    if (rows.length === 0) return null;
                    return (
                      <div key={g}>
                        <div className="bg-black/[0.03] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{g}</div>
                        {rows.map((o) => (
                          <label key={o.key} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-black/[0.02]">
                            <input type="checkbox" checked={picked.has(o.key)} onChange={() => toggle(o.key)} className="accent-brand-600" />
                            <span className="flex-1">{o.name}</span>
                            {!o.email ? <span className="text-[10px] text-amber-600">no email</span> : null}
                          </label>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <label className="block text-sm font-medium">Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Monthly training course due" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Message
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="Write your note…" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setOpen(false); reset(); }} className={btn.secondary}>Cancel</button>
              <button onClick={send} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Sending…" : "Send message"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
