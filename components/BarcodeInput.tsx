"use client";
// Scanning control. Two ways to scan, neither of which looks like a search box:
//   1. "Scan barcode" button → opens the device camera and reads the barcode.
//   2. "Type code" → reveals a text field, which also accepts a USB/Bluetooth
//      HID scanner (it "types" the code + Enter) if one is ever added.
import { useEffect, useRef, useState } from "react";
import CameraScanner, { cameraScanSupported } from "./CameraScanner";

export default function BarcodeInput({
  onScan,
  placeholder = "Type barcode / SKU, then Enter",
  autoFocus = false,
  className = "",
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(autoFocus);
  const [supported, setSupported] = useState<boolean | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSupported(cameraScanSupported());
  }, []);
  useEffect(() => {
    if (typing) ref.current?.focus();
  }, [typing]);

  return (
    <div className={className}>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1 text-base"
          onClick={() => setScanning(true)}
        >
          📷 Scan barcode
        </button>
        <button
          type="button"
          className="btn-secondary whitespace-nowrap"
          onClick={() => setTyping((t) => !t)}
        >
          ⌨️ Type code
        </button>
      </div>

      {supported === false && (
        <p className="text-[11px] text-slate-500 mt-1">
          Camera scanning isn&apos;t available in this browser — use “Type code”, or search by name below.
        </p>
      )}

      {typing && (
        <input
          ref={ref}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={placeholder}
          className="input font-mono mt-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const code = (e.target as HTMLInputElement).value.trim();
              if (code) onScan(code);
              (e.target as HTMLInputElement).value = "";
              setTimeout(() => ref.current?.focus(), 0);
            }
          }}
        />
      )}

      {scanning && (
        <CameraScanner
          onDetected={(code) => onScan(code)}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
