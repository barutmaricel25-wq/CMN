"use client";
// Expenses by category (store rental, electricity, water, telephone bills,
// plastic bags, daily expenses).
// Managers record for their branch; the owner sees and filters every branch.
import { useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { saveExpense, deleteExpense } from "@/lib/actions";
import { blankExpense } from "@/lib/factories";
import { peso, toCentavos, fmtDate, manilaDateKey, downloadCSV } from "@/lib/util";
import { EXPENSE_CATEGORIES, Expense, ExpenseCategory, isManagerLevel } from "@/lib/types";

const CAT_ICON: Record<ExpenseCategory, string> = {
  "store rental": "🏠",
  electricity: "💡",
  water: "🚰",
  "telephone bills": "☎️",
  "plastic bags": "🛍️",
  "daily expenses": "🧾",
  other: "📌",
};

// What to write in the note, in the shop's own terms.
const NOTE_HINT: Record<ExpenseCategory, string> = {
  "store rental": "e.g. October rent",
  electricity: "e.g. Meralco bill October",
  water: "e.g. Maynilad bill October",
  "telephone bills": "e.g. PLDT landline October",
  "plastic bags": "e.g. 1,000 pcs large — Divisoria",
  "daily expenses": "e.g. Meals, tricycle fare",
  other: "e.g. Repair of freezer, permit fee",
};

export default function ExpensesPage() {
  const db = useDB();
  const session = useSession();
  const [editing, setEditing] = useState<Expense | null>(null);
  const [month, setMonth] = useState(manilaDateKey().slice(0, 7));
  const [branchFilter, setBranchFilter] = useState("");

  if (!session) return null;
  const me = db.users.find((u) => u.id === session.user_id)!;
  const isOwner = me.role === "owner";
  const branchId = session.branch_id!;
  const canEdit = isManagerLevel(me.role);

  const rows = useMemo(() => {
    const scope = isOwner
      ? db.expenses.filter((e) => !branchFilter || e.branch_id === branchFilter)
      : db.expenses.filter((e) => e.branch_id === branchId);
    return scope
      .filter((e) => e.date.startsWith(month))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db.expenses, isOwner, branchFilter, branchId, month]);

  const total = rows.reduce((t, e) => t + e.amount, 0);
  const byCat = EXPENSE_CATEGORIES.map((c) => ({
    c,
    amount: rows.filter((e) => e.category === c).reduce((t, e) => t + e.amount, 0),
  }));
  const maxCat = Math.max(...byCat.map((b) => b.amount), 1);

  function exportCSV() {
    downloadCSV(`expenses-${month}.csv`, [
      ["Date", "Branch", "Category", "Amount (PHP)", "Note", "Recorded by"],
      ...rows.map((e) => [
        e.date,
        db.branches.find((b) => b.id === e.branch_id)?.name ?? "",
        e.category,
        (e.amount / 100).toFixed(2),
        e.note,
        db.users.find((u) => u.id === e.recorded_by)?.name ?? "",
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="font-bold text-lg">💸 Expenses</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={exportCSV}>⬇️ CSV</button>
          {canEdit && (
            <button className="btn-primary !py-2" onClick={() => setEditing(blankExpense(branchId, session.user_id))}>
              + Add expense
            </button>
          )}
        </div>
      </div>

      <div className="card p-3 flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[8rem]">
          <label className="label">Month</label>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {isOwner && (
          <div className="flex-1 min-w-[10rem]">
            <label className="label">Branch</label>
            <select className="input" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {db.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Category summary */}
      <div className="card p-4">
        <div className="flex justify-between items-baseline mb-3">
          <h2 className="font-bold">Total this month</h2>
          <span className="text-2xl font-extrabold text-orange-700 tabular-nums">{peso(total)}</span>
        </div>
        <div className="space-y-2">
          {byCat.map(({ c, amount }) => (
            <div key={c}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="font-semibold text-slate-600">{CAT_ICON[c]} {c}</span>
                <span className="font-bold tabular-nums">{peso(amount)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-200">
                <div className="h-2.5 rounded-full bg-gradient-to-r from-orange-700 to-orange-400" style={{ width: `${Math.max(2, (amount / maxCat) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="card divide-y divide-slate-100">
        {rows.map((e) => (
          <div key={e.id} className="px-4 py-2.5 flex justify-between items-center gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {CAT_ICON[e.category]} {e.category === "other" && e.note ? e.note : e.category}
                {isOwner && <span className="text-xs text-slate-400 ml-1">· {db.branches.find((b) => b.id === e.branch_id)?.name}</span>}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {fmtDate(e.date)}{e.note && ` · ${e.note}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-bold tabular-nums">{peso(e.amount)}</span>
              {canEdit && <button className="text-slate-400 px-1" onClick={() => setEditing({ ...e })}>✏️</button>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No expenses recorded for this month</p>}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-sm p-5 space-y-2 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg">{db.expenses.some((x) => x.id === editing.id) ? "Edit expense" : "New expense"}</h3>
            <div>
              <label className="label">Category</label>
              <select className="input" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value as ExpenseCategory })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Amount ₱</label>
                <input className="input" inputMode="decimal" defaultValue={editing.amount ? (editing.amount / 100).toFixed(2) : ""} onBlur={(e) => setEditing({ ...editing, amount: toCentavos(e.target.value) })} autoFocus />
              </div>
              <div>
                <label className="label">Date</label>
                <input className="input" type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
              </div>
            </div>
            {isOwner && (
              <div>
                <label className="label">Branch</label>
                <select className="input" value={editing.branch_id} onChange={(e) => setEditing({ ...editing, branch_id: e.target.value })}>
                  {db.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">
                {editing.category === "other" ? "What is this expense for? *" : "Note"}
              </label>
              <input
                className="input"
                placeholder={NOTE_HINT[editing.category]}
                value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              />
              {editing.category === "other" && !editing.note.trim() && (
                <p className="text-xs text-amber-700 font-semibold mt-1">
                  Please type what this expense is for so the record makes sense later.
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              {db.expenses.some((x) => x.id === editing.id) && (
                <button className="btn-danger" onClick={() => { deleteExpense(editing.id, session.user_id); setEditing(null); }}>Delete</button>
              )}
              <button className="btn-ghost flex-1" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="btn-primary flex-1"
                disabled={editing.amount <= 0 || (editing.category === "other" && !editing.note.trim())}
                onClick={() => { saveExpense(editing); setEditing(null); }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
