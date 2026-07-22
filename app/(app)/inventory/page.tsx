"use client";
// Per-branch inventory: stockroom vs storefront vs total, with adjustment
// (manager PIN + reason) per row.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { adjustStock } from "@/lib/actions";
import { CATEGORIES, Location, Product } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import PinModal from "@/components/PinModal";

export default function InventoryPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [adjust, setAdjust] = useState<null | { product: Product; location: Location }>(null);
  const [pinned, setPinned] = useState<null | { approved_by: string }>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const branchId = session?.branch_id ?? "";

  const rows = useMemo(() => {
    const inv = new Map<string, { sr: number; sf: number }>();
    db.inventory
      .filter((i) => i.branch_id === branchId)
      .forEach((i) => {
        const r = inv.get(i.product_id) ?? { sr: 0, sf: 0 };
        if (i.location === "stockroom") r.sr = i.qty;
        else r.sf = i.qty;
        inv.set(i.product_id, r);
      });
    return db.products
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
      .map((p) => {
        const r = inv.get(p.id) ?? { sr: 0, sf: 0 };
        return { p, ...r, total: r.sr + r.sf, low: r.sr + r.sf <= p.low_stock_threshold };
      })
      .filter((r) => !lowOnly || r.low)
      .sort((a, b) => a.p.name.localeCompare(b.p.name));
  }, [db, branchId, q, cat, lowOnly]);

  if (!session) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Link href="/inventory/pull-down" className="btn-primary flex-1">⬇️ Pull Down</Link>
        <Link href="/inventory/deliveries" className="btn-secondary flex-1">🚚 Deliveries</Link>
        <Link href="/inventory/movements" className="btn-secondary flex-1">📒 Ledger</Link>
      </div>

      <div className="card p-3 space-y-2">
        <BarcodeInput onScan={setQ} placeholder="Scan barcode to filter" autoFocus={false} />
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Search name/brand…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-40" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" className="w-5 h-5" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 px-3 py-2 bg-slate-50 text-[11px] font-bold uppercase text-slate-500 border-b border-slate-200">
          <div>Product</div>
          <div className="text-center">2F</div>
          <div className="text-center">Floor</div>
          <div className="text-center">Total</div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
          {rows.map(({ p, sr, sf, total, low }) => (
            <div key={p.id} className="grid grid-cols-[1fr_3.5rem_3.5rem_3.5rem] gap-1 px-3 py-2 items-center">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.brand} · {p.size_variant}
                  {low && <span className="badge bg-red-100 text-red-700 ml-1">LOW ≤{p.low_stock_threshold}</span>}
                </div>
              </div>
              <button className="text-center font-bold tabular-nums text-sm py-2 rounded hover:bg-slate-100" onClick={() => setAdjust({ product: p, location: "stockroom" })}>
                {sr}
              </button>
              <button className="text-center font-bold tabular-nums text-sm py-2 rounded hover:bg-slate-100" onClick={() => setAdjust({ product: p, location: "storefront" })}>
                {sf}
              </button>
              <div className={`text-center font-extrabold tabular-nums text-sm ${low ? "text-red-600" : ""}`}>{total}</div>
            </div>
          ))}
          {rows.length === 0 && <p className="text-center text-slate-400 py-8 text-sm">No products match</p>}
        </div>
      </div>
      <p className="text-xs text-slate-400 text-center">Tap a 2F/Floor number to adjust (manager PIN + reason required).</p>

      {adjust && !pinned && (
        <PinModal
          title="Manager PIN required"
          subtitle={`Adjust ${adjust.product.name} (${adjust.location})`}
          managerOnly
          branch_id={branchId}
          onCancel={() => setAdjust(null)}
          onSuccess={(mgr) => setPinned({ approved_by: mgr.id })}
        />
      )}

      {adjust && pinned && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setAdjust(null); setPinned(null); }}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
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
                  adjustStock(adjust.product.id, branchId, adjust.location, parseInt(delta), reason, session.user_id, pinned.approved_by);
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
