"use client";
// Per-branch inventory: stockroom vs storefront vs total, with a branch switcher
// so any store can check another store's stock (read-only), an "All branches"
// comparison view, prices per row, and adjustments (manager PIN + reason).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { adjustStock } from "@/lib/actions";
import { peso, brandName } from "@/lib/util";
import { CATEGORIES, categoriesOf, Location, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import PinModal from "@/components/PinModal";

export default function InventoryPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [view, setView] = useState<string>(""); // "" = my branch, "all" = compare, else branch id
  const [adjust, setAdjust] = useState<null | { product: Product; location: Location }>(null);
  const [pinned, setPinned] = useState<null | { approved_by: string }>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const categories = useMemo(() => {
    const used = categoriesOf(db.products.filter((p) => p.active));
    return used.length ? used : [...CATEGORIES];
  }, [db.products]);

  const myBranchId = session?.branch_id ?? "";
  const viewBranchId = view === "" ? myBranchId : view;
  const isCompare = view === "all";
  const isOtherBranch = !isCompare && viewBranchId !== myBranchId;

  // Products matching the search/category filters (branch-independent).
  const filtered = useMemo(
    () =>
      db.products
        .filter((p) => p.active)
        .filter((p) => !cat || p.category === cat)
        .filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.brand.toLowerCase().includes(q.toLowerCase()) ||
            p.barcode === q ||
            p.sku.toLowerCase() === q.toLowerCase()
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [db.products, q, cat]
  );

  // Single-branch rows (stockroom / storefront / total).
  const rows = useMemo(() => {
    if (isCompare) return [];
    const inv = new Map<string, { sr: number; sf: number }>();
    db.inventory
      .filter((i) => i.branch_id === viewBranchId)
      .forEach((i) => {
        const r = inv.get(i.product_id) ?? { sr: 0, sf: 0 };
        if (i.location === "stockroom") r.sr = i.qty;
        else r.sf = i.qty;
        inv.set(i.product_id, r);
      });
    return filtered
      .map((p) => {
        const r = inv.get(p.id) ?? { sr: 0, sf: 0 };
        return { p, ...r, total: r.sr + r.sf, low: r.sr + r.sf <= p.low_stock_threshold };
      })
      .filter((r) => !lowOnly || r.low);
  }, [db.inventory, filtered, viewBranchId, lowOnly, isCompare]);

  // All-branch comparison rows: qty per branch + grand total.
  const compareRows = useMemo(() => {
    if (!isCompare) return [];
    const byProductBranch = new Map<string, number>();
    db.inventory.forEach((i) => {
      const k = `${i.product_id}|${i.branch_id}`;
      byProductBranch.set(k, (byProductBranch.get(k) ?? 0) + i.qty);
    });
    return filtered
      .map((p) => {
        const per = db.branches.map((b) => byProductBranch.get(`${p.id}|${b.id}`) ?? 0);
        const total = per.reduce((t, n) => t + n, 0);
        return { p, per, total, low: total <= p.low_stock_threshold };
      })
      .filter((r) => !lowOnly || r.low);
  }, [db.inventory, db.branches, filtered, lowOnly, isCompare]);

  if (!session) return null;
  const viewBranch = db.branches.find((b) => b.id === viewBranchId);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Link href="/inventory/pull-down" className="btn-primary flex-1">⬇️ Pull Down</Link>
        <Link href="/inventory/movements" className="btn-secondary flex-1">📒 Ledger</Link>
        <Link href="/inventory/count" className="btn-secondary flex-1">🔢 Count</Link>
      </div>

      {/* Branch switcher — check any store's stock */}
      <div className="card p-3">
        <label className="label">Viewing stock of</label>
        <select className="input" value={view} onChange={(e) => setView(e.target.value)}>
          <option value="">🏠 My branch — {db.branches.find((b) => b.id === myBranchId)?.name}</option>
          {db.branches.filter((b) => b.id !== myBranchId).map((b) => (
            <option key={b.id} value={b.id}>🏬 {b.name}</option>
          ))}
          <option value="all">📊 All branches (compare)</option>
        </select>
        {isOtherBranch && (
          <p className="text-xs text-amber-700 font-semibold mt-1">
            Viewing {viewBranch?.name} — read-only. Need stock from here? Use Pull Down / Get Stock or Branch Transfers.
          </p>
        )}
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={setQ} placeholder="Type barcode / SKU, then Enter" />
        <input className="input" placeholder="Search name / brand…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" className="w-5 h-5" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {/* Single branch table */}
      {!isCompare && (
        <>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 px-3 py-2 bg-slate-50 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200">
              <div>Product</div>
              <div className="text-center">2F</div>
              <div className="text-center">Floor</div>
              <div className="text-center">Total</div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {rows.slice(0, 150).map(({ p, sr, sf, total, low }) => (
                <div key={p.id} className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 px-3 py-2 items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{brandName(p)}</div>
                    <div className="text-xs text-slate-500">
                      {p.size_variant} · <span className="font-semibold text-orange-700">{peso(p.retail_price)}</span>
                      <span className="text-slate-400"> · WS {peso(p.wholesale_price)}</span>
                      {low && <span className="badge bg-red-100 text-red-700 ml-1">LOW ≤{p.low_stock_threshold}</span>}
                    </div>
                  </div>
                  {isOtherBranch ? (
                    <div className="text-center font-bold tabular-nums text-sm">{sr}</div>
                  ) : (
                    <button className="text-center font-bold tabular-nums text-sm py-2 rounded hover:bg-slate-100" onClick={() => setAdjust({ product: p, location: "stockroom" })}>{sr}</button>
                  )}
                  {isOtherBranch ? (
                    <div className="text-center font-bold tabular-nums text-sm">{sf}</div>
                  ) : (
                    <button className="text-center font-bold tabular-nums text-sm py-2 rounded hover:bg-slate-100" onClick={() => setAdjust({ product: p, location: "storefront" })}>{sf}</button>
                  )}
                  <div className={`text-center font-extrabold tabular-nums text-sm ${low ? "text-red-600" : ""}`}>{total}</div>
                </div>
              ))}
              {rows.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No products match</p>}
            </div>
          </div>
          <p className="text-xs text-slate-400 text-center">
            {rows.length > 150 ? `Showing 150 of ${rows.length} — search or filter to narrow. ` : ""}
            {isOtherBranch ? "Read-only view of another branch." : "Tap a 2F/Floor number to adjust (manager PIN + reason required)."}
          </p>
        </>
      )}

      {/* All-branch comparison */}
      {isCompare && (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-slate-500 border-b border-slate-200">
                  <th className="text-left px-3 py-2">Product</th>
                  {db.branches.map((b) => (
                    <th key={b.id} className="px-2 py-2 text-center whitespace-nowrap">{b.name.replace("Main Branch", "Main")}</th>
                  ))}
                  <th className="px-2 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {compareRows.slice(0, 150).map(({ p, per, total, low }) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold truncate max-w-[14rem]">{brandName(p)}</div>
                      <div className="text-xs text-slate-500">{p.size_variant} · <span className="font-semibold text-orange-700">{peso(p.retail_price)}</span></div>
                    </td>
                    {per.map((n, i) => (
                      <td key={i} className={`px-2 py-2 text-center tabular-nums font-semibold ${n <= 0 ? "text-red-500" : ""}`}>{n}</td>
                    ))}
                    <td className={`px-2 py-2 text-center font-extrabold tabular-nums ${low ? "text-red-600" : ""}`}>{total}</td>
                  </tr>
                ))}
                {compareRows.length === 0 && (
                  <tr><td colSpan={db.branches.length + 2} className="text-center text-slate-400 py-8">No products match</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 text-center">
            {compareRows.length > 150 ? `Showing 150 of ${compareRows.length} — search or filter to narrow.` : "Stock on hand per branch (2F + floor)."}
          </p>
        </>
      )}

      {adjust && !pinned && (
        <PinModal
          title="Manager or cashier PIN"
          subtitle={`Adjust ${adjust.product.name} (${adjust.location})`}
          managerOnly
          allowCashier
          branch_id={myBranchId}
          onCancel={() => setAdjust(null)}
          onSuccess={(mgr) => setPinned({ approved_by: mgr.id })}
        />
      )}

      {adjust && pinned && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setAdjust(null); setPinned(null); }}>
          <div className="card w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">{adjust.product.name}</h3>
            <p className="text-sm text-slate-500 mb-3">Adjust {adjust.location} qty (use − for damage/expiry)</p>
            <label className="label">Change (+/−)</label>
            <input className="input mb-2" type="number" inputMode="numeric" placeholder="e.g. -2" value={delta} onChange={(e) => setDelta(e.target.value)} autoFocus />
            <label className="label">Reason (required)</label>
            <select className="input mb-2" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose reason…</option>
              <option>Damaged</option>
              <option>Expired</option>
              <option>Count correction</option>
              <option>Customer return to stock</option>
              <option>Other</option>
            </select>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost flex-1" onClick={() => { setAdjust(null); setPinned(null); setDelta(""); setReason(""); }}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={!reason || !delta || parseInt(delta) === 0}
                onClick={() => {
                  adjustStock(adjust.product.id, myBranchId, adjust.location, parseInt(delta), reason, session.user_id, pinned.approved_by);
                  setAdjust(null); setPinned(null); setDelta(""); setReason("");
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
