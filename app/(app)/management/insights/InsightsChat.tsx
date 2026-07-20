"use client";

import { useEffect, useRef, useState } from "react";
import { Card, btn } from "@/components/ui";

type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "Why is EBITDA margin down in June?",
  "Which branch is over budget on chemical?",
  "How is attrition trending vs budget?",
  "What's driving the SG&A variance?",
];

export default function InsightsChat({ configured }: { configured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(!configured);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

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
    <div className="flex flex-col gap-4">
      {notConfigured ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-medium">Assistant not connected</div>
          <p className="mt-0.5 text-amber-800">
            Add an Anthropic API key to enable grounded answers. Set{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px] font-mono">ANTHROPIC_API_KEY</code> or{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px] font-mono">INSIGHTS_ANTHROPIC_API_KEY</code>{" "}
            in the environment. You can still explore the interface below.
          </p>
        </div>
      ) : null}

      <Card className="flex flex-col overflow-hidden">
        {/* Message list */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 min-h-[16rem] max-h-[60vh]">
          {messages.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted">
                Ask a question about revenue, EBITDA, attrition, branch performance, or budget variance. Answers are
                grounded in your Monthly Board Report data.
              </p>
            </div>
          ) : (
            messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-grad px-4 py-2.5 text-sm text-[#05271c] shadow-sm">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-3 text-sm text-ink shadow-sm">
                    <Markdown text={m.content} />
                  </div>
                </div>
              )
            )
          )}
          {loading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-2.5 text-sm text-muted shadow-sm">
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Analyzing…
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Starter chips */}
        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={loading}
                className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-ink hover:bg-[#eef5f0] disabled:opacity-50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-line bg-[#f7faf8] px-3 py-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about the numbers…"
            className="flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
          />
          <button type="submit" disabled={loading || !input.trim()} className={btn.primary}>
            Send
          </button>
        </form>
      </Card>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
      ) : null}

      <p className="text-xs text-muted">
        Answers are grounded in stored KPI, branch, and line-of-business figures. SG&amp;A is stored as a single total —
        line-item detail needs full P&amp;L ingestion. Manager and individual compensation is never stored or discussed.
      </p>
    </div>
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

// Minimal markdown: paragraphs, **bold**, and - / * bullet lists. Anything else
// falls back to whitespace-preserving text.
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
              {items.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="whitespace-pre-wrap">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(s: string) {
  // Split on **bold** spans and render them <strong>.
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}
