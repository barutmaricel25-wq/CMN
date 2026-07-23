"use client";
// Price Check — fast counter lookup. Scan or type; see retail/wholesale/suki
// prices in large text. Available to everyone (staff included, read-only).
import { useState } from "react";
import { useDB } from "@/lib/store";
import { peso, brandName } from "@/lib/util";
import { CATEGORIES, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

export default function PriceCheckPage() {
  const db = useDB();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [scanned, setScanned] = useState<Product | null>(null);

  const term = q.trim().toLowerCase();
  const results =
    term.length >= 1 || cat
      ? db.products
          .filter((p) => p.active)
          .filter((p) => !cat || p.category === cat)
          .filter(
            (p) =>
              !term ||
              p.name.toLowerCase().includes(term) ||
              p.brand.toLowerCase().includes(term) ||
              p.barcode.includes(term) ||
              p.sku.toLowerCase().includes(term)
          )
          .slice(0, 60)
      : [];

  function onScan(code: string) {
    const p = db.products.find(
      (x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase())
    );
    if (p) {
      setScanned(p);
      setQ("");
    } else {
      setScanned(null);
      setQ(code); // fall back to text search
    }
  }

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      <h1 className="font-bold text-lg">💵 Price Check</h1>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={onScan} placeholder="🔍 Scan barcode or type name…" />
        <div className="flex gap-2">
          <input
            className="input flex-1 text-base"
            placeholder="Search by name / brand / SKU…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setScanned(null); }}
            autoFocus
          />
          <select className="input w-40" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Big card for a scanned/selected item */}
      {scanned && <BigPrice p={scanned} />}

      {/* Result list */}
      {!scanned && results.map((p) => (
        <button
          key={p.id}
          className="card w-full text-left p-3 hover:border-orange-400 active:scale-[0.99]"
          onClick={() => setScanned(p)}
        >
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">{brandName(p)} <span className="text-slate-400 font-normal">{p.size_variant}</span></div>
              <div className="text-xs text-slate-500">{p.category} · {p.sku}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-extrabold text-orange-700 tabular-nums leading-none">{peso(p.retail_price)}</div>
              <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                WS {peso(p.wholesale_price)} · Suki {p.suki_price ? peso(p.suki_price) : "—"}
              </div>
            </div>
          </div>
        </button>
      ))}

      {!scanned && term.length === 0 && !cat && (
        <div className="card p-8 text-center text-slate-400">
          <div className="text-4xl mb-2">🏷️</div>
          Scan an item or type a name to see its price.
        </div>
      )}
      {!scanned && (term.length >= 1 || cat) && results.length === 0 && (
        <div className="card p-8 text-center text-slate-400">No product found.</div>
      )}
    </div>
  );
}

function BigPrice({ p }: { p: Product }) {
  const db = useDB();
  // Total on-hand across the current context is not branch-specific here;
  // show catalog prices big. Stock check lives on the Stock screen.
  void db;
  return (
    <div className="card p-5 border-2 border-orange-300">
      <div className="text-xl font-bold">{brandName(p)}</div>
      <div className="text-sm text-slate-500 mb-4">{p.size_variant} · {p.category} · {p.sku} · {p.barcode}</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Retail</div>
          <div className="text-2xl font-extrabold text-orange-800 tabular-nums leading-tight mt-1">{peso(p.retail_price)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Wholesale</div>
          <div className="text-2xl font-extrabold text-slate-800 tabular-nums leading-tight mt-1">{peso(p.wholesale_price)}</div>
        </div>
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Suki</div>
          <div className="text-2xl font-extrabold text-amber-800 tabular-nums leading-tight mt-1">{p.suki_price ? peso(p.suki_price) : "—"}</div>
        </div>
      </div>
    </div>
  );
}
