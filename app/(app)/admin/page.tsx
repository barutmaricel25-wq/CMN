"use client";
// Admin & Settings: branches, users/PINs, receipt text, paper width,
// low-stock default, payroll rates, audit log viewer, demo reset.
import { useState } from "react";
import { useDB, tx, resetDemo } from "@/lib/store";
import SyncBadge from "@/components/SyncBadge";
import { useSession } from "@/lib/session";
import { fmtDateTime, toCentavos } from "@/lib/util";
import { blankUser } from "@/lib/factories";
import { inBranchOrder, Role, User } from "@/lib/types";

type Tab = "settings" | "users" | "branches" | "audit";

export default function AdminPage() {
  const db = useDB();
  const session = useSession();
  const [tab, setTab] = useState<Tab>("settings");

  if (!session) return null;
  const me = db.users.find((u) => u.id === session.user_id)!;
  if (me.role === "staff") return <p className="text-center text-slate-500 py-12">Managers and the owner only.</p>;

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">⚙️ Admin & Settings</h1>
      <div className="flex gap-1 overflow-x-auto">
        {(["settings", "users", "branches", "audit"] as Tab[]).map((t) => (
          <button key={t} className={`btn !py-2 ${tab === t ? "bg-orange-700 text-white" : "bg-white border border-slate-300"}`} onClick={() => setTab(t)}>
            {t === "settings" ? "Settings" : t === "users" ? "Users & PINs" : t === "branches" ? "Branches" : "Audit log"}
          </button>
        ))}
      </div>

      {tab === "settings" && <SettingsTab />}
      {tab === "users" && <UsersTab canManage={me.role === "owner"} />}
      {tab === "branches" && <BranchesTab canManage={me.role === "owner"} />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// Download the whole device database as a dated JSON file.
function backupNow() {
  const raw = localStorage.getItem("cmn-demo-db-v1");
  if (!raw) { window.alert("Nothing to back up yet."); return; }
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cmn-backup-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function SettingsTab() {
  const db = useDB();
  const s = db.settings;
  const set = (patch: Partial<typeof s>) => tx((d) => Object.assign(d.settings, patch));
  return (
    <div className="card p-4 space-y-3">
      <div>
        <label className="label">Receipt header</label>
        <input className="input" defaultValue={s.receipt_header} onBlur={(e) => set({ receipt_header: e.target.value })} />
      </div>
      <div>
        <label className="label">Receipt footer</label>
        <textarea className="input" rows={2} defaultValue={s.receipt_footer} onBlur={(e) => set({ receipt_footer: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Receipt paper width</label>
          <select className="input" value={s.paper_width} onChange={(e) => set({ paper_width: e.target.value as "58mm" | "80mm" })}>
            <option value="58mm">58mm</option>
            <option value="80mm">80mm</option>
          </select>
        </div>
        <div>
          <label className="label">Tax line label</label>
          <input className="input" defaultValue={s.tax_label} onBlur={(e) => set({ tax_label: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Default low-stock threshold</label>
          <input className="input" type="number" defaultValue={s.low_stock_default} onBlur={(e) => set({ low_stock_default: parseInt(e.target.value) || 5 })} />
        </div>
        <div>
          <label className="label">Monthly sales target / branch (₱)</label>
          <input className="input" inputMode="decimal" defaultValue={((s.monthly_target ?? 50000000) / 100).toFixed(0)} onBlur={(e) => set({ monthly_target: Math.max(1, Math.round(parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 500000) * 100) })} />
        </div>
      </div>
      {/* Payroll defaults — prefilled on every new payslip */}
      <div className="pt-2 border-t border-slate-200">
        <div className="label">Payroll defaults</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label !text-[10px]">Daily rate ₱</label>
            <input className="input" inputMode="decimal" defaultValue={((s.default_daily_rate ?? 75500) / 100).toFixed(2)}
              onBlur={(e) => set({ default_daily_rate: toCentavos(e.target.value) })} />
          </div>
          <div>
            <label className="label !text-[10px]">SSS ₱</label>
            <input className="input" inputMode="decimal" defaultValue={((s.sss_rate ?? 49000) / 100).toFixed(2)}
              onBlur={(e) => set({ sss_rate: toCentavos(e.target.value) })} />
          </div>
          <div>
            <label className="label !text-[10px]">PhilHealth ₱</label>
            <input className="input" inputMode="decimal" defaultValue={((s.philhealth_rate ?? 37050) / 100).toFixed(2)}
              onBlur={(e) => set({ philhealth_rate: toCentavos(e.target.value) })} />
          </div>
          <div>
            <label className="label !text-[10px]">Pag-IBIG ₱</label>
            <input className="input" inputMode="decimal" defaultValue={((s.pagibig_rate ?? 20000) / 100).toFixed(2)}
              onBlur={(e) => set({ pagibig_rate: toCentavos(e.target.value) })} />
          </div>
        </div>
      </div>

      {/* Where the data lives, then backup/restore. */}
      <div className="pt-2 border-t border-slate-200 space-y-2">
        <div className="label">Data & sync</div>
        <SyncBadge full />
        <div className="label">Backup & restore</div>
        <p className="text-xs text-slate-500 mb-2">
          Save a backup file to keep a copy of everything as it stands. Restoring replaces the data on this device.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secondary" onClick={backupNow}>⬇️ Save backup</button>
          <label className="btn-secondary cursor-pointer">
            ⬆️ Restore backup
            <input
              type="file" accept="application/json,.json" hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                f.text().then((text) => {
                  try {
                    const parsed = JSON.parse(text);
                    if (!parsed || !Array.isArray(parsed.products)) throw new Error("not a CMN backup");
                    if (!window.confirm("Restore this backup? It replaces the data currently on this device.")) return;
                    localStorage.setItem("cmn-demo-db-v1", JSON.stringify(parsed));
                    window.location.reload();
                  } catch {
                    window.alert("That file doesn't look like a CMN backup.");
                  }
                });
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-200">
        <button
          className="btn-danger w-full"
          onClick={() => { if (window.confirm("Reset ALL demo data back to the seed? This clears everything you entered — save a backup first if you need it.")) resetDemo(); }}
        >
          🔄 Reset demo data
        </button>
      </div>
    </div>
  );
}

function UsersTab({ canManage }: { canManage: boolean }) {
  const db = useDB();
  const [editing, setEditing] = useState<User | null>(null);
  return (
    <div className="space-y-3">
      {canManage && (
        <button className="btn-primary w-full" onClick={() => setEditing(blankUser(db.branches[0].id))}>
          + Add user
        </button>
      )}
      <div className="card divide-y divide-slate-100">
        {db.users.map((u) => (
          <button key={u.id} disabled={!canManage} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex justify-between items-center" onClick={() => setEditing({ ...u })}>
            <div>
              <div className="text-sm font-semibold">{u.name} {!u.active && <span className="badge bg-slate-200 text-slate-500">inactive</span>}</div>
              <div className="text-xs text-slate-500">{u.role} · {u.branch_id ? db.branches.find((b) => b.id === u.branch_id)?.name : "all branches"} · PIN {u.pin}</div>
            </div>
            {canManage && <span className="text-slate-300">✏️</span>}
          </button>
        ))}
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-md p-5 space-y-2 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold">User</h3>
            <input className="input" placeholder="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <div className="flex gap-2">
              <select className="input" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role, branch_id: e.target.value === "owner" ? null : editing.branch_id ?? db.branches[0].id })}>
                <option value="staff">staff</option>
                <option value="manager">manager</option>
                <option value="owner">owner</option>
              </select>
              {editing.role !== "owner" && (
                <select className="input" value={editing.branch_id ?? ""} onChange={(e) => setEditing({ ...editing, branch_id: e.target.value })}>
                  {db.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <input className="input font-mono" placeholder="4-digit PIN" maxLength={4} value={editing.pin} onChange={(e) => setEditing({ ...editing, pin: e.target.value.replace(/\D/g, "") })} />
              <label className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
                <input type="checkbox" className="w-5 h-5" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active
              </label>
            </div>

            {/* Contact & address */}
            <div className="pt-2 border-t border-slate-200">
              <div className="label">Contact</div>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" placeholder="Contact number" inputMode="tel" value={editing.contact_number} onChange={(e) => setEditing({ ...editing, contact_number: e.target.value })} />
                <input className="input" type="date" title="Birthday" value={editing.birthday} onChange={(e) => setEditing({ ...editing, birthday: e.target.value })} />
              </div>
              <input className="input mt-2" placeholder="Address" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </div>

            {/* Government IDs */}
            <div className="pt-2 border-t border-slate-200">
              <div className="label">Government IDs</div>
              <div className="space-y-2">
                <input className="input" placeholder="SSS ID" value={editing.sss_id} onChange={(e) => setEditing({ ...editing, sss_id: e.target.value })} />
                <input className="input" placeholder="PhilHealth ID" value={editing.philhealth_id} onChange={(e) => setEditing({ ...editing, philhealth_id: e.target.value })} />
                <input className="input" placeholder="Pag-IBIG ID" value={editing.pagibig_id} onChange={(e) => setEditing({ ...editing, pagibig_id: e.target.value })} />
              </div>
            </div>

            {/* Employment & rates */}
            <div className="pt-2 border-t border-slate-200">
              <div className="label">Employment & pay rates</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label !text-[10px]">Hired date</label>
                  <input className="input" type="date" value={editing.hired_date} onChange={(e) => setEditing({ ...editing, hired_date: e.target.value })} />
                </div>
                <div>
                  <label className="label !text-[10px]">Salary rate ₱ / month</label>
                  <input className="input" inputMode="decimal" defaultValue={(editing.salary_rate / 100).toFixed(2)}
                    onBlur={(e) => {
                      const monthly = toCentavos(e.target.value);
                      setEditing({
                        ...editing, salary_rate: monthly,
                        daily_rate: editing.daily_rate || Math.round(monthly / 26),
                        hourly_rate: editing.hourly_rate || Math.round(monthly / 26 / 8),
                      });
                    }} />
                </div>
                <div>
                  <label className="label !text-[10px]">Daily rate ₱</label>
                  <input className="input" inputMode="decimal" defaultValue={(editing.daily_rate / 100).toFixed(2)}
                    onBlur={(e) => setEditing({ ...editing, daily_rate: toCentavos(e.target.value) })} />
                </div>
                <div>
                  <label className="label !text-[10px]">Hourly rate ₱</label>
                  <input className="input" inputMode="decimal" defaultValue={(editing.hourly_rate / 100).toFixed(2)}
                    onBlur={(e) => setEditing({ ...editing, hourly_rate: toCentavos(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button className="btn-ghost flex-1" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary flex-1" disabled={!editing.name.trim() || editing.pin.length !== 4}
                onClick={() => {
                  tx((d) => {
                    const i = d.users.findIndex((x) => x.id === editing.id);
                    if (i >= 0) d.users[i] = editing; else d.users.push(editing);
                  });
                  setEditing(null);
                }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BranchesTab({ canManage }: { canManage: boolean }) {
  const db = useDB();

  // Swap two branches' places in the list. Numbers are rewritten from scratch
  // so an order set before this existed can't leave gaps or ties.
  function swap(a: number, b: number) {
    const order = db.branches.map((x) => x.id);
    [order[a], order[b]] = [order[b], order[a]];
    tx((d) => {
      order.forEach((id, i) => {
        const br = d.branches.find((x) => x.id === id);
        if (br) br.sort_order = i + 1;
      });
      d.branches = inBranchOrder(d.branches);
    });
  }

  return (
    <div className="card divide-y divide-slate-100">
      {canManage && (
        <p className="px-4 py-2 text-xs text-slate-500 bg-slate-50">
          Tap a name or address to edit — changes save when you leave the field and show everywhere (header, receipts,
          reports). Use ↑ ↓ to set the order the branches are listed in.
        </p>
      )}
      {db.branches.map((b, i) => (
        <div key={b.id} className="px-4 py-3">
          {canManage && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-[11px] font-bold text-slate-400 w-4">{i + 1}.</span>
              <button
                className="btn-secondary !py-1 !px-2 text-xs disabled:opacity-30"
                disabled={i === 0}
                title="Move up the list"
                onClick={() => swap(i, i - 1)}
              >
                ↑
              </button>
              <button
                className="btn-secondary !py-1 !px-2 text-xs disabled:opacity-30"
                disabled={i === db.branches.length - 1}
                title="Move down the list"
                onClick={() => swap(i, i + 1)}
              >
                ↓
              </button>
            </div>
          )}
          {canManage ? (
            <>
              <input
                className="input !py-1.5 text-sm font-semibold mb-1"
                defaultValue={b.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== b.name)
                    tx((d) => {
                      const br = d.branches.find((x) => x.id === b.id);
                      if (br) br.name = v;
                    });
                }}
              />
              <input
                className="input !py-1.5 text-xs"
                placeholder="Address"
                defaultValue={b.address}
                onBlur={(e) =>
                  tx((d) => {
                    const br = d.branches.find((x) => x.id === b.id);
                    if (br) br.address = e.target.value.trim();
                  })
                }
              />
            </>
          ) : (
            <>
              <div className="text-sm font-semibold">{b.name}</div>
              <div className="text-xs text-slate-500">{b.address}</div>
            </>
          )}
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mt-2">
            <input
              type="checkbox"
              className="w-4 h-4"
              disabled={!canManage}
              checked={b.has_stockroom !== false}
              onChange={(e) =>
                tx((d) => {
                  const br = d.branches.find((x) => x.id === b.id);
                  if (br) br.has_stockroom = e.target.checked;
                })
              }
            />
            Has 2F stockroom (unchecked: deliveries & transfers go straight to store floor)
          </label>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
            📍 {b.geofence_lat.toFixed(4)}, {b.geofence_lng.toFixed(4)} · radius{" "}
            {canManage ? (
              <input
                className="input !w-20 !py-1 text-center"
                type="number"
                defaultValue={b.geofence_radius_m}
                onBlur={(e) =>
                  tx((d) => {
                    const br = d.branches.find((x) => x.id === b.id);
                    if (br) br.geofence_radius_m = parseInt(e.target.value) || 120;
                  })
                }
              />
            ) : (
              b.geofence_radius_m
            )}{" "}
            m
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditTab() {
  const db = useDB();
  const [q, setQ] = useState("");
  const rows = db.audit_log
    .filter((a) => {
      if (!q) return true;
      const u = db.users.find((x) => x.id === a.user_id);
      return (
        a.action.includes(q.toLowerCase()) ||
        a.entity.includes(q.toLowerCase()) ||
        (u?.name.toLowerCase().includes(q.toLowerCase()) ?? false)
      );
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 200);
  return (
    <div className="space-y-2">
      <input className="input" placeholder="Filter by user / action / entity…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card divide-y divide-slate-100">
        {rows.map((a) => {
          const u = db.users.find((x) => x.id === a.user_id);
          return (
            <div key={a.id} className="px-4 py-2">
              <div className="text-sm">
                <b>{u?.name ?? a.user_id}</b> · <span className="badge bg-slate-200 text-slate-700">{a.action}</span> {a.entity}
              </div>
              <div className="text-xs text-slate-500">{fmtDateTime(a.created_at)} {a.after && <span className="font-mono">· {a.after.slice(0, 100)}</span>}</div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-center text-sm text-slate-400 py-8">Empty audit log</p>}
      </div>
    </div>
  );
}
