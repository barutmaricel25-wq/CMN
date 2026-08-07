"use client";
// Stock count: scan-based OR type-the-quantity, with search/category add for
// items that have no barcode (cages, leashes, strollers, toys…).
// Only items you actually count are corrected — everything else is untouched.
import { useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { adjustStock } from "@/lib/actions";
import { peso, brandName } from "@/lib/util";
import { CATEGORIES, categoriesOf, Location, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import PinModal from "@/components/PinModal";

// null = on the count sheet but not counted yet (safe: never adjusted).
type Counts = Record<string, number | null>;

export default function StockCountPage() {
  const db = useDB();
  const session = useSession();
  const [location, setLocation] = useState<Location>("storefront");
  const [counts, setCounts] = useState<Counts>({});
  const [pin, setPin] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");

  const categories = useMemo(() => {
    const used = categoriesOf(db.products.filter((p) => p.active));
    return used.length ? used : [...CATEGORIES];
  }, [db.products]);

  const branchId = session?.branch_id ?? "";
  const branch = db.branches.find((b) => b.id === branchId);
  const hasStockroom = branch?.has_stockroom !== false;

  const systemQty = (pid: string) =>
    db.inventory.find((i) => i.branch_id === branchId && i.product_id === pid && i.location === location)?.qty ?? 0;

  // Search results for adding items by name (no barcode needed).
  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2 && !cat) return [];
    return db.products
      .filter((p) => p.active)
      .filter((p) => !cat || p.category === cat)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.brand.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
      .filter((p) => !(p.id in counts))
      .slice(0, 40);
  }, [db.products, search, cat, counts]);

  if (!session) return null;

  function addToSheet(p: Product, initial: number | null = null) {
    setCounts((c) => ({ ...c, [p.id]: initial }));
    setMsg(`➕ ${p.name} added to the count sheet`);
  }

  function onScan(code: string) {
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ Unknown barcode “${code}”`); return; }
    setCounts((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }));
    setMsg(`✅ ${p.name}: ${(counts[p.id] ?? 0) + 1}`);
  }

  const rows = Object.keys(counts).map((pid) => {
    const p = db.products.find((x) => x.id === pid)!;
    const counted = counts[pid];
    const system = systemQty(pid);
    return { p, counted, system, diff: counted === null ? null : counted - system };
  });
  const pending = rows.filter((r) => r.counted === null);
  const diffs = rows.filter((r) => r.diff !== null && r.diff !== 0);
  const matched = rows.filter((r) => r.diff === 0);

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">
        🔢 Stock Count — {location === "storefront" ? "Store Floor" : "2F Stockroom"}
      </h1>

      <div className="card p-3 space-y-2">
        {hasStockroom && (
          <div className="grid grid-cols-2 gap-2">
            {(["storefront", "stockroom"] as Location[]).map((l) => (
              <button key={l} className={`btn ${location === l ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`}
                onClick={() => { setLocation(l); setCounts({}); setMsg(""); }}>
                {l === "storefront" ? "🏪 Store floor" : "📦 2F stockroom"}
              </button>
            ))}
          </div>
        )}
        <BarcodeInput onScan={onScan} placeholder="Type barcode / SKU, then Enter" />
        {msg && <p className="text-sm font-semibold">{msg}</p>}
        <p className="text-xs text-slate-500">
          Only items on the sheet below are corrected. Everything you don&apos;t count is left untouched.
        </p>
      </div>

      {/* Add items without a barcode — by name or by category */}
      <div className="card p-3 space-y-2">
        <div className="label">Add item without a barcode (cage, leash, stroller, toys…)</div>
        <input className="input" placeholder="Search by name / brand / SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Choose a category to browse…</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {results.length > 0 && (
          <>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">{results.length} item{results.length !== 1 ? "s" : ""} to add</span>
              <button
                className="btn-secondary !py-1.5 !px-3 text-xs"
                onClick={() => {
                  setCounts((c) => {
                    const next = { ...c };
                    results.forEach((p) => { next[p.id] = null; });
                    return next;
                  });
                  setMsg(`➕ Added ${results.length} items — type the quantity for each`);
                }}
              >
                + Add all to sheet
              </button>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-60 overflow-y-auto">
              {results.map((p) => (
                <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-orange-50 flex justify-between items-center gap-2"
                  onClick={() => addToSheet(p)}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">{brandName(p)} <span className="text-slate-400 font-normal">{p.size_variant}</span></span>
                    <span className="block text-[11px] text-slate-500">{p.category} · in app: {systemQty(p.id)}</span>
                  </span>
                  <span className="text-xs font-bold text-orange-700 whitespace-nowrap">+ Add</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* The count sheet */}
      <div className="card">
        <div className="px-3 py-2 border-b border-slate-200 flex justify-between items-center">
          <span className="font-bold text-sm">Count sheet ({rows.length})</span>
          {rows.length > 0 && (
            <span className="text-[11px] text-slate-500">
              {pending.length} to count · {diffs.length} difference{diffs.length !== 1 ? "s" : ""} · {matched.length} match
            </span>
          )}
        </div>
        <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
          {rows.map(({ p, counted, system, diff }) => (
            <div key={p.id} className="px-3 py-2.5">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{brandName(p)}</div>
                  <div className="text-xs text-slate-500">
                    {p.size_variant} · in app: <b>{system}</b> · {peso(p.retail_price)}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {counted === null ? (
                    <span className="badge bg-slate-200 text-slate-600">not counted</span>
                  ) : diff === 0 ? (
                    <span className="badge bg-emerald-100 text-emerald-700">✓ match</span>
                  ) : (
                    <span className={`badge ${diff! > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {diff! > 0 ? "+" : ""}{diff}
                    </span>
                  )}
                  <button className="text-slate-400 px-1" onClick={() => setCounts((c) => { const n = { ...c }; delete n[p.id]; return n; })}>✕</button>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <button className="btn-secondary !px-3 !py-1.5" onClick={() => setCounts((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) - 1) }))}>−</button>
                <input
                  className="input !w-20 text-center !py-1.5 font-bold"
                  type="number" inputMode="numeric"
                  placeholder="—"
                  value={counted === null ? "" : counted}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCounts((c) => ({ ...c, [p.id]: v === "" ? null : Math.max(0, parseInt(v) || 0) }));
                  }}
                />
                <button className="btn-secondary !px-3 !py-1.5" onClick={() => setCounts((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}>+</button>
                <button
                  className={`btn !py-1.5 !px-3 text-xs whitespace-nowrap ${counted === 0 ? "bg-red-600 text-white" : "bg-white border border-slate-300"}`}
                  onClick={() => setCounts((c) => ({ ...c, [p.id]: 0 }))}
                  title="Nothing left on the shelf"
                >
                  Set 0
                </button>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">
              Scan an item, or search above to add items that have no barcode.
            </p>
          )}
        </div>
      </div>

      {diffs.length > 0 && (
        <button className="btn-primary w-full text-base" onClick={() => setPin(true)}>
          Apply {diffs.length} correction{diffs.length !== 1 ? "s" : ""} (approval PIN)
        </button>
      )}
      {rows.length > 0 && diffs.length === 0 && pending.length === 0 && (
        <p className="text-center text-sm text-emerald-700 font-semibold">✅ Everything counted matches the app.</p>
      )}
      {pending.length > 0 && (
        <p className="text-center text-xs text-slate-500">
          {pending.length} item{pending.length !== 1 ? "s" : ""} still blank — those are skipped until you enter a number.
        </p>
      )}

      {pin && (
        <PinModal
          title="Manager or assistant manager PIN" subtitle={`Post ${diffs.length} count correction${diffs.length !== 1 ? "s" : ""}`}
          managerOnly allowAssistant branch_id={branchId}
          onCancel={() => setPin(false)}
          onSuccess={(mgr) => {
            diffs.forEach((d) => adjustStock(d.p.id, branchId, location, d.diff!, "Stock count correction", session.user_id, mgr.id));
            setPin(false);
            setCounts({});
            setMsg(`✅ Posted ${diffs.length} correction${diffs.length !== 1 ? "s" : ""} to the movements ledger.`);
          }}
        />
      )}
    </div>
  );
}
