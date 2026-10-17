"use client";

// Last-resort error boundary — catches errors in the ROOT layout, so it must
// render its own <html>/<body>. The global stylesheet is replaced here, so the
// branding is inlined to stay bulletproof even when the CSS pipeline is the thing
// that failed. Forest ground + the real wordmark + a reload.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          textAlign: "center",
          fontFamily: '"Helvetica Neue", Arial, Helvetica, system-ui, sans-serif',
          fontWeight: 300,
          color: "#EEF4F0",
          background:
            "radial-gradient(1100px 640px at 90% -15%, rgba(116,169,110,0.1), transparent 62%), linear-gradient(168deg,#12492B 0%,#0B3D20 45%,#061F11 100%)",
          backgroundColor: "#0B3D20",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 360 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" style={{ height: 36, width: "auto" }} />
          <h1 style={{ marginTop: 24, marginBottom: 0, fontSize: 20, fontWeight: 300, color: "#fff" }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: 6, fontSize: 14, color: "#A7BDB0" }}>
            CanopyOS hit an unexpected error. Please try again.
          </p>
          {error?.digest ? (
            <p style={{ marginTop: 6, fontSize: 11, color: "rgba(167,189,176,0.8)" }}>Reference: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              cursor: "pointer",
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              color: "#fff",
              backgroundImage: "linear-gradient(150deg,#2E6F47 0%,#1F5836 55%,#0B3D20 100%)",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
