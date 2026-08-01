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

// "Brand Name" display without doubling when the name already starts with the brand.
export function brandName(p: { brand: string; name: string }): string {
  if (!p.brand || p.name.toLowerCase().startsWith(p.brand.toLowerCase())) return p.name;
  return `${p.brand} ${p.name}`;
}

// Alphabetical-by-brand comparator. Products whose brand is blank or just
// punctuation (imported that way from the price list) sort to the very end by
// name instead of clustering at the top. A sort *key* cannot do this reliably —
// locale collation ignores marker characters — so compare explicitly.
function realBrand(p: { brand: string }): string {
  // Drop leading stray punctuation from the price-list import ("(symphonix)…",
  // ") Superior Care") so brands file under their actual first letter.
  const b = (p.brand || "").replace(/^[^a-z0-9]+/i, "").trim();
  return /[a-z0-9]/i.test(b) ? b.toLowerCase() : "";
}

export function compareByBrand(
  a: { brand: string; name: string },
  b: { brand: string; name: string }
): number {
  const ab = realBrand(a);
  const bb = realBrand(b);
  if (!ab !== !bb) return ab ? -1 : 1; // branded items first, blank-brand last
  return ab.localeCompare(bb) || a.name.localeCompare(b.name);
}

// ---------- Searching the catalogue ----------
// The price list shows a product as "BRAND Type" across two lines, so people
// type what they see ("aozi kitten"). Searching brand and name separately can
// never match that, so match against everything about the product at once and
// require each word typed to appear somewhere — in any order.
type Searchable = {
  name: string;
  brand: string;
  size_variant?: string;
  sku?: string;
  barcode?: string;
  category?: string;
};

const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function haystack(p: Searchable): string {
  return flatten([p.brand, p.name, p.size_variant, p.sku, p.barcode, p.category].filter(Boolean).join(" "));
}

const terms = (q: string) => flatten(q).split(" ").filter(Boolean);

export function matchesSearch(p: Searchable, q: string): boolean {
  const t = terms(q);
  if (!t.length) return true;
  const hay = haystack(p);
  return t.every((term) => hay.includes(term));
}

// Lower is a better match. Used to put the likeliest answers at the top of the
// suggestions instead of whatever happens to sort first alphabetically.
export function searchScore(p: Searchable, q: string): number {
  const t = terms(q);
  if (!t.length) return 99;
  const query = t.join(" ");
  const name = flatten(p.name);
  const brand = flatten(p.brand);
  const label = flatten(`${p.brand} ${p.name}`);
  const hay = haystack(p);

  if (flatten(p.barcode ?? "") === query || flatten(p.sku ?? "") === query) return 0;
  if (name === query || label === query) return 1;
  if (label.startsWith(query) || name.startsWith(query)) return 2;
  if (brand.startsWith(query)) return 3;
  // Every word typed starts a word in the product — "aozi kit" for "Aozi Kitten".
  const words = hay.split(" ");
  if (t.every((term) => words.some((w) => w.startsWith(term)))) return 4;
  return 5;
}

// Finding a customer works the same way: people type what they remember, in any
// order — part of the shop name and the last few digits of the number.
type SearchableCustomer = {
  name: string;
  phone?: string;
  cp_number?: string;
  address?: string;
  type?: string;
};

export function matchesCustomer(c: SearchableCustomer, q: string): boolean {
  const t = terms(q);
  if (!t.length) return true;
  // Numbers are typed as written ("0917…"), so keep digits joined up as well as
  // flattened, or a search for the last four digits would miss.
  const hay =
    flatten([c.name, c.phone, c.cp_number, c.address, c.type].filter(Boolean).join(" ")) +
    " " +
    [c.phone, c.cp_number].filter(Boolean).join(" ").replace(/[^0-9]/g, "");
  return t.every((term) => hay.includes(term));
}

// Medicines are priced by the piece, not by weight, so the last price column
// is labelled to match whichever the category is.
export function perUnitLabel(category: string): string {
  return /medicine|\bmeds?\b/i.test(category || "") ? "Per piece" : "Per kilo";
}

// Products imported without a printed barcode get an internal code so the app
// still has something unique to scan against. They aren't real barcodes, so
// they're not worth showing to staff.
export function isInternalBarcode(code: string): boolean {
  const n = parseInt(code, 10);
  return Number.isFinite(n) && n >= 2000000000000 && n < 2000001000000;
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
