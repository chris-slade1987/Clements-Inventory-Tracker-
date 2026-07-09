"use client";

import { useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";

/**
 * Camera barcode scanner. Uses the native BarcodeDetector when available
 * (Android Chrome), otherwise falls back to ZXing (loaded dynamically so it
 * never bloats the initial bundle). Calls onDetected with the raw code and
 * closes. Degrades to a clear message if no camera is available.
 */
export default function BarcodeScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    let raf = 0;

    const finish = (code: string) => {
      if (stoppedRef.current) return;
      stoppedRef.current = true;
      onDetected(code);
    };

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera not available on this device.");
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

        // Prefer the native detector where present.
        const AnyWindow = window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
          };
        };
        if (AnyWindow.BarcodeDetector) {
          const detector = new AnyWindow.BarcodeDetector();
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

        // Fallback: ZXing.
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) finish(result.getText());
        });
      } catch {
        setError("Couldn't access the camera. Check permissions.");
      }
    }

    start();
    return () => {
      stoppedRef.current = true;
      if (raf) cancelAnimationFrame(raf);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

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
        <p className="mt-4 text-sm text-white/80">Point at a product barcode…</p>
      )}
      <button
        onClick={onClose}
        className={`${btn.secondary} mt-4`}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}
