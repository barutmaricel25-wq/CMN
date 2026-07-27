"use client";
// Customers: suki & wholesaler records with order history and metrics.
import { useEffect, useState } from "react";
import { useDB, tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { peso, fmtDate, toCentavos } from "@/lib/util";
import { blankCustomer, blankPDC } from "@/lib/factories";
import { savePDC } from "@/lib/actions";
import { Customer, CustomerType, CUSTOMER_TYPE_LABEL, PaymentTerms, PDCCheck } from "@/lib/types";
import Link from "next/link";

export default function CustomersPage() {
  const db = useDB();
  const session = useSession();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // Prefill from global search (?q=...)
  useEffect(() => {
    const qq = new URLSearchParams(window.location.search).get("q");
    if (qq) setQ(qq);
  }, []);

  if (!session) return null;

  const metrics = (cid: string) => {
    const sales = db.sales.filter((s) => s.customer_id === cid && s.status === "completed");
    const last = sales.map((s) => s.created_at).sort().pop();
    return { spend: sales.reduce((t, s) => t + s.total, 0), count: sales.length, last };
  };

  const rows = db.customers
    .filter((c) => c.active)
    .filter((c) => !type || c.type === type)
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const open = openId ? db.customers.find((c) => c.id === openId) : null;

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="font-bold text-lg">👥 Customers</h1>
        <button className="btn-primary !py-2" onClick={() => setEditing(blankCustomer())}>+ Add</button>
      </div>

      <div className="card p-3 flex gap-2">
        <input className="input flex-1" placeholder="Search name/phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-36" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="retail">Online Reseller</option>
          <option value="suki">Suki</option>
          <option value="wholesaler">Wholesaler</option>
        </select>
      </div>

      <div className="card divide-y divide-slate-100">
        {rows.map((c) => {
          const m = metrics(c.id);
          return (
            <button key={c.id} className="w-full text-left px-4 py-3 hover:bg-slate-50" onClick={() => setOpenId(c.id)}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {c.name}
                    <span className={`badge ml-2 ${c.type === "retail" ? "bg-slate-200 text-slate-700" : c.type === "suki" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{CUSTOMER_TYPE_LABEL[c.type]}</span>
                  </div>
                  <div className="text-xs text-slate-500">{c.phone} {c.address && `· ${c.address}`}</div>
                </div>
                <div className="text-right text-xs whitespace-nowrap">
                  <div className="font-bold tabular-nums">{peso(m.spend)}</div>
                  <div className="text-slate-500">{m.count} orders{m.last ? ` · last ${fmtDate(m.last)}` : ""}</div>
                </div>
              </div>
            </button>
          );
        })}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No customers</p>}
      </div>

      {open && (
        <CustomerSheet customer={open} onEdit={() => { setEditing({ ...open }); setOpenId(null); }} onClose={() => setOpenId(null)} />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-md p-5 space-y-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{editing.name ? "Edit customer" : "New customer"}</h3>
            <input className="input" placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Phone" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              <select className="input w-36" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as CustomerType })}>
                <option value="retail">Online Reseller</option>
                <option value="suki">Suki</option>
                <option value="wholesaler">Wholesaler</option>
              </select>
            </div>
            <input className="input" placeholder="Address" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            {editing.type !== "retail" && (
              <div>
                <label className="label">Payment method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["cash", "pdc"] as PaymentTerms[]).map((t) => (
                    <button
                      key={t}
                      className={`btn ${editing.payment_terms === t ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`}
                      onClick={() => setEditing({ ...editing, payment_terms: t })}
                    >
                      {t === "cash" ? "💵 Cash" : "🧾 PDC (cheque)"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea className="input" placeholder="Notes (pets, preferences…)" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            <div className="flex gap-2 pt-1">
              <button className="btn-ghost flex-1" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="btn-primary flex-1" disabled={!editing.name.trim()}
                onClick={() => {
                  tx((d) => {
                    const i = d.customers.findIndex((x) => x.id === editing.id);
                    if (i >= 0) d.customers[i] = editing; else d.customers.push(editing);
                  });
                  setEditing(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CustomerSheet({ customer, onEdit, onClose }: { customer: Customer; onEdit: () => void; onClose: () => void }) {
  const db = useDB();
  const sales = db.sales
    .filter((s) => s.customer_id === customer.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const orders = db.online_orders
    .filter((o) => o.customer_id === customer.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lastOrder = orders.find((o) => o.status !== "cancelled");
  const spend = sales.filter((s) => s.status === "completed").reduce((t, s) => t + s.total, 0);

  // "Repeat last order" — prefill new order with most recent items.
  const repeatHref = lastOrder
    ? `/orders/new?customer=${customer.id}&repeat=${encodeURIComponent(JSON.stringify(lastOrder.items))}`
    : `/orders/new?customer=${customer.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-bold text-lg">{customer.name}</h3>
            <div className="text-xs text-slate-500">{CUSTOMER_TYPE_LABEL[customer.type]} · {customer.phone}</div>
            {customer.notes && <div className="text-xs text-slate-500 mt-1">📝 {customer.notes}</div>}
          </div>
          <button className="btn-ghost !py-1" onClick={onEdit}>✏️ Edit</button>
        </div>

        <div className="grid grid-cols-3 gap-2 my-3">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center">
            <div className="text-[10px] font-bold uppercase text-slate-500">Total spend</div>
            <div className="font-extrabold text-sm tabular-nums">{peso(spend)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center">
            <div className="text-[10px] font-bold uppercase text-slate-500">Orders</div>
            <div className="font-extrabold text-sm">{sales.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center">
            <div className="text-[10px] font-bold uppercase text-slate-500">Last order</div>
            <div className="font-extrabold text-sm">{sales[0] ? fmtDate(sales[0].created_at) : "—"}</div>
          </div>
        </div>

        <Link href={repeatHref} className="btn-primary w-full mb-3">
          🔁 {lastOrder ? "Repeat last order" : "New order for this customer"}
        </Link>

        {/* PDC cheque payments (suki / wholesaler paying by post-dated cheque) */}
        {customer.type !== "retail" && (
          <CustomerPDC customer={customer} />
        )}

        <h4 className="label">Order history (onsite + online)</h4>
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {sales.slice(0, 15).map((s) => (
            <div key={s.id} className="px-3 py-2 flex justify-between text-sm">
              <span>
                {s.channel === "online" ? "📦" : "🛒"} #{String(s.receipt_no).padStart(6, "0")}
                <span className="text-xs text-slate-400 ml-1">{fmtDate(s.created_at)}</span>
                {s.status === "voided" && <span className="badge bg-red-100 text-red-700 ml-1">voided</span>}
              </span>
              <span className="font-semibold tabular-nums">{peso(s.total)}</span>
            </div>
          ))}
          {sales.length === 0 && <p className="text-center text-sm text-slate-400 py-5">No purchases yet</p>}
        </div>
      </div>
    </div>
  );
}

// Post-dated cheques received from this customer (suki / wholesaler).
function CustomerPDC({ customer }: { customer: Customer }) {
  const db = useDB();
  const session = useSession()!;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PDCCheck | null>(null);

  const cheques = db.pdc_checks
    .filter((c) => c.customer_id === customer.id)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  function startAdd() {
    setDraft({
      ...blankPDC(session.branch_id ?? ""),
      direction: "receivable",
      party_name: customer.name,
      customer_id: customer.id,
    });
    setAdding(true);
  }

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <div className="label !mb-0">🧾 Cheque payments (PDC)</div>
        <button className="btn-secondary !py-1 !px-2 text-xs" onClick={startAdd}>+ Record cheque</button>
      </div>
      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
        {cheques.map((c) => (
          <div key={c.id} className="px-3 py-2 flex justify-between items-center text-sm">
            <div className="min-w-0">
              <div className="font-semibold">#{c.check_number || "—"} · {c.bank || "bank ?"}</div>
              <div className="text-xs text-slate-500">
                paid {fmtDate(c.date_issued)} · due {fmtDate(c.due_date)}
              </div>
            </div>
            <div className="text-right whitespace-nowrap">
              <div className="font-bold tabular-nums">{peso(c.amount)}</div>
              <span className={`badge ${c.status === "cleared" ? "bg-emerald-100 text-emerald-700" : c.status === "bounced" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{c.status}</span>
            </div>
          </div>
        ))}
        {cheques.length === 0 && <p className="text-center text-xs text-slate-400 py-4">No cheques recorded</p>}
      </div>

      {adding && draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setAdding(false)}>
          <div className="card w-full max-w-sm p-5 space-y-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">Record cheque — {customer.name}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Check number</label>
                <input className="input" value={draft.check_number} onChange={(e) => setDraft({ ...draft, check_number: e.target.value })} /></div>
              <div><label className="label">Bank</label>
                <input className="input" placeholder="BDO…" value={draft.bank} onChange={(e) => setDraft({ ...draft, bank: e.target.value })} /></div>
            </div>
            <div><label className="label">Amount ₱</label>
              <input className="input" inputMode="decimal" onChange={(e) => setDraft({ ...draft, amount: toCentavos(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Date of payment</label>
                <input className="input" type="date" value={draft.date_issued} onChange={(e) => setDraft({ ...draft, date_issued: e.target.value })} /></div>
              <div><label className="label">Due date</label>
                <input className="input" type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 pt-1">
              <button className="btn-ghost flex-1" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={draft.amount <= 0}
                onClick={() => { savePDC(draft, session.user_id); setAdding(false); }}>
                Save cheque
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
