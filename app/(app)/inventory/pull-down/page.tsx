"use client";
// THE #1 FIX: record stock moved onto this branch's store floor.
// Source is either this branch's 2F stockroom (classic pull-down) or ANOTHER
// branch (quick pull, e.g. Main Branch → Unit 16) — every entry shows from → to.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { pullDown, quickPull } from "@/lib/actions";
import { Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import { matchesSearch, searchScore, compareByBrand } from "@/lib/util";

interface Pulled { product: Product; qty: number; at: string; sourceLabel: string }

export default function PullDownPage() {
  const db = useDB();
  const session = useSession();
  const [source, setSource] = useState<string>(""); // "" = own stockroom, else branch id
  const [pending, setPending] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [log, setLog] = useState<Pulled[]>([]);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");

  const branchId = session?.branch_id ?? "";
  const branch = db.branches.find((b) => b.id === branchId);
  if (!session || !branch) return null;

  const hasOwnStockroom = branch.has_stockroom !== false;
  // Default source: own stockroom if it exists, otherwise force branch pick.
  const effectiveSource = source || (hasOwnStockroom ? "own" : "");
  const sourceBranch = effectiveSource !== "own" && effectiveSource ? db.branches.find((b) => b.id === effectiveSource) : null;
  const sourceLabel = effectiveSource === "own" ? `${branch.name} 2F Stockroom` : sourceBranch ? sourceBranch.name : "";
  const destLabel = `${branch.name} Store Floor`;

  // Available qty at the selected source
  const sourceQty = (pid: string) => {
    if (effectiveSource === "own")
      return db.inventory.find((i) => i.branch_id === branchId && i.product_id === pid && i.location === "stockroom")?.qty ?? 0;
    if (!sourceBranch) return 0;
    const loc = sourceBranch.has_stockroom === false ? "storefront" : "stockroom";
    return db.inventory.find((i) => i.branch_id === sourceBranch.id && i.product_id === pid && i.location === loc)?.qty ?? 0;
  };

  function pick(p: Product) {
    setPending(p);
    setQty(1);
    setMsg("");
    setSearch("");
  }

  function onScan(code: string) {
    if (!effectiveSource) { setMsg("⚠ Pick where the stock is coming from first."); return; }
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ No product for “${code}”`); return; }
    if (pending && pending.id === p.id) { setQty((q) => q + 1); return; }
    if (pending) confirm(pending, qty);
    pick(p);
  }

  function confirm(p: Product, n: number) {
    if (effectiveSource === "own") {
      pullDown(p.id, branchId, n, session!.user_id);
    } else if (sourceBranch) {
      quickPull(sourceBranch.id, branchId, p.id, n, session!.user_id);
    }
    setLog((l) => [{ product: p, qty: n, at: new Date().toLocaleTimeString(), sourceLabel }, ...l].slice(0, 30));
    setPending(null);
    setMsg(`✅ ${n} × ${p.name} — ${sourceLabel} → ${destLabel}`);
  }

  const results = search.trim().length >= 2
    ? db.products
        .filter((p) => p.active && matchesSearch(p, search))
        // Closest match first, not whatever sorts earliest.
        .sort((a, b) => searchScore(a, search) - searchScore(b, search) || compareByBrand(a, b))
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-3">
      <div className="card p-4 bg-orange-50 border-orange-200">
        <h1 className="font-bold text-lg">⬇️ Pull Down / Get Stock</h1>
        <p className="text-sm text-slate-600">Scan each item you bring to the store floor. Who, what, from where — recorded automatically.</p>
      </div>

      {/* Source picker */}
      <div className="card p-3">
        <div className="label">Where is the stock coming from?</div>
        <div className="grid grid-cols-2 gap-2">
          {hasOwnStockroom && (
            <button
              className={`btn justify-start text-left ${effectiveSource === "own" ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`}
              onClick={() => setSource("own")}
            >
              🏢 2F Stockroom (here)
            </button>
          )}
          {db.branches
            .filter((b) => b.active && b.id !== branchId)
            .map((b) => (
              <button
                key={b.id}
                className={`btn justify-start text-left ${effectiveSource === b.id ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`}
                onClick={() => setSource(b.id)}
              >
                🔁 {b.name}
              </button>
            ))}
        </div>
        {effectiveSource ? (
          <p className="text-sm font-semibold text-orange-800 mt-2">
            📦 {sourceLabel} <span className="text-slate-400">→</span> {destLabel}
          </p>
        ) : (
          <p className="text-sm text-slate-500 mt-2">
            {branch.name} has no 2F stockroom — choose which branch you&apos;re getting stock from.
          </p>
        )}
        {sourceBranch && (
          <p className="text-xs text-slate-500 mt-1">
            This records an instant branch transfer — {sourceBranch.name}&apos;s stock goes down, yours goes up, visible in both ledgers.
          </p>
        )}
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={onScan} placeholder="Type barcode / SKU, then Enter" />
        <input className="input" placeholder="No barcode? Search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {results.map((p) => (
          <button key={p.id} className="btn-secondary w-full justify-between" onClick={() => { if (effectiveSource) pick(p); else setMsg("⚠ Pick the stock source first."); }}>
            <span className="text-sm truncate">{p.name} {p.size_variant}</span>
            <span className="text-xs text-slate-400">at source: {sourceQty(p.id)}</span>
          </button>
        ))}
        {msg && <p className="text-sm font-semibold">{msg}</p>}
      </div>

      {pending && (
        <div className="card p-4 border-orange-400 border-2">
          <div className="font-bold">{pending.name} <span className="text-slate-400 font-normal">{pending.size_variant}</span></div>
          <div className="text-xs text-slate-500 mb-1">
            {sourceLabel} <span className="text-slate-300">→</span> {destLabel}
          </div>
          <div className="text-xs text-slate-500 mb-3">
            Available at source: {sourceQty(pending.id)}
            {qty > sourceQty(pending.id) && <span className="text-red-600 font-bold ml-1">⚠ more than recorded stock at source</span>}
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
              <li key={i} className="py-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="truncate mr-2">{l.qty} × {l.product.name}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{l.at}</span>
                </div>
                <div className="text-xs text-slate-500">{l.sourceLabel} → {destLabel}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
