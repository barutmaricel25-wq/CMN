"use client";
// Branch transfers: request → send (stockroom −) → receive (stockroom +),
// qty confirmed on both ends; discrepancies flagged.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { createTransfer, sendTransfer, receiveTransfer } from "@/lib/actions";
import { fmtDateTime } from "@/lib/util";
import { Transfer } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";

export default function TransfersPage() {
  const db = useDB();
  const session = useSession();
  const [creating, setCreating] = useState(false);
  const [toBranch, setToBranch] = useState("");
  const [items, setItems] = useState<{ product_id: string; qty: number }[]>([]);
  const [search, setSearch] = useState("");
  const [confirmT, setConfirmT] = useState<Transfer | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});

  if (!session) return null;
  const branchId = session.branch_id!;

  const transfers = db.transfers
    .filter((t) => t.from_branch_id === branchId || t.to_branch_id === branchId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const bname = (id: string) => db.branches.find((b) => b.id === id)?.name ?? id;

  function addItem(pid: string) {
    setItems((l) => {
      const i = l.findIndex((x) => x.product_id === pid);
      if (i >= 0) return l.map((x, k) => (k === i ? { ...x, qty: x.qty + 1 } : x));
      return [...l, { product_id: pid, qty: 1 }];
    });
    setSearch("");
  }

  const results = search.trim().length >= 2
    ? db.products.filter((p) => p.active && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="font-bold text-lg">🔁 Branch Transfers</h1>
        <button className="btn-primary !py-2" onClick={() => setCreating(!creating)}>+ Request</button>
      </div>

      {creating && (
        <div className="card p-3 space-y-2">
          <label className="label">Request stock FROM which branch? (they will send to us)</label>
          <select className="input" value={toBranch} onChange={(e) => setToBranch(e.target.value)}>
            <option value="">Choose branch…</option>
            {db.branches.filter((b) => b.id !== branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <BarcodeInput onScan={(code) => { const p = db.products.find((x) => x.barcode === code); if (p) addItem(p.id); }} placeholder="Type barcode / SKU, then Enter" />
          <input className="input" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.map((p) => (
            <button key={p.id} className="btn-secondary w-full justify-start text-sm" onClick={() => addItem(p.id)}>{p.name} {p.size_variant}</button>
          ))}
          {items.map((i, k) => {
            const p = db.products.find((pp) => pp.id === i.product_id)!;
            return (
              <div key={k} className="flex items-center gap-2">
                <span className="flex-1 text-sm font-semibold truncate">{p.name}</span>
                <input className="input !w-20 text-center !py-2" type="number" value={i.qty}
                  onChange={(e) => setItems((l) => l.map((x, j) => j === k ? { ...x, qty: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                <button className="text-slate-400" onClick={() => setItems((l) => l.filter((_, j) => j !== k))}>✕</button>
              </div>
            );
          })}
          <button
            className="btn-primary w-full" disabled={!toBranch || items.length === 0}
            onClick={() => {
              createTransfer(toBranch, branchId, items, session.user_id, "");
              setCreating(false); setItems([]); setToBranch("");
            }}
          >
            Send request to {toBranch ? bname(toBranch) : "…"}
          </button>
        </div>
      )}

      <div className="card divide-y divide-slate-100">
        {transfers.map((t) => {
          const tItems = db.transfer_items.filter((i) => i.transfer_id === t.id);
          const outgoing = t.from_branch_id === branchId;
          const actionable = (outgoing && t.status === "requested") || (!outgoing && t.status === "in_transit");
          return (
            <div key={t.id} className="px-4 py-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-sm">
                    {bname(t.from_branch_id)} → {bname(t.to_branch_id)}
                    {outgoing ? <span className="badge bg-purple-100 text-purple-700 ml-2">we send</span> : <span className="badge bg-blue-100 text-blue-700 ml-2">we receive</span>}
                  </div>
                  <div className="text-xs text-slate-500">{tItems.length} items · {fmtDateTime(t.created_at)}</div>
                  {t.note?.includes("DISCREPANCY") && <div className="text-xs text-red-600 font-semibold mt-1">{t.note.split("\n").find((l) => l.includes("DISCREPANCY"))}</div>}
                </div>
                <div className="text-right">
                  <span className={`badge ${t.status === "received" ? "bg-orange-100 text-orange-700" : t.status === "in_transit" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-700"}`}>{t.status}</span>
                  {actionable && (
                    <button className="btn-primary !py-1.5 !px-3 text-xs block mt-1" onClick={() => {
                      setConfirmT(t);
                      const q: Record<string, number> = {};
                      tItems.forEach((i) => { q[i.id] = t.status === "requested" ? i.qty_requested : (i.qty_sent ?? 0); });
                      setQtys(q);
                    }}>
                      {t.status === "requested" ? "Send →" : "Receive ✓"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {transfers.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No transfers yet</p>}
      </div>

      {confirmT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmT(null)}>
          <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold mb-1">{confirmT.status === "requested" ? "Confirm quantities to SEND" : "Confirm quantities RECEIVED"}</h3>
            <p className="text-xs text-slate-500 mb-3">
              {confirmT.status === "requested" ? "Deducted from your 2F stockroom." : "Added to your 2F stockroom. Differences vs sent qty are flagged."}
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {db.transfer_items.filter((i) => i.transfer_id === confirmT.id).map((i) => {
                const p = db.products.find((pp) => pp.id === i.product_id)!;
                return (
                  <div key={i.id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate">{p.name} <span className="text-xs text-slate-400">(req {i.qty_requested}{i.qty_sent != null ? `, sent ${i.qty_sent}` : ""})</span></span>
                    <input className="input !w-20 text-center !py-2" type="number" value={qtys[i.id] ?? 0}
                      onChange={(e) => setQtys({ ...qtys, [i.id]: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn-ghost flex-1" onClick={() => setConfirmT(null)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={() => {
                if (confirmT.status === "requested") sendTransfer(confirmT.id, qtys, session.user_id);
                else receiveTransfer(confirmT.id, qtys, session.user_id);
                setConfirmT(null);
              }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
