"use client";
// Movements ledger: every unit traceable — who, when, what, from→to.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { fmtDateTime, fmtQty } from "@/lib/util";
import { MovementType } from "@/lib/types";

const TYPE_META: Record<MovementType, { label: string; cls: string }> = {
  delivery_in: { label: "Delivery in", cls: "bg-orange-100 text-orange-700" },
  pull_down: { label: "Pull down", cls: "bg-blue-100 text-blue-700" },
  transfer_out: { label: "Transfer out", cls: "bg-purple-100 text-purple-700" },
  transfer_in: { label: "Transfer in", cls: "bg-purple-100 text-purple-700" },
  sale: { label: "Sale", cls: "bg-slate-200 text-slate-700" },
  adjustment: { label: "Adjustment", cls: "bg-amber-100 text-amber-700" },
  return: { label: "Return", cls: "bg-rose-100 text-rose-700" },
};

export default function MovementsPage() {
  const db = useDB();
  const session = useSession();
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);

  if (!session) return null;
  const branchId = session.branch_id;

  const rows = db.stock_movements
    .filter((m) => m.branch_id === branchId)
    .filter((m) => !type || m.type === type)
    .filter((m) => {
      if (!q) return true;
      const p = db.products.find((pp) => pp.id === m.product_id);
      return p ? p.name.toLowerCase().includes(q.toLowerCase()) || p.barcode === q : false;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">📒 Stock Movements Ledger</h1>
      {/* A drop-down beside the search box keeps its option text at full width
          and leaves the box a sliver on a phone, so they get a row each. */}
      <div className="card p-3 space-y-2">
        <input className="input" placeholder="Search product…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <div className="card divide-y divide-slate-100">
        {rows.slice(0, limit).map((m) => {
          const p = db.products.find((pp) => pp.id === m.product_id);
          const by = db.users.find((u) => u.id === m.performed_by);
          const meta = TYPE_META[m.type];
          return (
            <div key={m.id} className="px-4 py-2.5">
              <div className="flex justify-between items-start gap-2">
                <div className="text-sm font-semibold truncate">{p?.name} <span className="text-slate-400 font-normal">{p?.size_variant}</span></div>
                <span className={`badge ${meta.cls} whitespace-nowrap`}>{meta.label}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                <b className="tabular-nums">{fmtQty(m.qty)}</b> {m.from_location ?? "—"} → {m.to_location ?? "—"} · {by?.name ?? "?"} · {fmtDateTime(m.created_at)}
                {m.note && <span className="text-amber-700"> · {m.note}</span>}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No movements</p>}
      </div>
      {rows.length > limit && (
        <button className="btn-secondary w-full" onClick={() => setLimit(limit + 100)}>Load more ({rows.length - limit} left)</button>
      )}
    </div>
  );
}
