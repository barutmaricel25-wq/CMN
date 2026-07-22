"use client";
// Scanner-friendly input: HID keyboard-wedge scanners "type" the code + Enter.
// Auto-focus, Enter submits, clears + refocuses after each scan.
import { useEffect, useRef } from "react";

export default function BarcodeInput({
  onScan,
  placeholder = "Scan barcode or type + Enter",
  autoFocus = true,
  className = "",
}: {
  onScan: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
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
      className={`input font-mono ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const code = (e.target as HTMLInputElement).value.trim();
          if (code) onScan(code);
          (e.target as HTMLInputElement).value = "";
          // Refocus so back-to-back scans just work.
          setTimeout(() => ref.current?.focus(), 0);
        }
      }}
    />
  );
}
