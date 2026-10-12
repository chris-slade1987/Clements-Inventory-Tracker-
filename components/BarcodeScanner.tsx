"use client";

import { useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";

// Barcode symbologies we ask the native BarcodeDetector for. ZXing (the iOS
// fallback) auto-detects these and more.
const FORMATS = ["upc_a", "upc_e", "ean_13", "ean_8", "code_128", "qr_code"];

// Debounce window for duplicate reads of the same code.
const DUPLICATE_MS = 1500;

/**
 * Camera barcode scanner. Uses the native BarcodeDetector when available
 * (Android Chrome), otherwise falls back to ZXing (loaded dynamically so it
 * never bloats the initial bundle). Calls onDetected with the raw code and
 * closes. Degrades to a clear message if no camera is available.
 *
 * Optional props EXTEND the scanner without affecting existing callers:
 *  - onPhoto: adds a "Take photo instead" button that captures the current frame
 *    as a downscaled JPEG File (for AI identify).
 *  - onSearchInstead: adds a "Search catalog instead" action (also shown when
 *    camera permission is denied).
 *  - onPermissionDenied: called once if the camera can't be accessed.
 */
export default function BarcodeScanner({
  onDetected,
  onClose,
  onPhoto,
  onSearchInstead,
  onPermissionDenied,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
  onPhoto?: (file: File) => void;
  onSearchInstead?: () => void;
  onPermissionDenied?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const stoppedRef = useRef(false);
  const lastReadRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  useEffect(() => {
    stoppedRef.current = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    let raf = 0;

    const finish = (code: string) => {
      if (stoppedRef.current) return;
      const trimmed = code.trim();
      if (!trimmed) return;
      // Debounce duplicate reads of the same code.
      const now = Date.now();
      if (trimmed === lastReadRef.current.code && now - lastReadRef.current.at < DUPLICATE_MS) return;
      lastReadRef.current = { code: trimmed, at: now };
      stoppedRef.current = true;
      // Light haptic / audible confirmation.
      try {
        navigator.vibrate?.(30);
      } catch {
        /* unsupported */
      }
      onDetected(trimmed);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera not available on this device.");
        onPermissionDenied?.();
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const AnyWindow = window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
          };
        };
        if (AnyWindow.BarcodeDetector) {
          const detector = new AnyWindow.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (stoppedRef.current || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes[0]?.rawValue) return finish(codes[0].rawValue);
            } catch {
              /* transient frame errors are fine */
            }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          return;
        }

        // Fallback: ZXing (covers iOS Safari + the remaining symbologies).
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) finish(result.getText());
        });
      } catch {
        setError("Couldn't access the camera. Check permissions.");
        onPermissionDenied?.();
      }
    }

    start();
    return () => {
      stoppedRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDetected]);

  // Capture the current video frame as a downscaled (≤1280px) JPEG File.
  function capturePhoto() {
    if (!onPhoto) return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stoppedRef.current = true;
        onPhoto(new File([blob], "product.jpg", { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.8,
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl overflow-hidden bg-black relative">
        <video
          ref={videoRef}
          className="w-full aspect-square object-cover"
          muted
          playsInline
        />
        {/* Aiming frame */}
        <div className="pointer-events-none absolute inset-8 border-2 border-white/80 rounded-xl" />
      </div>
      {error ? (
        <p className="mt-4 text-sm text-white text-center max-w-xs">{error}</p>
      ) : (
        <p className="mt-4 text-sm text-white/80">Point at a product barcode or shelf QR…</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {onPhoto && ready && !error ? (
          <button onClick={capturePhoto} className={btn.primary} type="button">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 7h3l2-2h6l2 2h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            Take photo instead
          </button>
        ) : null}
        {onSearchInstead ? (
          <button onClick={onSearchInstead} className={btn.secondary} type="button">
            Search catalog instead
          </button>
        ) : null}
        <button onClick={onClose} className={btn.secondary} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
