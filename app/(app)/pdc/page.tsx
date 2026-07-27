"use client";
// PDC (post-dated cheque) due dates. Payables to suppliers and receivables
// from suki/wholesalers, sorted by due date, with a reminder banner for
// cheques due TOMORROW (and anything already overdue).
import { useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { savePDC, setPDCStatus } from "@/lib/actions";
import { blankPDC } from "@/lib/factories";
import { peso, toCentavos, fmtDate, manilaDateKey, downloadCSV } from "@/lib/util";
import { PDCCheck, PDCDirection, PDCStatus } from "@/lib/types";

export default function PDCPage() {
  const db = useDB();
  const session = useSession();
  const [dir, setDir] = useState<PDCDirection | "">("");
  const [showCleared, setShowCleared] = useState(false);
  const [editing, setEditing] = useState<PDCCheck | null>(null);

  if (!session) return null;
  const me = db.users.find((u) => u.id === session.user_id)!;
  const isOwner = me.role === "owner";
  const canEdit = me.role !== "staff";

  const today = manilaDateKey();
  const tomorrow = addDays(today, 1);

  const scope = useMemo(
    () => (isOwner ? db.pdc_checks : db.pdc_checks.filter((c) => c.branch_id === session.branch_id)),
    [db.pdc_checks, isOwner, session.branch_id]
  );

  const rows = scope
    .filter((c) => !dir || c.direction === dir)
    .filter((c) => (showCleared ? true : c.status === "pending"))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const pending = scope.filter((c) => c.status === "pending");
  const dueTomorrow = pending.filter((c) => c.due_date === tomorrow);
  const overdue = pending.filter((c) => c.due_date < today);
  const dueToday = pending.filter((c) => c.due_date === today);

  const totalPayable = pending.filter((c) => c.direction === "payable").reduce((t, c) => t + c.amount, 0);
  const totalReceivable = pending.filter((c) => c.direction === "receivable").reduce((t, c) => t + c.amount, 0);

  function exportCSV() {
    downloadCSV(`pdc-cheques-${today}.csv`, [
      ["Due date", "Direction", "Company / Customer", "Check no", "Bank", "Amount (PHP)", "Date of payment", "Status", "Branch"],
      ...rows.map((c) => [
        c.due_date, c.direction, c.party_name, c.check_number, c.bank,
        (c.amount / 100).toFixed(2), c.date_issued, c.status,
        db.branches.find((b) => b.id === c.branch_id)?.name ?? "",
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="font-bold text-lg">🧾 PDC Due Dates</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={exportCSV}>⬇️ CSV</button>
          {canEdit && (
            <button className="btn-primary !py-2" onClick={() => setEditing(blankPDC(session.branch_id ?? ""))}>+ Add cheque</button>
          )}
        </div>
      </div>

      {/* Reminders */}
      {overdue.length > 0 && (
        <Reminder tone="red" title={`⚠ ${overdue.length} cheque${overdue.length > 1 ? "s" : ""} OVERDUE`} items={overdue} />
      )}
      {dueToday.length > 0 && (
        <Reminder tone="amber" title={`📅 Due TODAY — ${dueToday.length} cheque${dueToday.length > 1 ? "s" : ""}`} items={dueToday} />
      )}
      {dueTomorrow.length > 0 && (
        <Reminder tone="orange" title={`🔔 Reminder: due TOMORROW (${fmtDate(tomorrow)})`} items={dueTomorrow} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Payable to suppliers</div>
          <div className="text-xl font-extrabold text-red-700 tabular-nums">{peso(totalPayable)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Receivable from customers</div>
          <div className="text-xl font-extrabold text-emerald-700 tabular-nums">{peso(totalReceivable)}</div>
        </div>
      </div>

      <div className="card p-3 flex gap-2 items-center flex-wrap">
        <select className="input flex-1" value={dir} onChange={(e) => setDir(e.target.value as PDCDirection | "")}>
          <option value="">All cheques</option>
          <option value="payable">Payable (we pay supplier)</option>
          <option value="receivable">Receivable (customer pays us)</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <input type="checkbox" className="w-5 h-5" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} />
          Show cleared/bounced
        </label>
      </div>

      <div className="card divide-y divide-slate-100">
        {rows.map((c) => {
          const late = c.status === "pending" && c.due_date < today;
          const soon = c.status === "pending" && (c.due_date === today || c.due_date === tomorrow);
          return (
            <div key={c.id} className="px-4 py-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">
                    {c.party_name}
                    <span className={`badge ml-2 ${c.direction === "payable" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
                      {c.direction === "payable" ? "we pay" : "we receive"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    #{c.check_number || "—"} · {c.bank || "bank ?"} · paid {fmtDate(c.date_issued)}
                  </div>
                  <div className={`text-xs font-semibold mt-0.5 ${late ? "text-red-600" : soon ? "text-amber-700" : "text-slate-500"}`}>
                    📅 Due {fmtDate(c.due_date)}{late ? " — OVERDUE" : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-extrabold tabular-nums">{peso(c.amount)}</div>
                  <span className={`badge ${c.status === "cleared" ? "bg-emerald-100 text-emerald-700" : c.status === "bounced" ? "bg-red-100 text-red-700" : c.status === "cancelled" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-800"}`}>
                    {c.status}
                  </span>
                </div>
              </div>
              {canEdit && c.status === "pending" && (
                <div className="flex gap-2 mt-2">
                  <button className="btn-secondary !py-1.5 text-xs flex-1" onClick={() => setPDCStatus(c.id, "cleared", session.user_id)}>✓ Cleared</button>
                  <button className="btn-secondary !py-1.5 text-xs flex-1" onClick={() => setPDCStatus(c.id, "bounced", session.user_id)}>✗ Bounced</button>
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing({ ...c })}>✏️</button>
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No cheques to show</p>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-sm p-5 space-y-2 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{db.pdc_checks.some((x) => x.id === editing.id) ? "Edit cheque" : "New cheque"}</h3>
            <div>
              <label className="label">Type</label>
              <select className="input" value={editing.direction} onChange={(e) => setEditing({ ...editing, direction: e.target.value as PDCDirection })}>
                <option value="payable">Payable — we pay a supplier</option>
                <option value="receivable">Receivable — a customer pays us</option>
              </select>
            </div>
            <div>
              <label className="label">Company / customer name</label>
              <input className="input" value={editing.party_name} onChange={(e) => setEditing({ ...editing, party_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Check number</label>
                <input className="input" value={editing.check_number} onChange={(e) => setEditing({ ...editing, check_number: e.target.value })} /></div>
              <div><label className="label">Bank</label>
                <input className="input" value={editing.bank} onChange={(e) => setEditing({ ...editing, bank: e.target.value })} /></div>
            </div>
            <div><label className="label">Amount ₱</label>
              <input className="input" inputMode="decimal" defaultValue={editing.amount ? (editing.amount / 100).toFixed(2) : ""} onBlur={(e) => setEditing({ ...editing, amount: toCentavos(e.target.value) })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="label">Date of payment</label>
                <input className="input" type="date" value={editing.date_issued} onChange={(e) => setEditing({ ...editing, date_issued: e.target.value })} /></div>
              <div><label className="label">Due date</label>
                <input className="input" type="date" value={editing.due_date} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} /></div>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as PDCStatus })}>
                <option value="pending">pending</option>
                <option value="cleared">cleared</option>
                <option value="bounced">bounced</option>
                <option value="cancelled">cancelled</option>
              </select>
            </div>
            <div><label className="label">Note</label>
              <input className="input" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></div>
            <div className="flex gap-2 pt-1">
              <button className="btn-ghost flex-1" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={!editing.party_name.trim() || editing.amount <= 0}
                onClick={() => { savePDC(editing, session.user_id); setEditing(null); }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Reminder({ tone, title, items }: { tone: "red" | "amber" | "orange"; title: string; items: PDCCheck[] }) {
  const cls =
    tone === "red" ? "bg-red-50 border-red-300 text-red-800"
      : tone === "amber" ? "bg-amber-50 border-amber-300 text-amber-900"
      : "bg-orange-50 border-orange-300 text-orange-900";
  const total = items.reduce((t, c) => t + c.amount, 0);
  return (
    <div className={`card p-4 border-2 ${cls}`}>
      <div className="font-bold mb-2">{title}</div>
      <ul className="space-y-1">
        {items.map((c) => (
          <li key={c.id} className="flex justify-between text-sm">
            <span className="truncate mr-2">
              {c.party_name} <span className="opacity-70">#{c.check_number || "—"}</span>
            </span>
            <span className="font-bold tabular-nums whitespace-nowrap">{peso(c.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between font-extrabold border-t border-current/20 mt-2 pt-2">
        <span>Total</span>
        <span className="tabular-nums">{peso(total)}</span>
      </div>
    </div>
  );
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}
