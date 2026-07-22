// Shared helpers: money (centavos), Manila time, CSV, geo, ids.

export function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function peso(centavos: number): string {
  const v = centavos / 100;
  return (
    "₱" +
    v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

// Parse a peso amount string ("1,234.50") to centavos.
export function toCentavos(s: string | number): number {
  const n = typeof s === "number" ? s : parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

const MANILA = "Asia/Manila";

export function manilaNow(): Date {
  return new Date();
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    timeZone: MANILA,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: MANILA,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", {
    timeZone: MANILA,
    hour: "numeric",
    minute: "2-digit",
  });
}

// Manila calendar date "YYYY-MM-DD" for an ISO timestamp (or now).
export function manilaDateKey(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-CA", { timeZone: MANILA });
}

export function daysAgoKey(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: MANILA });
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function toCSV(rows: (string | number)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = String(c ?? "");
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(",")
    )
    .join("\n");
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const blob = new Blob(["﻿" + toCSV(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Minimal CSV parser handling quoted fields.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// Compress an image File/dataURL to a small JPEG data URL (demo storage is localStorage).
export function compressImage(src: File | string, maxDim = 320, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    if (typeof src === "string") img.src = src;
    else img.src = URL.createObjectURL(src);
  });
}
