"use client";
// Stock count mode: scan-based physical count → generates adjustment movements
// for the differences (manager PIN to apply).
import { useState } from "react";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { adjustStock } from "@/lib/actions";
import { Location } from "@/lib/types";
import BarcodeInput from "@/components/BarcodeInput";
import PinModal from "@/components/PinModal";

export default function StockCountPage() {
  const db = useDB();
  const session = useSession();
  const [location, setLocation] = useState<Location>("storefront");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pin, setPin] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");

  const branchId = session?.branch_id ?? "";
  if (!session) return null;

  const systemQty = (pid: string) =>
    db.inventory.find((i) => i.branch_id === branchId && i.product_id === pid && i.location === location)?.qty ?? 0;

  function onScan(code: string) {
    const p = db.products.find((x) => x.active && (x.barcode === code || x.sku.toLowerCase() === code.toLowerCase()));
    if (!p) { setMsg(`❌ Unknown barcode “${code}”`); return; }
    setCounts((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }));
    setMsg(`✅ ${p.name}: counted ${(counts[p.id] ?? 0) + 1}`);
  }

  const diffs = Object.entries(counts)
    .map(([pid, counted]) => ({ pid, counted, system: systemQty(pid), diff: counted - systemQty(pid) }))
    .filter((d) => d.diff !== 0);

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">🔢 Stock Count — {location === "storefront" ? "Store Floor" : "2F Stockroom"}</h1>
      <div className="card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {(["storefront", "stockroom"] as Location[]).map((l) => (
            <button key={l} className={`btn ${location === l ? "bg-emerald-700 text-white" : "bg-white border border-slate-300"}`}
              onClick={() => { setLocation(l); setCounts({}); setDone(false); }}>
              {l === "storefront" ? "🏪 Store floor" : "📦 2F stockroom"}
            </button>
          ))}
        </div>
        <BarcodeInput onScan={onScan} placeholder="Scan every unit (each scan = +1)…" />
        {msg && <p className="text-sm font-semibold">{msg}</p>}
      </div>

      <div className="card divide-y divide-slate-100">
        {Object.entries(counts).map(([pid, counted]) => {
          const p = db.products.find((pp) => pp.id === pid)!;
          const sys = systemQty(pid);
          const diff = counted - sys;
          return (
            <div key={pid} className="px-4 py-2 flex justify-between items-center">
              <div className="text-sm font-semibold truncate mr-2">{p.name}</div>
              <div className="text-sm tabular-nums whitespace-nowrap">
                counted <b>{counted}</b> / system {sys}{" "}
                {diff !== 0 && <span className={`badge ${diff > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{diff > 0 ? "+" : ""}{diff}</span>}
              </div>
            </div>
          );
        })}
        {Object.keys(counts).length === 0 && <p className="text-center text-sm text-slate-400 py-8">Scan items to count</p>}
      </div>

      {diffs.length > 0 && !done && (
        <button className="btn-primary w-full" onClick={() => setPin(true)}>
          Apply {diffs.length} correction{diffs.length > 1 ? "s" : ""} (manager PIN)
        </button>
      )}
      {done && <p className="text-center text-sm text-emerald-700 font-semibold">✅ Corrections posted as adjustment movements.</p>}

      {pin && (
        <PinModal
          title="Manager PIN required" subtitle="Post count corrections" managerOnly branch_id={branchId}
          onCancel={() => setPin(false)}
          onSuccess={(mgr) => {
            diffs.forEach((d) => adjustStock(d.pid, branchId, location, d.diff, "Stock count correction", session.user_id, mgr.id));
            setPin(false); setDone(true); setCounts({});
          }}
        />
      )}
    </div>
  );
}
