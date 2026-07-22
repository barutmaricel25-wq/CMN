"use client";
// Receive Delivery: draft → add items by scan → post (stockroom +qty).
// Morning-rush friendly: drafts can be started and posted later.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { createDelivery, addDeliveryItem, removeDeliveryItem, postDelivery } from "@/lib/actions";
import { peso, toCentavos, fmtDateTime } from "@/lib/util";
import BarcodeInput from "@/components/BarcodeInput";

export default function DeliveriesPage() {
  const db = useDB();
  const session = useSession();
  const [openId, setOpenId] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  const branchId = session?.branch_id ?? "";
  if (!session) return null;

  const deliveries = db.deliveries
    .filter((d) => d.branch_id === branchId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const open = openId ? db.deliveries.find((d) => d.id === openId) : null;
  const openItems = open ? db.delivery_items.filter((i) => i.delivery_id === open.id) : [];

  function addByScan(code: string) {
    if (!open || open.status === "posted") return;
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ No product for “${code}”`); return; }
    addDeliveryItem(open.id, p.id, 1, p.cost_price);
    setMsg(`✅ +1 ${p.name}`);
  }

  const results = search.trim().length >= 2 && open
    ? db.products.filter((p) => p.active && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">🚚 Receive Deliveries</h1>

      {!open && (
        <>
          <div className="card p-3 space-y-2">
            <label className="label">New delivery — supplier name</label>
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="e.g. Nutri Distributors Inc." value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              <button
                className="btn-primary"
                disabled={!supplier.trim()}
                onClick={() => {
                  const id = createDelivery(branchId, supplier.trim(), session.user_id, "");
                  setSupplier("");
                  setOpenId(id);
                }}
              >
                Start draft
              </button>
            </div>
          </div>

          <div className="card divide-y divide-slate-100">
            {deliveries.map((d) => {
              const items = db.delivery_items.filter((i) => i.delivery_id === d.id);
              const total = items.reduce((t, i) => t + i.qty * i.unit_cost, 0);
              return (
                <button key={d.id} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center" onClick={() => setOpenId(d.id)}>
                  <div>
                    <div className="font-semibold text-sm">{d.supplier_name}</div>
                    <div className="text-xs text-slate-500">{fmtDateTime(d.created_at)} · {items.length} lines · {peso(total)}</div>
                  </div>
                  <span className={`badge ${d.status === "posted" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {d.status}
                  </span>
                </button>
              );
            })}
            {deliveries.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No deliveries yet</p>}
          </div>
        </>
      )}

      {open && (
        <div className="space-y-3">
          <div className="card p-3 flex justify-between items-center">
            <div>
              <div className="font-bold">{open.supplier_name}</div>
              <div className="text-xs text-slate-500">{fmtDateTime(open.created_at)} · {open.status}</div>
            </div>
            <button className="btn-ghost" onClick={() => setOpenId(null)}>← Back</button>
          </div>

          {open.status === "draft" && (
            <div className="card p-3 space-y-2">
              <BarcodeInput onScan={addByScan} placeholder="Scan delivered item (+1 each scan)" />
              <input className="input" placeholder="Or search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {results.map((p) => (
                <button key={p.id} className="btn-secondary w-full justify-between" onClick={() => { addDeliveryItem(open.id, p.id, 1, p.cost_price); setSearch(""); }}>
                  <span className="text-sm truncate">{p.name} {p.size_variant}</span>
                  <span className="text-xs">{peso(p.cost_price)}</span>
                </button>
              ))}
              {msg && <p className="text-sm font-semibold">{msg}</p>}
            </div>
          )}

          <div className="card divide-y divide-slate-100">
            {openItems.map((i) => {
              const p = db.products.find((pp) => pp.id === i.product_id)!;
              return (
                <div key={i.id} className="px-4 py-2.5 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name} {p.size_variant}</div>
                    <div className="text-xs text-slate-500">unit cost {peso(i.unit_cost)}</div>
                  </div>
                  {open.status === "draft" ? (
                    <>
                      <input
                        className="input !w-20 text-center !py-2"
                        type="number" inputMode="numeric" value={i.qty}
                        onChange={(e) => {
                          const v = Math.max(1, parseInt(e.target.value) || 1);
                          removeDeliveryItem(i.id);
                          addDeliveryItem(open.id, i.product_id, v, i.unit_cost);
                        }}
                      />
                      <input
                        className="input !w-24 text-center !py-2"
                        defaultValue={(i.unit_cost / 100).toFixed(2)}
                        inputMode="decimal"
                        onBlur={(e) => {
                          const c = toCentavos(e.target.value);
                          if (c > 0) { removeDeliveryItem(i.id); addDeliveryItem(open.id, i.product_id, i.qty, c); }
                        }}
                      />
                      <button className="text-slate-400 px-2" onClick={() => removeDeliveryItem(i.id)}>✕</button>
                    </>
                  ) : (
                    <div className="font-bold tabular-nums text-sm">{i.qty} × {peso(i.unit_cost)}</div>
                  )}
                </div>
              );
            })}
            {openItems.length === 0 && <p className="text-center text-sm text-slate-400 py-6">Scan items to add them</p>}
          </div>

          {open.status === "draft" && (
            <button
              className="btn-primary w-full text-base"
              disabled={openItems.length === 0}
              onClick={() => { postDelivery(open.id, session.user_id); setMsg(""); }}
            >
              ✅ Post delivery — add {openItems.reduce((t, i) => t + i.qty, 0)} units to 2F stockroom
            </button>
          )}
          {open.status === "posted" && (
            <p className="text-center text-sm text-emerald-700 font-semibold">Posted — stockroom updated. See the movements ledger.</p>
          )}
        </div>
      )}
    </div>
  );
}
