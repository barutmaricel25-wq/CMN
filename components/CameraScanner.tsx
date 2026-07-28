"use client";
// Camera barcode scanner using the browser's built-in BarcodeDetector
// (available in Chrome on Android, which is what the branch tablets run).
// Stays open so several items can be scanned in a row; each hit is reported
// once, with a short cooldown so one barcode isn't counted twice.
import { useEffect, useRef, useState } from "react";

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

export function cameraScanSupported(): boolean {
  return getCtor() !== null && typeof navigator !== "undefined" && !!navigator.mediaDevices;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar", "qr_code"];

export default function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [error, setError] = useState("");
  const [lastHit, setLastHit] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("This browser can't scan with the camera. Use “Type code” or search by name.");
      return;
    }
    let stopped = false;
    let raf = 0;
    const detector = new Ctor({ formats: FORMATS });

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const tick = async () => {
          if (stopped) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2) {
            try {
              const hits = await detector.detect(v);
              const code = hits[0]?.rawValue?.trim();
              const now = Date.now();
              // Ignore the same code within 1.5s so one item isn't double-counted.
              if (code && !(lastRef.current.code === code && now - lastRef.current.at < 1500)) {
                lastRef.current = { code, at: now };
                setLastHit(code);
                setCount((c) => c + 1);
                if (navigator.vibrate) navigator.vibrate(60);
                onDetected(code);
              }
            } catch {
              // a failed frame is fine — keep scanning
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError("Camera unavailable. Allow camera access for this site, then try again."));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4">
      <div className="card w-full max-w-sm p-4">
        <h3 className="font-bold text-center mb-2">📷 Scan barcode</h3>
        {error ? (
          <p className="text-red-600 text-sm text-center py-10">{error}</p>
        ) : (
          <div className="relative">
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black aspect-[4/3] object-cover" />
            {/* Aiming guide */}
            <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-24 border-2 border-orange-400 rounded-lg pointer-events-none" />
          </div>
        )}
        <p className="text-xs text-slate-500 text-center mt-2">
          Point the camera at the barcode. Keep scanning — the window stays open.
        </p>
        {count > 0 && (
          <p className="text-sm font-semibold text-center text-orange-700 mt-1">
            ✅ {count} scanned · last: <span className="font-mono">{lastHit}</span>
          </p>
        )}
        <button className="btn-primary w-full mt-3" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
