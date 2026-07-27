"use client";
// Staff payroll. Owner sees every employee across all branches; a manager sees
// their own branch; staff see ONLY their own payslips.
import { useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { computePayroll, savePayroll, deletePayroll } from "@/lib/actions";
import { blankPayroll } from "@/lib/factories";
import { peso, toCentavos, fmtDate, manilaDateKey, downloadCSV } from "@/lib/util";
import { PayrollRecord } from "@/lib/types";

export default function PayrollPage() {
  const db = useDB();
  const session = useSession();
  const [editing, setEditing] = useState<PayrollRecord | null>(null);
  const [userFilter, setUserFilter] = useState("");

  if (!session) return null;
  const me = db.users.find((u) => u.id === session.user_id)!;
  const isOwner = me.role === "owner";
  const isManager = me.role === "manager";
  const canEdit = isOwner || isManager;

  // Who this account may see.
  const visibleUsers = useMemo(() => {
    if (isOwner) return db.users.filter((u) => u.role !== "owner");
    if (isManager) return db.users.filter((u) => u.branch_id === me.branch_id && u.role !== "owner");
    return db.users.filter((u) => u.id === me.id); // staff: self only
  }, [db.users, isOwner, isManager, me]);
  const visibleIds = new Set(visibleUsers.map((u) => u.id));

  const records = db.payroll
    .filter((r) => visibleIds.has(r.user_id))
    .filter((r) => !userFilter || r.user_id === userFilter)
    .sort((a, b) => b.period_end.localeCompare(a.period_end));

  function startNew(userId: string) {
    const u = db.users.find((x) => x.id === userId)!;
    setEditing({
      ...blankPayroll(u.id, u.branch_id ?? "", session!.user_id),
      daily_rate: u.daily_rate,
      hourly_rate: u.hourly_rate,
      period_start: manilaDateKey().slice(0, 8) + "01",
      period_end: manilaDateKey(),
    });
  }

  function exportCSV() {
    downloadCSV(`payroll-${manilaDateKey()}.csv`, [
      ["Employee", "Branch", "Period start", "Period end", "Daily rate", "Days worked", "Days absent",
        "OT hours", "Holiday days", "Days late", "Late minutes", "Day off", "Advance", "Total pay"],
      ...records.map((r) => [
        db.users.find((u) => u.id === r.user_id)?.name ?? "",
        db.branches.find((b) => b.id === r.branch_id)?.name ?? "",
        r.period_start, r.period_end, (r.daily_rate / 100).toFixed(2),
        r.days_worked, r.days_absent, r.overtime_hours, r.holiday_days,
        r.days_late, r.late_minutes, r.days_off,
        (r.advance_salary / 100).toFixed(2), (r.total_pay / 100).toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="font-bold text-lg">🧑‍💼 Payroll</h1>
        <div className="flex gap-2">
          <button className="btn-secondary !py-2" onClick={exportCSV}>⬇️ CSV</button>
        </div>
      </div>

      {!canEdit && (
        <p className="text-xs text-slate-500">Showing your own payslips only.</p>
      )}

      {canEdit && (
        <div className="card p-3">
          <label className="label">Employee</label>
          <div className="flex gap-2">
            <select className="input flex-1" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">All employees{isOwner ? " (all branches)" : ""}</option>
              {visibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {db.branches.find((b) => b.id === u.branch_id)?.name ?? "—"}
                </option>
              ))}
            </select>
            <button className="btn-primary" disabled={!userFilter} onClick={() => startNew(userFilter)}>+ New</button>
          </div>
          {!userFilter && <p className="text-xs text-slate-400 mt-1">Pick an employee to create a payslip.</p>}
        </div>
      )}

      <div className="space-y-2">
        {records.map((r) => {
          const u = db.users.find((x) => x.id === r.user_id);
          return (
            <div key={r.id} className="card p-4">
              <div className="flex justify-between items-start gap-2 mb-2">
                <div>
                  <div className="font-bold">{u?.name}</div>
                  <div className="text-xs text-slate-500">
                    {fmtDate(r.period_start)} → {fmtDate(r.period_end)}
                    {isOwner && ` · ${db.branches.find((b) => b.id === r.branch_id)?.name ?? ""}`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Total pay</div>
                  <div className="text-xl font-extrabold text-orange-700 tabular-nums">{peso(r.total_pay)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-center text-xs">
                <Cell label="Daily rate" value={peso(r.daily_rate)} />
                <Cell label="Days worked" value={String(r.days_worked)} />
                <Cell label="Absent" value={String(r.days_absent)} />
                <Cell label="Day off" value={String(r.days_off)} />
                <Cell label="OT hours" value={String(r.overtime_hours)} />
                <Cell label="Holiday days" value={String(r.holiday_days)} />
                <Cell label="Late" value={`${r.days_late}d / ${r.late_minutes}m`} />
                <Cell label="Advance" value={peso(r.advance_salary)} />
              </div>
              {canEdit && (
                <div className="flex gap-2 mt-3">
                  <button className="btn-secondary !py-1.5 text-xs flex-1" onClick={() => setEditing({ ...r })}>✏️ Edit</button>
                  <button className="btn-secondary !py-1.5 text-xs" onClick={() => window.print()}>🖨️ Print</button>
                </div>
              )}
            </div>
          );
        })}
        {records.length === 0 && (
          <div className="card p-8 text-center text-slate-400 text-sm">No payslips yet</div>
        )}
      </div>

      {editing && (
        <PayrollEditor
          record={editing}
          userName={db.users.find((u) => u.id === editing.user_id)?.name ?? ""}
          onClose={() => setEditing(null)}
          onDelete={db.payroll.some((x) => x.id === editing.id) ? () => { deletePayroll(editing.id, session.user_id); setEditing(null); } : undefined}
          onSave={(r) => { savePayroll(r, session.user_id); setEditing(null); }}
        />
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-2">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-bold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

function PayrollEditor({
  record, userName, onClose, onSave, onDelete,
}: {
  record: PayrollRecord; userName: string;
  onClose: () => void; onSave: (r: PayrollRecord) => void; onDelete?: () => void;
}) {
  const [r, setR] = useState(record);
  const set = (k: keyof PayrollRecord, v: number | string) => setR({ ...r, [k]: v });
  const total = computePayroll(r);

  const numField = (label: string, key: keyof PayrollRecord) => (
    <div>
      <label className="label">{label}</label>
      <input
        className="input" type="number" inputMode="numeric"
        value={r[key] as number}
        onChange={(e) => set(key, parseFloat(e.target.value) || 0)}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-3 rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">Payslip — {userName}</h3>

        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Period start</label>
            <input className="input" type="date" value={r.period_start} onChange={(e) => set("period_start", e.target.value)} /></div>
          <div><label className="label">Period end</label>
            <input className="input" type="date" value={r.period_end} onChange={(e) => set("period_end", e.target.value)} /></div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Daily rate ₱ (salary)</label>
            <input className="input" inputMode="decimal" defaultValue={(r.daily_rate / 100).toFixed(2)}
              onBlur={(e) => set("daily_rate", toCentavos(e.target.value))} />
          </div>
          <div>
            <label className="label">Hourly rate ₱</label>
            <input className="input" inputMode="decimal" defaultValue={(r.hourly_rate / 100).toFixed(2)}
              onBlur={(e) => set("hourly_rate", toCentavos(e.target.value))} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {numField("Number of days", "days_worked")}
          {numField("Days absent", "days_absent")}
          {numField("Day off", "days_off")}
          {numField("Over time (hours)", "overtime_hours")}
          {numField("Working holiday (days)", "holiday_days")}
          {numField("Days late", "days_late")}
          {numField("Late (minutes)", "late_minutes")}
          <div>
            <label className="label">Advance salary ₱</label>
            <input className="input" inputMode="decimal" defaultValue={(r.advance_salary / 100).toFixed(2)}
              onBlur={(e) => set("advance_salary", toCentavos(e.target.value))} />
          </div>
        </div>

        <div><label className="label">Note</label>
          <input className="input" value={r.note} onChange={(e) => set("note", e.target.value)} /></div>

        <div className="rounded-2xl bg-orange-50 border-2 border-orange-200 p-4 text-center">
          <div className="text-[10px] font-bold uppercase tracking-wide text-orange-700">Total pay</div>
          <div className="text-3xl font-extrabold text-orange-800 tabular-nums">{peso(total)}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            (daily × days) + OT×1.25 + holiday premium − late − advance
          </div>
        </div>

        <div className="flex gap-2">
          {onDelete && <button className="btn-danger" onClick={onDelete}>Delete</button>}
          <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={() => onSave({ ...r, total_pay: total })}>Save payslip</button>
        </div>
      </div>
    </div>
  );
}
