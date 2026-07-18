"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, btn } from "@/components/ui";

type Msg = { id: string; authorName: string; body: string; createdAt: string; mine: boolean };
type Participant = { name: string; isMe: boolean; hasLogin: boolean };

export default function ThreadView({
  id,
  subject,
  status,
  contextLabel,
  contextHref,
  participants,
  messages,
}: {
  id: string;
  subject: string;
  status: string;
  contextLabel: string | null;
  contextHref: string | null;
  participants: Participant[];
  messages: Msg[];
}) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the thread clears this user's unread alert.
  useEffect(() => {
    fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", id }),
    })
      .then(() => router.refresh())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Something went wrong.");
    if (action === "reply") setReply("");
    router.refresh();
  }

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-ink">{subject}</h1>
            {contextLabel ? (
              contextHref ? (
                <Link href={contextHref} className="text-xs text-brand-700 hover:underline">Re: {contextLabel} →</Link>
              ) : (
                <span className="text-xs text-brand-700">Re: {contextLabel}</span>
              )
            ) : null}
          </div>
          {status === "resolved" ? (
            <button onClick={() => act("reopen")} disabled={busy} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Reopen</button>
          ) : (
            <button onClick={() => act("resolve")} disabled={busy} className="shrink-0 text-xs font-medium text-muted hover:text-ink">Mark resolved</button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted">
          {participants.map((p) => (p.isMe ? "You" : p.name) + (p.hasLogin ? "" : " (email only)")).join(", ")}
        </p>
      </div>

      <div className="px-4 py-4 space-y-3 max-h-[52vh] overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.mine ? "bg-brand-600 text-white" : "bg-black/[0.04] text-ink"}`}>
              {!m.mine ? <div className="text-[11px] font-semibold text-brand-700">{m.authorName}</div> : null}
              <div className="text-sm whitespace-pre-line">{m.body}</div>
              <div className={`mt-0.5 text-[10px] ${m.mine ? "text-white/70" : "text-muted"}`}>{fmt(m.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-3">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Write a reply…"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm"
        />
        {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => reply.trim() && act("reply", { message: reply })}
            disabled={busy || !reply.trim()}
            className={btn.primary}
          >
            {busy ? "Sending…" : "Send reply"}
          </button>
        </div>
      </div>
    </Card>
  );
}
