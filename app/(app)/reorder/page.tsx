"use client";
// Reorder Suggestions: items at/below threshold across all branches,
// suggested PO qty = threshold × 2 − current. Printable/exportable PO draft.
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { downloadCSV } from "@/lib/util";

export default function ReorderPage() {
  const db = useDB();
  const session = useSession();
  const [branchFilter, setBranchFilter] = useState("");

  if (!session) return null;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const branches = user.role === "owner" ? db.branches : db.branches.filter((b) => b.id === session.branch_id);

  const rows: { branch: string; product: string; brand: string; size: string; current: number; threshold: number; suggested: number; unit: string }[] = [];
  branches
    .filter((b) => !branchFilter || b.id === branchFilter)
    .forEach((b) => {
      db.products.filter((p) => p.active).forEach((p) => {
        const current = db.inventory
          .filter((i) => i.branch_id === b.id && i.product_id === p.id)
          .reduce((t, i) => t + i.qty, 0);
        if (current <= p.low_stock_threshold) {
          rows.push({
            branch: b.name, product: p.name, brand: p.brand, size: p.size_variant,
            current, threshold: p.low_stock_threshold,
            suggested: Math.max(1, p.low_stock_threshold * 2 - current),
            unit: p.unit,
          });
        }
      });
    });
  rows.sort((a, b) => a.branch.localeCompare(b.branch) || a.current - b.current);

  function exportPO() {
    downloadCSV("purchase-order-draft.csv", [
      ["Branch", "Brand", "Product", "Size", "Unit", "Current", "Threshold", "Suggested Order Qty"],
      ...rows.map((r) => [r.branch, r.brand, r.product, r.size, r.unit, r.current, r.threshold, r.suggested]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 print:hidden">
        <h1 className="font-bold text-lg">🧾 Reorder Suggestions</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={() => window.print()}>🖨️ Print</button>
          <button className="btn-primary !py-2" onClick={exportPO}>⬇️ CSV</button>
        </div>
      </div>
      {user.role === "owner" && (
        <select className="input print:hidden" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="">All branches</option>
          {db.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2">Branch</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-center">Current</th>
              <th className="px-3 py-2 text-center">Threshold</th>
              <th className="px-3 py-2 text-center">Order qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-xs">{r.branch}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold">{r.brand} {r.product}</div>
                  <div className="text-xs text-slate-500">{r.size}</div>
                </td>
                <td className={`px-3 py-2 text-center font-bold tabular-nums ${r.current === 0 ? "text-red-600" : ""}`}>{r.current}</td>
                <td className="px-3 py-2 text-center tabular-nums">{r.threshold}</td>
                <td className="px-3 py-2 text-center font-extrabold text-emerald-700 tabular-nums">{r.suggested} {r.unit}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-8">Nothing at or below threshold 🎉</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
