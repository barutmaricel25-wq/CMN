"use client";
// THE #1 FIX: record stock pulled from 2F stockroom to store floor.
// Flow: scan → qty (defaults 1) → confirm. Under 10 seconds per item.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { pullDown } from "@/lib/actions";
import { Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

interface Pulled { product: Product; qty: number; at: string }

export default function PullDownPage() {
  const db = useDB();
  const session = useSession();
  const [pending, setPending] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [log, setLog] = useState<Pulled[]>([]);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  const branchId = session?.branch_id ?? "";
  const branch = db.branches.find((b) => b.id === branchId);
  if (!session) return null;

  if (branch && branch.has_stockroom === false) {
    return (
      <div className="card p-6 text-center">
        <div className="text-3xl mb-2">🏪</div>
        <h1 className="font-bold text-lg mb-1">{branch.name} has no 2F stockroom</h1>
        <p className="text-sm text-slate-500">
          Deliveries and incoming transfers here go straight to the store floor, so there&apos;s nothing to pull down.
          Need stock from another branch? Use <b>More → 🔁 Branch Transfers</b>.
        </p>
      </div>
    );
  }

  const srQty = (pid: string) =>
    db.inventory.find((i) => i.branch_id === branchId && i.product_id === pid && i.location === "stockroom")?.qty ?? 0;

  function pick(p: Product) {
    setPending(p);
    setQty(1);
    setMsg("");
    setSearch("");
  }

  function onScan(code: string) {
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ No product for “${code}”`); return; }
    // Rapid re-scan of the same item = +1 and auto-confirm previous
    if (pending && pending.id === p.id) { setQty((q) => q + 1); return; }
    if (pending) confirm(pending, qty);
    pick(p);
  }

  function confirm(p: Product, n: number) {
    pullDown(p.id, branchId, n, session!.user_id);
    setLog((l) => [{ product: p, qty: n, at: new Date().toLocaleTimeString() }, ...l].slice(0, 30));
    setPending(null);
    setMsg(`✅ ${n} × ${p.name} → store floor`);
  }

  const results = search.trim().length >= 2
    ? db.products.filter((p) => p.active && (p.name.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase()))).slice(0, 6)
    : [];

  return (
    <div className="space-y-3">
      <div className="card p-4 bg-orange-50 border-orange-200">
        <h1 className="font-bold text-lg">⬇️ Pull Down — 2F Stockroom → Store Floor</h1>
        <p className="text-sm text-slate-600">Scan each item you carry downstairs. That&apos;s it — the movement is recorded with your name and time.</p>
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={onScan} placeholder="Scan item being pulled down…" />
        <input className="input" placeholder="No barcode? Search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {results.map((p) => (
          <button key={p.id} className="btn-secondary w-full justify-between" onClick={() => pick(p)}>
            <span className="text-sm truncate">{p.name} {p.size_variant}</span>
            <span className="text-xs text-slate-400">2F: {srQty(p.id)}</span>
          </button>
        ))}
        {msg && <p className="text-sm font-semibold">{msg}</p>}
      </div>

      {pending && (
        <div className="card p-4 border-orange-400 border-2">
          <div className="font-bold">{pending.name} <span className="text-slate-400 font-normal">{pending.size_variant}</span></div>
          <div className="text-xs text-slate-500 mb-3">
            In stockroom: {srQty(pending.id)}
            {qty > srQty(pending.id) && <span className="text-red-600 font-bold ml-1">⚠ pulling more than recorded 2F stock</span>}
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary text-2xl !px-6" onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
            <input
              className="input text-center text-2xl font-extrabold w-24"
              type="number" inputMode="numeric" value={qty}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button className="btn-secondary text-2xl !px-6" onClick={() => setQty(qty + 1)}>+</button>
            <button className="btn-primary flex-1 text-base" onClick={() => confirm(pending, qty)}>✓ Confirm</button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Tip: scanning the same barcode again adds +1. Scanning a different item auto-confirms this one.</p>
        </div>
      )}

      {log.length > 0 && (
        <div className="card p-3">
          <h2 className="font-bold text-sm mb-2">This session</h2>
          <ul className="divide-y divide-slate-100">
            {log.map((l, i) => (
              <li key={i} className="py-1.5 text-sm flex justify-between">
                <span className="truncate mr-2">{l.qty} × {l.product.name}</span>
                <span className="text-xs text-slate-400 whitespace-nowrap">{l.at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
