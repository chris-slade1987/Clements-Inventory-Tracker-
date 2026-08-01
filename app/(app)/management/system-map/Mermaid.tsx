"use client";

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let counter = 0;

/**
 * Renders a mermaid diagram definition to inline SVG. Theme-aware (follows the
 * viewer's light/dark preference), horizontally scrollable, and guarded so a
 * bad definition shows a message instead of throwing/blanking the page.
 */
export default function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return;

    const prefersDark =
      typeof window !== "undefined" &&
      (document.documentElement.dataset.theme === "dark" ||
        window.matchMedia?.("(prefers-color-scheme: dark)").matches);

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: prefersDark ? "dark" : "default",
        securityLevel: "strict",
        fontFamily: "inherit",
        themeVariables: {
          primaryColor: prefersDark ? "#064e3b" : "#ecfdf5",
          primaryBorderColor: "#059669",
          primaryTextColor: prefersDark ? "#d1fae5" : "#064e3b",
          lineColor: "#10b981",
        },
      });
    } catch {
      /* initialize is idempotent-safe; ignore */
    }

    const id = `mmd-${Date.now()}-${counter++}`;
    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Mermaid may inject a stray error node on the body — clean it up.
        document.getElementById(id)?.remove();
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div className="overflow-x-auto rounded-xl bg-white p-4">
      {error ? (
        <p className="text-sm text-red-600">Could not render diagram: {error}</p>
      ) : null}
      <div ref={ref} className="min-w-fit [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-none" />
    </div>
  );
}
