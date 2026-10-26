"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  COPILOT_OPEN_EVENT,
  screenLabel,
  suggestedPrompts,
  type CopilotOpenDetail,
  type CopilotUser,
} from "@/lib/copilot/prompts";

// ===========================================================================
// Canopy Copilot — the docked, grounded, access-scoped assistant for EVERY
// authenticated user. Replaces the leadership-only InsightsWidget. A persistent
// launcher opens a right-hand docked panel (full-screen sheet on phones) that:
//   • greets + shows role/screen suggested prompts (never a blank box),
//   • chats against POST /api/copilot with the current screen context,
//   • renders citations as source chips, actions as link/confirm cards,
//   • shows a context chip, Recent / New-conversation controls, and thumbs
//     feedback (best-effort POST /api/copilot/feedback).
// Brand kit: forest chrome + light content canvas, Helvetica Neue 300, thin 1.6
// line icons, the real /canopyos-icon.png mark, no emoji. Mobile = full-screen
// sheet; honors prefers-reduced-motion; focus-visible; Escape-to-close; focus trap.
// The API route lives in another wave — we call it at runtime only.
// ===========================================================================

type Citation = { title: string; section?: string; href: string };
type CopilotAction = {
  kind: "link" | "confirm";
  label: string;
  href?: string;
  endpoint?: string;
  method?: string;
  params?: Record<string, unknown>;
  confirmNote?: string;
};
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  actions?: CopilotAction[];
  grounded?: boolean;
  feedback?: "up" | "down";
};
type Conversation = { id: string; title: string; messages: Msg[]; updatedAt: number };

const RECENT_KEY = "canopy-copilot:recent:v1";
const OPEN_KEY = "canopy-copilot:open:v1";
const MAX_RECENT = 8;

// Warm, time-of-day greeting so the open panel feels like a colleague, not a form.
function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

function uid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The Copilot is a PERSISTENT docked sidebar, not a blocking modal — it defaults
 * open and coexists with the page, so it must not trap focus or steal it on load.
 * We only bind Escape-to-collapse (and only when the viewer is on a phone, where
 * the panel is a full-screen sheet, does the backdrop also close it — see render).
 */
function usePanelDialog(open: boolean, onClose: () => void, _ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

export default function CanopyCopilot({ user }: { user: CopilotUser }) {
  const pathname = usePathname() || "/";
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [recent, setRecent] = useState<Conversation[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<Msg[]>(messages);
  messagesRef.current = messages;

  const prompts = suggestedPrompts(user, pathname);
  const onScreen = screenLabel(pathname);
  const firstName = (user.name ?? "").split(" ")[0] || "there";

  // Load the viewer's recent conversations (per-browser convenience only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, MAX_RECENT));
      }
    } catch {
      /* private mode / blocked storage — recent stays empty */
    }
  }, []);

  // Default the sidebar OPEN on desktop (to nudge daily use) and remember the
  // viewer's choice across pages + reloads. On phones it stays collapsed to the
  // bubble by default so it never covers the screen uninvited.
  useEffect(() => {
    setMounted(true);
    let pref: string | null = null;
    try {
      pref = localStorage.getItem(OPEN_KEY);
    } catch {
      /* ignore */
    }
    const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    setOpen(pref === null ? isDesktop : pref === "1");
  }, []);

  // Persist the open/collapsed choice and reserve page space while docked (desktop).
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
    const de = document.documentElement;
    if (open) de.setAttribute("data-copilot-open", "1");
    else de.removeAttribute("data-copilot-open");
    return () => de.removeAttribute("data-copilot-open");
  }, [open, mounted]);

  const persistRecent = useCallback((list: Conversation[]) => {
    setRecent(list);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    } catch {
      /* ignore */
    }
  }, []);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open, showRecent]);

  const close = useCallback(() => setOpen(false), []);
  const openPanel = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);
  usePanelDialog(open, close, panelRef);

  // Archive the live thread (if any) into recent.
  const archiveCurrent = useCallback(() => {
    const live = messagesRef.current;
    if (live.length === 0) return;
    const title = live.find((m) => m.role === "user")?.content.slice(0, 60) || "Conversation";
    const convo: Conversation = { id: uid(), title, messages: live, updatedAt: Date.now() };
    persistRecent([convo, ...recent.filter((c) => c.id !== convo.id)].slice(0, MAX_RECENT));
  }, [persistRecent, recent]);

  const startNew = useCallback(() => {
    archiveCurrent();
    setMessages([]);
    setError(null);
    setShowRecent(false);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [archiveCurrent]);

  const loadRecent = useCallback(
    (convo: Conversation) => {
      archiveCurrent();
      setMessages(convo.messages);
      setShowRecent(false);
      setError(null);
    },
    [archiveCurrent],
  );

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || loading) return;
      setError(null);
      setInput("");
      setShowRecent(false);
      const next: Msg[] = [...messagesRef.current, { id: uid(), role: "user", content: q }];
      setMessages(next);
      setLoading(true);
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: next.map((m) => ({ role: m.role, content: m.content })),
            screen: { path: pathname },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "Something went wrong. Please try again.");
        } else {
          setMessages((m) => [
            ...m,
            {
              // Wave D: adopt the server's assistant messageId as this message's id so
              // thumbs feedback can be attached to it; fall back to a local id if logging
              // was unavailable (the feedback endpoint tolerates an unanchored id).
              id: (typeof data?.messageId === "string" && data.messageId) || uid(),
              role: "assistant",
              content: typeof data?.reply === "string" && data.reply ? data.reply : "I don't have an answer for that yet.",
              citations: Array.isArray(data?.citations) ? data.citations : [],
              actions: Array.isArray(data?.actions) ? data.actions : [],
              grounded: !!data?.grounded,
            },
          ]);
        }
      } catch {
        setError("Network error. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [loading, pathname],
  );

  // Open-and-prime from the inline <AskCanopy> buttons.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CopilotOpenDetail>).detail ?? {};
      setOpen(true);
      setShowRecent(false);
      if (detail.prompt) {
        if (detail.send) {
          void send(detail.prompt);
        } else {
          setInput(detail.prompt);
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      } else {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    };
    window.addEventListener(COPILOT_OPEN_EVENT, handler as EventListener);
    return () => window.removeEventListener(COPILOT_OPEN_EVENT, handler as EventListener);
  }, [send]);

  async function sendFeedback(msg: Msg, rating: "up" | "down") {
    setMessages((list) => list.map((m) => (m.id === msg.id ? { ...m, feedback: rating } : m)));
    // Find the question that preceded this answer.
    const idx = messagesRef.current.findIndex((m) => m.id === msg.id);
    const question = idx > 0 ? messagesRef.current[idx - 1]?.content : "";
    try {
      // Best-effort — Wave D adds persistence. A 404 here is expected for now.
      await fetch("/api/copilot/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: msg.id, rating, question, answer: msg.content, screen: { path: pathname } }),
      });
    } catch {
      /* fail silently */
    }
  }

  function navigate(href: string) {
    setOpen(false);
    try {
      router.push(href);
    } catch {
      window.location.href = href;
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      {/* Persistent launcher (collapsed state) — inviting, always labeled, gentle pulse */}
      {!open ? (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Open Ask Canopy"
          // Mobile: a compact icon-only bubble tucked in the corner so it never sits
          // on top of a primary Submit/Save action (sticky bars reserve right-side
          // clearance via .copilot-safe-actions; scroll content clears it via the
          // global bottom padding on .app-main). Desktop keeps the labeled pill.
          className="group fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex items-center justify-center gap-0 md:gap-2 rounded-full bg-emerald-grad p-3 md:px-4 md:py-3 text-sm font-medium text-white shadow-lg shadow-emerald-900/30 hover:brightness-105 hover:-translate-y-0.5 transition-[filter,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b3d20] print:hidden"
        >
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-mint motion-safe:[animation:canopy-invite_2.8s_ease-in-out_infinite]"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/canopyos-icon.png" alt="" className="relative h-5 w-5" />
          </span>
          <span className="hidden md:inline">Ask Canopy</span>
        </button>
      ) : null}

      {/* Docked panel (desktop) / full-screen sheet (mobile) */}
      {open ? (
        <div className="fixed inset-0 z-50 md:inset-auto md:top-0 md:right-0 md:h-full md:w-[480px]" role="complementary" aria-label="Canopy Copilot">
          {/* Backdrop — phones only (the docked desktop panel coexists with the page). */}
          <div className="absolute inset-0 bg-black/40 md:hidden" onClick={close} aria-hidden="true" />

          <div
            ref={panelRef}
            tabIndex={-1}
            className="surface-light absolute inset-0 md:inset-auto md:h-full md:w-[480px] flex flex-col overflow-hidden border-line bg-white shadow-2xl shadow-emerald-900/30 outline-none md:border-l motion-safe:animate-[canopy-slide_180ms_ease-out]"
          >
            {/* Header (forest chrome) */}
            <div className="flex items-center gap-2.5 bg-forest-grad px-4 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/canopyos-icon.png" alt="" className="h-6 w-6" />
              <div className="leading-tight">
                <div className="text-sm font-medium text-white">Canopy Copilot</div>
                <div className="text-[11px] text-mint">Grounded in your Clements playbook</div>
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={startNew}
                  aria-label="New conversation"
                  title="New conversation"
                  className="rounded-lg p-1.5 text-mint hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRecent((v) => !v)}
                  aria-label="Recent conversations"
                  aria-expanded={showRecent}
                  title="Recent"
                  className={`rounded-lg p-1.5 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${showRecent ? "bg-white/10 text-white" : "text-mint"}`}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 8v4l3 2M21 12a9 9 0 11-9-9 9 9 0 019 9z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Collapse to bubble"
                  title="Collapse"
                  className="rounded-lg p-1.5 text-mint hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {/* Collapse: a chevrons-right that reads as "tuck the sidebar away" */}
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 6l6 6-6 6M14 6l6 6-6 6" /></svg>
                </button>
              </div>
            </div>

            {/* Context chip */}
            <div className="flex items-center gap-2 border-b border-line bg-[#f7faf8] px-3 py-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 21s-7-4.5-7-10a7 7 0 0114 0c0 5.5-7 10-7 10z" />
                  <circle cx="12" cy="11" r="2.5" />
                </svg>
                On screen: {onScreen}
              </span>
            </div>

            {/* Body */}
            {showRecent ? (
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent conversations</div>
                {recent.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[13px] text-muted">No past conversations yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {recent.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => loadRecent(c)}
                          className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-left hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          <div className="truncate text-[13px] font-medium text-ink">{c.title}</div>
                          <div className="text-[11px] text-muted">
                            {c.messages.length} message{c.messages.length === 1 ? "" : "s"} · {new Date(c.updatedAt).toLocaleDateString()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {empty ? (
                  <div className="px-1 py-4">
                    <div className="flex items-center gap-2.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest-grad">
                        <img src="/canopyos-icon.png" alt="" className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-[15px] font-light text-ink">{greeting(firstName)}</p>
                        <p className="text-[12px] text-muted">What can I help you get done?</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-muted">
                      Ask me about any workflow, policy, or your branch&rsquo;s numbers — I&rsquo;m grounded in the Clements manual, handbook, SOPs, and your live data.
                    </p>
                    <div className="mt-4 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Try one of these</div>
                    <div className="space-y-2">
                      {prompts.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => send(s)}
                          className="group flex w-full items-center gap-3 rounded-xl border border-line bg-gradient-to-b from-white to-[#f7faf8] px-3 py-3 text-left text-[13px] text-ink shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L12 13.9 7.8 16l.8-4.7L5.2 8l4.7-.7z" />
                            </svg>
                          </span>
                          <span className="flex-1 leading-snug">{s}</span>
                          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f2] px-2 py-0.5 text-[10.5px] text-muted">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2z" /></svg>
                        Cites its sources
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f5f2] px-2 py-0.5 text-[10.5px] text-muted">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                        You approve before anything is saved
                      </span>
                    </div>
                  </div>
                ) : (
                  messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-emerald-grad px-3 py-2 text-[13px] text-white">{m.content}</div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex flex-col items-start gap-1.5">
                        <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-2 text-[13px] text-ink">
                          <Markdown text={m.content} />
                        </div>
                        {m.citations && m.citations.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {m.citations.map((c, ci) => (
                              <button
                                key={ci}
                                type="button"
                                onClick={() => navigate(c.href)}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                title={c.section ? `${c.title} · ${c.section}` : c.title}
                              >
                                <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M4 5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
                                </svg>
                                <span className="truncate">{c.title}{c.section ? ` · ${c.section}` : ""}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {m.actions && m.actions.length > 0 ? (
                          <div className="w-[92%] space-y-1.5">
                            {m.actions.map((a, ai) => (
                              <ActionCard key={ai} action={a} onNavigate={navigate} />
                            ))}
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1 pl-1">
                          <button
                            type="button"
                            onClick={() => sendFeedback(m, "up")}
                            aria-label="Helpful"
                            aria-pressed={m.feedback === "up"}
                            className={`rounded-md p-1 hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${m.feedback === "up" ? "text-brand-600" : "text-muted"}`}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={m.feedback === "up" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M7 10v11H4a1 1 0 01-1-1v-9a1 1 0 011-1h3zm0 0l4-7a2 2 0 012 2v3h5a2 2 0 012 2.3l-1.3 7A2 2 0 0117.7 21H7" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => sendFeedback(m, "down")}
                            aria-label="Not helpful"
                            aria-pressed={m.feedback === "down"}
                            className={`rounded-md p-1 hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${m.feedback === "down" ? "text-red-600" : "text-muted"}`}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={m.feedback === "down" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M17 14V3h3a1 1 0 011 1v9a1 1 0 01-1 1h-3zm0 0l-4 7a2 2 0 01-2-2v-3H6a2 2 0 01-2-2.3l1.3-7A2 2 0 016.3 3H17" />
                            </svg>
                          </button>
                          {m.feedback ? <span className="text-[11px] text-muted">Thanks for the feedback</span> : null}
                        </div>
                      </div>
                    ),
                  )
                )}
                {loading ? (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm border border-line bg-white px-3 py-2 text-[13px] text-muted">
                      <span className="inline-flex items-center gap-2"><Spinner /> Thinking&hellip;</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {error ? <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div> : null}

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-end gap-2 border-t border-line bg-[#f7faf8] px-2.5 py-2.5"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={3}
                placeholder="Ask about a workflow, policy, or your numbers…"
                aria-label="Ask Canopy Copilot"
                className="max-h-48 min-h-[68px] flex-1 resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-xl bg-emerald-grad px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7faf8]"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---- Action cards --------------------------------------------------------- //

function ActionCard({ action, onNavigate }: { action: CopilotAction; onNavigate: (href: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  if (action.kind === "link" && action.href) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(action.href!)}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-grad px-3 py-2 text-[13px] font-medium text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        {action.label}
      </button>
    );
  }

  if (action.kind !== "confirm") return null;

  async function runConfirm() {
    if (!action.endpoint) return;
    setStatus("busy");
    setMsg(null);
    try {
      const res = await fetch(action.endpoint, {
        method: action.method || "POST",
        headers: { "content-type": "application/json" },
        body: action.params ? JSON.stringify(action.params) : undefined,
      });
      if (res.ok) {
        setStatus("done");
        setMsg("Done.");
      } else {
        const data = await res.json().catch(() => null);
        setStatus("error");
        setMsg(data?.error ?? "That didn't go through. Try the full screen.");
      }
    } catch {
      setStatus("error");
      setMsg("Network error — please try again.");
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-600" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 12l2 2 4-4m-2-6l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z" />
        </svg>
        {action.label}
      </div>
      {action.confirmNote && (!confirming || status === "idle") ? (
        <p className="mt-1 text-[12px] text-muted">{action.confirmNote}</p>
      ) : null}
      {status === "done" ? (
        <p className="mt-1.5 text-[12px] text-brand-700">{msg}</p>
      ) : status === "error" ? (
        <p className="mt-1.5 text-[12px] text-red-700">{msg}</p>
      ) : !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 rounded-lg border border-[#cfe0d6] bg-white px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Review &amp; confirm
        </button>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={runConfirm}
            disabled={status === "busy"}
            className="rounded-lg bg-emerald-grad px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {status === "busy" ? "Working…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={status === "busy"}
            className="rounded-lg px-2.5 py-1.5 text-[13px] text-muted hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---- Small helpers -------------------------------------------------------- //

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 motion-safe:animate-spin text-brand-500" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

// Minimal markdown: paragraphs, **bold**, and - / * bullet lists. (Mirrors the
// prior InsightsWidget renderer so answers read the same.)
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
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
