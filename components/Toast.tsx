"use client";

// Shared Toast primitive for the CanopyOS shell. A single provider mounts one
// polite live-region viewport; any client component calls `useToast()` to push a
// transient confirmation ("Saved", "Sent to HR", …). Brand chrome: a white card
// on the light canvas with a semantic left rule. This pass only makes the
// primitive available — existing inline messages are left in place.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastInput = { message: string; tone?: ToastTone; duration?: number };

type ToastContextValue = {
  /** Push a toast; returns its id so it can be dismissed early. */
  toast: (input: ToastInput | string) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<ToastTone, { rule: string; icon: ReactNode }> = {
  success: {
    rule: "#1F7A45",
    icon: <path d="M20 6L9 17l-5-5" />,
  },
  error: {
    rule: "#DC2626",
    icon: <path d="M12 8v5m0 3h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />,
  },
  info: {
    rule: "#2E6F47",
    icon: <path d="M12 16v-5m0-3h.01M12 3a9 9 0 100 18 9 9 0 000-18z" />,
  },
};

let counter = 0;

/**
 * Wrap a client tree in <ToastProvider> to enable useToast(). Safe to mount
 * anywhere; renders a fixed, dismissible viewport that honors reduced motion.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput | string) => {
      const opts = typeof input === "string" ? { message: input } : input;
      const id = ++counter;
      const tone = opts.tone ?? "success";
      setToasts((list) => [...list, { id, message: opts.message, tone }]);
      const duration = opts.duration ?? 4000;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-24 md:pb-6"
        role="region"
        aria-label="Notifications"
      >
        <div aria-live="polite" aria-atomic="false" className="flex w-full max-w-sm flex-col items-stretch gap-2">
          {toasts.map((t) => {
            const tone = TONE[t.tone];
            return (
              <div
                key={t.id}
                role={t.tone === "error" ? "alert" : "status"}
                className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink shadow-[0_1px_2px_rgba(8,37,24,0.04),0_14px_30px_-22px_rgba(8,37,24,0.5)] motion-safe:animate-[toast-in_180ms_ease-out]"
                style={{ borderLeft: `3px solid ${tone.rule}` }}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 h-5 w-5 shrink-0"
                  fill="none"
                  stroke={tone.rule}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {tone.icon}
                </svg>
                <span className="min-w-0 flex-1">{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-lg p-1 text-muted hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Access the toast dispatcher. Must be called inside a <ToastProvider>; throws
 * otherwise so a missing provider is caught in development.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
