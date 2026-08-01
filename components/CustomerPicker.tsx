"use client";
// Picking a customer at the till. A branch can have hundreds of suki and
// wholesaler accounts, and scrolling a long drop-down while somebody waits is
// slow, so this opens a sheet with a search box instead.
//
// Suki and wholesaler accounts belong to the branch that deals with them, so
// this branch's customers are the ones listed. A wholesaler buying at another
// branch still needs to be found, so a search that comes up empty here goes on
// to look at the other branches and shows which branch each one is from.
import { useMemo, useState } from "react";
import { useDB } from "@/lib/store";
import { matchesCustomer } from "@/lib/util";
import { Customer, CUSTOMER_TYPE_LABEL } from "@/lib/types";

const matches = (c: Customer, q: string) =>
  matchesCustomer({ ...c, type: `${c.type} ${CUSTOMER_TYPE_LABEL[c.type]}` }, q);

const tierBadge = (t: Customer["type"]) =>
  t === "retail" ? "bg-slate-200 text-slate-700" : t === "suki" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800";

export default function CustomerPicker({
  branchId,
  value,
  onPick,
  walkInLabel,
  emptyLabel = "Select customer…",
}: {
  branchId: string;
  value: string | null;
  onPick: (id: string | null) => void;
  // When set, an explicit "no customer" choice is offered with this wording.
  walkInLabel?: string;
  emptyLabel?: string;
}) {
  const db = useDB();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const chosen = value ? db.customers.find((c) => c.id === value) ?? null : null;
  const active = useMemo(() => db.customers.filter((c) => c.active), [db.customers]);

  const mine = active.filter((c) => c.branch_id === branchId).filter((c) => matches(c, q));
  const elsewhere = q.trim()
    ? active.filter((c) => c.branch_id !== branchId).filter((c) => matches(c, q))
    : [];

  const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name);
  const here = [...mine].sort(byName).slice(0, 50);
  const others = [...elsewhere].sort(byName).slice(0, 20);

  function choose(id: string | null) {
    onPick(id);
    setOpen(false);
    setQ("");
  }

  const row = (c: Customer, showBranch: boolean) => (
    <button
      key={c.id}
      className="w-full text-left px-3 py-2.5 hover:bg-orange-50 flex justify-between items-center gap-2"
      onClick={() => choose(c.id)}
    >
      <span className="min-w-0">
        <span className="text-sm font-semibold block truncate">{c.name}</span>
        <span className="text-xs text-slate-500 block truncate">
          {[
            showBranch && db.branches.find((b) => b.id === c.branch_id)?.name,
            c.cp_number && `📱 ${c.cp_number}`,
            c.phone !== c.cp_number && c.phone,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className={`badge shrink-0 ${tierBadge(c.type)}`}>{CUSTOMER_TYPE_LABEL[c.type]}</span>
    </button>
  );

  return (
    <>
      <button className="input flex-1 text-left truncate" onClick={() => setOpen(true)}>
        {chosen ? (
          <>
            {chosen.name} <span className="text-slate-400">— {CUSTOMER_TYPE_LABEL[chosen.type]}</span>
          </>
        ) : (
          <span className={walkInLabel ? "" : "text-slate-400"}>{walkInLabel ?? emptyLabel}</span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-md p-4 rounded-b-none sm:rounded-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold mb-2">Choose customer</h3>
            <input
              className="input"
              placeholder="Search name / phone / CP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />

            <div className="mt-2 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
              {walkInLabel && (
                <button
                  className="w-full text-left px-3 py-2.5 hover:bg-orange-50 text-sm font-semibold"
                  onClick={() => choose(null)}
                >
                  {walkInLabel}
                </button>
              )}
              {here.map((c) => row(c, false))}
              {here.length === 0 && !others.length && (
                <p className="text-center text-sm text-slate-400 py-6">
                  {q.trim() ? "No customer matches that" : "No customers for this branch yet"}
                </p>
              )}
              {others.length > 0 && (
                <>
                  <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                    Other branches
                  </div>
                  {others.map((c) => row(c, true))}
                </>
              )}
            </div>

            <button className="btn-ghost w-full mt-2" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
