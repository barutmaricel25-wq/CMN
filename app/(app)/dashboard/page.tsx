"use client";
// Role-aware home: branch daily sales for staff/manager, all-branch overview for owner.
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { peso, manilaDateKey, daysAgoKey } from "@/lib/util";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line,
} from "recharts";

const BRAND = "#0e7a5f";

export default function Dashboard() {
  const db = useDB();
  const session = useSession();
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const today = manilaDateKey();

  const completed = db.sales.filter((s) => s.status === "completed");
  const todaySales = completed.filter((s) => manilaDateKey(s.created_at) === today);

  const branchToday = (bid: string) => todaySales.filter((s) => s.branch_id === bid);
  const sum = (list: typeof todaySales) => list.reduce((t, s) => t + s.total, 0);

  const myBranch = session.branch_id!;
  const mine = branchToday(myBranch);
  const onsite = mine.filter((s) => s.channel === "onsite");
  const online = mine.filter((s) => s.channel === "online");

  const byMethod = (m: string) => sum(mine.filter((s) => s.payment_method === m));

  // Low stock count for my branch (storefront + stockroom vs threshold)
  const lowStock = db.products.filter((p) => {
    if (!p.active) return false;
    const total = db.inventory
      .filter((i) => i.branch_id === myBranch && i.product_id === p.id)
      .reduce((t, i) => t + i.qty, 0);
    return total <= p.low_stock_threshold;
  });

  const openOrders = db.online_orders.filter(
    (o) => o.branch_id === myBranch && !["picked_up", "cancelled"].includes(o.status)
  );

  // 14-day trend for this branch
  const trend = Array.from({ length: 14 }, (_, i) => {
    const key = daysAgoKey(13 - i);
    const daySales = completed.filter((s) => s.branch_id === myBranch && manilaDateKey(s.created_at) === key);
    return { day: key.slice(5), total: sum(daySales) / 100 };
  });

  // Owner: all-branch comparison today
  const branchCompare = db.branches.map((b) => ({
    name: b.name.replace("Branch ", "B").replace(" - ", " "),
    total: sum(branchToday(b.id)) / 100,
  }));
  const allToday = sum(todaySales);
  const weekKeys = Array.from({ length: 7 }, (_, i) => daysAgoKey(i));
  const allWeek = sum(completed.filter((s) => weekKeys.includes(manilaDateKey(s.created_at))));
  const monthPrefix = today.slice(0, 7);
  const allMonth = sum(completed.filter((s) => manilaDateKey(s.created_at).startsWith(monthPrefix)));

  // Top products (this week, all branches)
  const weekSaleIds = new Set(completed.filter((s) => weekKeys.includes(manilaDateKey(s.created_at))).map((s) => s.id));
  const qtyByProduct = new Map<string, number>();
  db.sale_items.forEach((i) => {
    if (weekSaleIds.has(i.sale_id)) qtyByProduct.set(i.product_id, (qtyByProduct.get(i.product_id) ?? 0) + i.qty);
  });
  const topProducts = [...qtyByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, qty]) => ({ p: db.products.find((pp) => pp.id === pid)!, qty }));

  return (
    <div className="space-y-4">
      {user.role === "owner" && (
        <section className="card p-4">
          <h2 className="font-bold text-lg mb-3">👑 All branches</h2>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Stat label="Today" value={peso(allToday)} />
            <Stat label="This week" value={peso(allWeek)} />
            <Stat label="This month" value={peso(allMonth)} />
          </div>
          <h3 className="label">Today by branch</h3>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={branchCompare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={50} />
                <Tooltip formatter={(v) => `₱${Number(v).toLocaleString()}`} />
                <Bar dataKey="total" name="Sales (₱)" fill={BRAND} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {topProducts.length > 0 && (
            <>
              <h3 className="label mt-4">Top products this week (all branches)</h3>
              <ul className="divide-y divide-slate-100">
                {topProducts.map(({ p, qty }) => (
                  <li key={p.id} className="flex justify-between py-1.5 text-sm">
                    <span className="truncate mr-2">{p.name} {p.size_variant}</span>
                    <span className="font-semibold whitespace-nowrap">{qty} {p.unit}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card p-4">
        <h2 className="font-bold text-lg mb-1">
          {db.branches.find((b) => b.id === myBranch)?.name} — Today
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Auto-totaled from POS + online orders. No more handwritten tally. 📖✂️
        </p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <Stat label="Total sales" value={peso(sum(mine))} big />
          <Stat label={`Onsite (${onsite.length})`} value={peso(sum(onsite))} />
          <Stat label={`Online (${online.length})`} value={peso(sum(online))} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Cash" value={peso(byMethod("cash"))} />
          <Stat label="GCash" value={peso(byMethod("gcash"))} />
          <Stat label="Bank" value={peso(byMethod("bank_transfer"))} />
        </div>
        <h3 className="label mt-4">Last 14 days</h3>
        <div className="h-36">
          <ResponsiveContainer>
            <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={2} />
              <YAxis tick={{ fontSize: 10 }} width={50} />
              <Tooltip formatter={(v) => `₱${Number(v).toLocaleString()}`} />
              <Line type="monotone" dataKey="total" name="Sales (₱)" stroke={BRAND} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link href="/reorder" className="card p-4 hover:border-emerald-500">
          <div className="text-2xl">⚠️</div>
          <div className="font-bold">{lowStock.length} low-stock items</div>
          <div className="text-xs text-slate-500">Tap for reorder suggestions</div>
        </Link>
        <Link href="/orders" className="card p-4 hover:border-emerald-500">
          <div className="text-2xl">📦</div>
          <div className="font-bold">{openOrders.length} open online orders</div>
          <div className="text-xs text-slate-500">Tap to open order board</div>
        </Link>
        <Link href="/inventory/pull-down" className="card p-4 hover:border-emerald-500">
          <div className="text-2xl">⬇️</div>
          <div className="font-bold">Pull Down stock</div>
          <div className="text-xs text-slate-500">Scan items from 2F stockroom</div>
        </Link>
        <Link href="/attendance" className="card p-4 hover:border-emerald-500">
          <div className="text-2xl">⏰</div>
          <div className="font-bold">Clock in / out</div>
          <div className="text-xs text-slate-500">Selfie + GPS</div>
        </Link>
      </section>
    </div>
  );
}

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-extrabold tabular-nums ${big ? "text-lg text-emerald-700" : "text-sm"}`}>{value}</div>
    </div>
  );
}
