"use client";

import { useEffect, useRef, useState } from "react";

// Floating "Ask Insights" assistant — a bottom-right launcher that opens a chat
// panel wired to /api/insights (grounded management Q&A). Mounted globally in
// AppShell for admins + senior leadership. Discovers the not-configured state
// from the API response, so no server prop is needed.

type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Why is EBITDA margin down in June?",
  "Which branch is over budget on chemical?",
  "How is attrition trending vs budget?",
];

export default function InsightsWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
      } else if (data?.configured === false) {
        setNotConfigured(true);
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher button */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Insights"
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex items-center gap-2 rounded-full bg-emerald-grad px-4 py-3 text-sm font-medium text-[#05271c] shadow-lg shadow-emerald-900/30 hover:brightness-105 transition"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5z" />
            <path d="M8.5 10.5h7M8.5 13.5h4" />
          </svg>
          <span className="hidden sm:inline">Ask Insights</span>
        </button>
      ) : null}

      {/* Chat panel */}
      {open ? (
        <div className="surface-light fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex w-[calc(100vw-2rem)] max-w-[400px] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl shadow-emerald-900/30">
          {/* Header */}
          <div className="flex items-center gap-2 bg-forest-grad px-4 py-3">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-mint" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5z" />
            </svg>
            <div className="leading-tight">
              <div className="text-sm font-medium text-white">Insights</div>
              <div className="text-[11px] text-mint">Grounded in your board data</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto rounded-lg p-1 text-mint hover:bg-white/10 hover:text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          {notConfigured ? (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Not connected yet — set <code className="font-mono">ANTHROPIC_API_KEY</code> (or <code className="font-mono">INSIGHTS_ANTHROPIC_API_KEY</code>) to enable answers.
            </div>
          ) : null}

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3 min-h-[14rem] max-h-[50vh]">
            {messages.length === 0 ? (
              <p className="px-1 py-4 text-center text-[13px] text-muted">
                Ask about revenue, EBITDA, attrition, branch performance, or budget variance.
              </p>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-grad px-3 py-2 text-[13px] text-[#05271c]">{m.content}</div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-2 text-[13px] text-ink"><Markdown text={m.content} /></div>
                  </div>
                )
              )
            )}
            {loading ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-2 text-[13px] text-muted">
                  <span className="inline-flex items-center gap-2"><Spinner /> Analyzing…</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Starters */}
          {messages.length === 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2.5">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={loading} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-ink hover:bg-[#eef5f0] disabled:opacity-50 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          {/* Composer */}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 border-t border-line bg-[#f7faf8] px-2.5 py-2.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              rows={1}
              placeholder="Ask about the numbers…"
              className="flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
            />
            <button type="submit" disabled={loading || !input.trim()} className="rounded-xl bg-emerald-grad px-3 py-2 text-[13px] font-medium text-[#05271c] disabled:opacity-50">Send</button>
          </form>

          {error ? <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div> : null}
        </div>
      ) : null}
    </>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin text-brand-500" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Minimal markdown: paragraphs, **bold**, and - / * bullet lists.
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.length > 0 && lines.every((l) => /^\s*[-*]\s+/.test(l) || l.trim() === "");
        if (isList) {
          const items = lines.filter((l) => /^\s*[-*]\s+/.test(l));
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {items.map((l, li) => <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>)}
            </ul>
          );
        }
        return <p key={bi} className="whitespace-pre-wrap">{renderInline(block)}</p>;
      })}
    </div>
  );
}

function renderInline(s: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
  );
}
