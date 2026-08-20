"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Notification bell for the app chrome. Shows an unread-discussions badge and
 * links to the inbox. Seeded with a server-rendered count, then refreshed on a
 * light poll + when the tab regains focus and on navigation, so a new message
 * surfaces without a manual reload.
 */
export default function NotificationBell({
  initialCount = 0,
  className = "",
  layout = "icon",
}: {
  initialCount?: number;
  className?: string;
  layout?: "icon" | "row";
}) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();

  async function refresh() {
    try {
      const r = await fetch("/api/threads/unread", { cache: "no-store" });
      const d = await r.json();
      if (typeof d.count === "number") setCount(d.count);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    // Poll only while the tab is actually visible — a backgrounded tab must not
    // keep hitting the server (that multiplies serverless invocations across
    // every open tab all day). Poll every 2 min, and refresh once when the tab
    // becomes visible again or on navigation.
    let id: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (id) { clearInterval(id); id = undefined; } };
    const start = () => { stop(); if (!document.hidden) id = setInterval(refresh, 120000); };
    const onVis = () => { if (document.hidden) stop(); else { refresh(); start(); } };
    if (!document.hidden) refresh();
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const icon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16v12H8l-4 4V4z" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );

  if (layout === "row") {
    return (
      <Link
        href="/inbox"
        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-light transition-colors text-mint hover:bg-white/5 hover:text-white ${className}`}
      >
        {icon}
        Messages
        {count > 0 ? (
          <span className="ml-auto min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-red-500 text-[10px] font-semibold text-white tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <Link
      href="/inbox"
      aria-label={count > 0 ? `Messages — ${count} unread` : "Messages"}
      className={`relative inline-flex items-center justify-center h-6 w-6 text-mint hover:text-white ${className}`}
    >
      {icon}
      {count > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 grid place-items-center rounded-full bg-red-500 text-[10px] font-semibold text-white tabular-nums">
          {count > 9 ? "9+" : count}
        </span>
      ) : null}
    </Link>
  );
}
