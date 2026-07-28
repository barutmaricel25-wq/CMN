"use client";
// Receive Delivery (OWNER ONLY): supplier company details, payment terms
// (COD or PDC 30/45/60 days with computed due date), scanned items, totals,
// then post to add stock. A PDC delivery creates a cheque record on posting.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import {
  createDelivery, updateDelivery, addDeliveryItem, removeDeliveryItem, postDelivery, savePDC,
} from "@/lib/actions";
import { blankPDC } from "@/lib/factories";
import { peso, toCentavos, fmtDate, manilaDateKey, brandName } from "@/lib/util";
import { DeliveryTerms, TERMS_LABEL } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

export default function DeliveriesPage() {
  const db = useDB();
  const session = useSession();
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");
  // New-delivery form
  const [nName, setNName] = useState("");
  const [nContact, setNContact] = useState("");
  const [nAddress, setNAddress] = useState("");
  const [nDate, setNDate] = useState(manilaDateKey());
  const [nTerms, setNTerms] = useState<DeliveryTerms>("cod");
  // PDC details captured when posting a PDC delivery
  const [pdcCheque, setPdcCheque] = useState("");
  const [pdcBank, setPdcBank] = useState("");

  const branchId = session?.branch_id ?? "";
  if (!session) return null;
  const me = db.users.find((u) => u.id === session.user_id)!;

  // Owner and branch managers only — never staff.
  if (me.role === "staff") {
    return (
      <div className="card p-8 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h1 className="font-bold text-lg mb-1">Manager access only</h1>
        <p className="text-sm text-slate-500">Receiving deliveries is restricted to the owner and branch managers.</p>
      </div>
    );
  }

  const deliveries = db.deliveries
    .filter((d) => d.branch_id === branchId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const open = openId ? db.deliveries.find((d) => d.id === openId) : null;
  const openItems = open ? db.delivery_items.filter((i) => i.delivery_id === open.id) : [];
  const openUnits = openItems.reduce((t, i) => t + i.qty, 0);
  const openValue = openItems.reduce((t, i) => t + i.qty * i.unit_cost, 0);

  function addByScan(code: string) {
    if (!open || open.status === "posted") return;
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ No product for “${code}”`); return; }
    addDeliveryItem(open.id, p.id, 1, p.cost_price);
    setMsg(`✅ +1 ${p.name}`);
  }

  const results = search.trim().length >= 2 && open
    ? db.products.filter((p) => p.active && (p.name.toLowerCase().includes(search.toLowerCase()) || p.brand.toLowerCase().includes(search.toLowerCase()))).slice(0, 6)
    : [];

  function post() {
    if (!open) return;
    postDelivery(open.id, session!.user_id);
    // Record the post-dated cheque so it shows on the PDC Due Dates screen.
    if (open.terms !== "cod" && open.due_date) {
      savePDC({
        ...blankPDC(open.branch_id),
        direction: "payable",
        party_name: open.supplier_name,
        delivery_id: open.id,
        check_number: pdcCheque.trim(),
        bank: pdcBank.trim(),
        amount: openValue,
        date_issued: open.delivery_date,
        due_date: open.due_date,
        note: `${TERMS_LABEL[open.terms]} — delivery ${fmtDate(open.delivery_date)}`,
      }, session!.user_id);
    }
    setPdcCheque(""); setPdcBank(""); setMsg("");
  }

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">🚚 Receive Deliveries</h1>

      {!open && (
        <>
          <div className="card p-3 space-y-2">
            <h2 className="font-bold text-sm">New delivery</h2>
            <div>
              <label className="label">Company name *</label>
              <input className="input" placeholder="e.g. Nutri Distributors Inc." value={nName} onChange={(e) => setNName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Contact number</label>
                <input className="input" inputMode="tel" placeholder="0917…" value={nContact} onChange={(e) => setNContact(e.target.value)} />
              </div>
              <div>
                <label className="label">Delivery date</label>
                <input className="input" type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" placeholder="Supplier address" value={nAddress} onChange={(e) => setNAddress(e.target.value)} />
            </div>
            <div>
              <label className="label">Payment terms</label>
              <select className="input" value={nTerms} onChange={(e) => setNTerms(e.target.value as DeliveryTerms)}>
                {(Object.keys(TERMS_LABEL) as DeliveryTerms[]).map((t) => (
                  <option key={t} value={t}>{TERMS_LABEL[t]}</option>
                ))}
              </select>
              {nTerms !== "cod" && (
                <p className="text-xs text-amber-700 font-semibold mt-1">
                  Cheque due {fmtDate(addDays(nDate, nTerms === "pdc30" ? 30 : nTerms === "pdc45" ? 45 : 60))}
                </p>
              )}
            </div>
            <button
              className="btn-primary w-full"
              disabled={!nName.trim()}
              onClick={() => {
                const id = createDelivery({
                  branch_id: branchId, supplier_name: nName.trim(), supplier_contact: nContact.trim(),
                  supplier_address: nAddress.trim(), delivery_date: nDate, terms: nTerms,
                  received_by: session.user_id, note: "",
                });
                setNName(""); setNContact(""); setNAddress(""); setNTerms("cod");
                setOpenId(id);
              }}
            >
              Start delivery →
            </button>
          </div>

          <div className="card divide-y divide-slate-100">
            {deliveries.map((d) => {
              const items = db.delivery_items.filter((i) => i.delivery_id === d.id);
              const units = items.reduce((t, i) => t + i.qty, 0);
              const total = items.reduce((t, i) => t + i.qty * i.unit_cost, 0);
              return (
                <button key={d.id} className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center gap-2" onClick={() => setOpenId(d.id)}>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{d.supplier_name}</div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(d.delivery_date)} · {items.length} lines · {units} units · {peso(total)}
                    </div>
                    <div className="text-xs mt-0.5">
                      <span className={`badge ${d.terms === "cod" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                        {TERMS_LABEL[d.terms]}
                      </span>
                      {d.due_date && <span className="text-slate-500 ml-1">due {fmtDate(d.due_date)}</span>}
                    </div>
                  </div>
                  <span className={`badge shrink-0 ${d.status === "posted" ? "bg-orange-100 text-orange-700" : "bg-slate-200 text-slate-700"}`}>
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
          <div className="card p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-bold">{open.supplier_name}</div>
                <div className="text-xs text-slate-500">
                  {open.supplier_contact && `${open.supplier_contact} · `}{open.supplier_address}
                </div>
                <div className="text-xs text-slate-500">Delivered {fmtDate(open.delivery_date)}</div>
              </div>
              <button className="btn-ghost !py-1 shrink-0" onClick={() => setOpenId(null)}>← Back</button>
            </div>
            {open.status === "draft" ? (
              <div className="mt-2">
                <label className="label">Payment terms</label>
                <select
                  className="input"
                  value={open.terms}
                  onChange={(e) => updateDelivery(open.id, { terms: e.target.value as DeliveryTerms })}
                >
                  {(Object.keys(TERMS_LABEL) as DeliveryTerms[]).map((t) => (
                    <option key={t} value={t}>{TERMS_LABEL[t]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mt-2 text-sm">
                <span className={`badge ${open.terms === "cod" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{TERMS_LABEL[open.terms]}</span>
              </div>
            )}
            {open.due_date && (
              <p className="text-sm font-semibold text-amber-700 mt-1">📅 Cheque due: {fmtDate(open.due_date)}</p>
            )}
          </div>

          {open.status === "draft" && (
            <div className="card p-3 space-y-2">
              <BarcodeInput onScan={addByScan} placeholder="Type barcode / SKU, then Enter" />
              <input className="input" placeholder="Or search name…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {results.map((p) => (
                <button key={p.id} className="btn-secondary w-full justify-between" onClick={() => { addDeliveryItem(open.id, p.id, 1, p.cost_price); setSearch(""); }}>
                  <span className="text-sm truncate">{brandName(p)} {p.size_variant}</span>
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
                    <div className="text-sm font-semibold truncate">{brandName(p)} {p.size_variant}</div>
                    <div className="text-xs text-slate-500">unit cost {peso(i.unit_cost)} · line {peso(i.qty * i.unit_cost)}</div>
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

          {/* Totals */}
          <div className="card p-4 grid grid-cols-3 gap-2 text-center">
            <Tile label="Item lines" value={String(openItems.length)} />
            <Tile label="Total stock items" value={String(openUnits)} />
            <Tile label="Total amount" value={peso(openValue)} strong />
          </div>

          {open.status === "draft" && open.terms !== "cod" && (
            <div className="card p-3 space-y-2">
              <h3 className="font-bold text-sm">Post-dated cheque details</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Cheque number</label>
                  <input className="input" value={pdcCheque} onChange={(e) => setPdcCheque(e.target.value)} />
                </div>
                <div>
                  <label className="label">Bank</label>
                  <input className="input" placeholder="BDO / Metrobank…" value={pdcBank} onChange={(e) => setPdcBank(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Amount {peso(openValue)} · due {open.due_date ? fmtDate(open.due_date) : "—"} — saved to the PDC Due Dates screen when you post.
              </p>
            </div>
          )}

          {open.status === "draft" && (
            <button className="btn-primary w-full text-base" disabled={openItems.length === 0} onClick={post}>
              ✅ Post delivery — add {openUnits} units to stock
            </button>
          )}
          {open.status === "posted" && (
            <p className="text-center text-sm text-orange-700 font-semibold">Posted — stock updated. See the movements ledger.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-2.5 ${strong ? "bg-orange-50 border-orange-200" : "bg-slate-50 border-slate-200"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-extrabold tabular-nums ${strong ? "text-orange-700" : ""}`}>{value}</div>
    </div>
  );
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}
