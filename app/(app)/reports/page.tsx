"use client";
// End-of-day report + date-range reports with CSV export.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { peso, manilaDateKey, fmtTime, downloadCSV } from "@/lib/util";

export default function ReportsPage() {
  const db = useDB();
  const session = useSession();
  const today = manilaDateKey();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  if (!session) return null;
  const branchId = session.branch_id!;
  const branch = db.branches.find((b) => b.id === branchId);

  const inRange = db.sales
    .filter((s) => s.branch_id === branchId)
    .filter((s) => {
      const k = manilaDateKey(s.created_at);
      return k >= from && k <= to;
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const completed = inRange.filter((s) => s.status === "completed");
  const voided = inRange.filter((s) => s.status === "voided");
  const sum = (l: typeof completed) => l.reduce((t, s) => t + s.total, 0);
  const byMethod = (m: string) => completed.filter((s) => s.payment_method === m);
  const cashExpected = sum(byMethod("cash").filter((s) => s.channel === "onsite"));

  function exportCSV() {
    downloadCSV(`sales-${from}-to-${to}.csv`, [
      ["Receipt No", "Date/Time", "Channel", "Cashier", "Customer", "Payment", "Status", "Total (PHP)"],
      ...inRange.map((s) => [
        String(s.receipt_no).padStart(6, "0"),
        new Date(s.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
        s.channel,
        db.users.find((u) => u.id === s.cashier_id)?.name ?? "",
        s.customer_id ? db.customers.find((c) => c.id === s.customer_id)?.name ?? "" : "Walk-in",
        s.payment_method,
        s.status,
        (s.total / 100).toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap print:hidden">
        <h1 className="font-bold text-lg">📈 Reports — {branch?.name}</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={() => window.print()}>🖨️ Print</button>
          <button className="btn-primary !py-2" onClick={exportCSV}>⬇️ CSV</button>
        </div>
      </div>

      <div className="card p-3 flex gap-2 items-end print:hidden">
        <div className="flex-1">
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label">To</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-secondary" onClick={() => { setFrom(today); setTo(today); }}>Today</button>
      </div>

      <div className="card p-4">
        <h2 className="font-bold mb-3">{from === to ? `End-of-day — ${from}` : `${from} → ${to}`}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Tile label="Total sales" value={peso(sum(completed))} strong />
          <Tile label={`Onsite (${completed.filter((s) => s.channel === "onsite").length})`} value={peso(sum(completed.filter((s) => s.channel === "onsite")))} />
          <Tile label={`Online (${completed.filter((s) => s.channel === "online").length})`} value={peso(sum(completed.filter((s) => s.channel === "online")))} />
          <Tile label={`Voids (${voided.length})`} value={peso(voided.reduce((t, s) => t + s.total, 0))} />
          <Tile label="Cash" value={peso(sum(byMethod("cash")))} />
          <Tile label="GCash" value={peso(sum(byMethod("gcash")))} />
          <Tile label="Bank transfer" value={peso(sum(byMethod("bank_transfer")))} />
          <Tile label="💵 Cash expected in drawer" value={peso(cashExpected)} strong />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
              <th className="py-1.5">#</th><th>Time</th><th>Cashier</th><th>Pay</th><th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inRange.map((s) => (
              <tr key={s.id} className={s.status === "voided" ? "text-red-500 line-through" : ""}>
                <td className="py-1.5 font-mono text-xs">{String(s.receipt_no).padStart(6, "0")}</td>
                <td className="text-xs">{fmtTime(s.created_at)}</td>
                <td className="text-xs">{db.users.find((u) => u.id === s.cashier_id)?.name?.split(" ")[0]}</td>
                <td className="text-xs">{s.payment_method === "bank_transfer" ? "bank" : s.payment_method}{s.channel === "online" ? " 📦" : ""}</td>
                <td className="text-right font-semibold tabular-nums">{peso(s.total)}</td>
              </tr>
            ))}
            {inRange.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-8">No sales in range</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-2.5 ${strong ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-extrabold tabular-nums ${strong ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}
