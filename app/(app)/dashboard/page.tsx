"use client";
// Business Dashboard — light theme: gradient KPI tiles on white, daily sales
// trend, bestsellers, channel/payment breakdown, inventory status, target ring.
// Profit figures are owner-only (cost prices are sensitive).
import Link from "next/link";
import { useDB } from "@/lib/store";
import { useSession } from "@/lib/session";
import { peso, manilaDateKey, daysAgoKey } from "@/lib/util";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  AreaChart, Area,
} from "recharts";

const GRID = "#e2e8f0";
const TICK = "#64748b";
const GREEN = "#059669";
const ORANGE = "#ea580c";

export default function Dashboard() {
  const db = useDB();
  const session = useSession();
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const isOwner = user.role === "owner";
  const today = manilaDateKey();
  const monthPrefix = today.slice(0, 7);
  const myBranch = session.branch_id!;
  const branch = db.branches.find((b) => b.id === myBranch);

  const completed = db.sales.filter((s) => s.status === "completed");
  const sum = (l: typeof completed) => l.reduce((t, s) => t + s.total, 0);

  const mineToday = completed.filter((s) => s.branch_id === myBranch && manilaDateKey(s.created_at) === today);
  const mineMonth = completed.filter((s) => s.branch_id === myBranch && manilaDateKey(s.created_at).startsWith(monthPrefix));

  // Items sold today + profit today (from sale_items vs cost)
  const todayIds = new Set(mineToday.map((s) => s.id));
  const monthIds = new Set(mineMonth.map((s) => s.id));
  let itemsToday = 0, profitToday = 0;
  const qtyByProductMonth = new Map<string, number>();
  db.sale_items.forEach((i) => {
    if (todayIds.has(i.sale_id)) {
      itemsToday += i.qty;
      const p = db.products.find((pp) => pp.id === i.product_id);
      profitToday += (i.unit_price - (p?.cost_price ?? 0)) * i.qty;
    }
    if (monthIds.has(i.sale_id)) {
      qtyByProductMonth.set(i.product_id, (qtyByProductMonth.get(i.product_id) ?? 0) + i.qty);
    }
  });
  const salesToday = sum(mineToday);
  const marginToday = salesToday > 0 ? Math.round((profitToday / salesToday) * 100) : 0;

  // Inventory status for this branch
  let inStock = 0, lowStock = 0, outStock = 0;
  db.products.filter((p) => p.active).forEach((p) => {
    const total = db.inventory
      .filter((i) => i.branch_id === myBranch && i.product_id === p.id)
      .reduce((t, i) => t + i.qty, 0);
    if (total <= 0) outStock++;
    else if (total <= p.low_stock_threshold) lowStock++;
    else inStock++;
  });

  // Daily sales trend — this month, day 1..today
  const dayOfMonth = parseInt(today.slice(8), 10);
  const trend = Array.from({ length: dayOfMonth }, (_, i) => {
    const key = `${monthPrefix}-${String(i + 1).padStart(2, "0")}`;
    return {
      day: i + 1,
      total: sum(completed.filter((s) => s.branch_id === myBranch && manilaDateKey(s.created_at) === key)) / 100,
    };
  });
  const peak = Math.max(...trend.map((t) => t.total), 0);

  // Bestsellers this month (top 5 by qty)
  const best = [...qtyByProductMonth.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pid, qty]) => ({ p: db.products.find((pp) => pp.id === pid)!, qty }));
  const bestMax = Math.max(...best.map((b) => b.qty), 1);

  // Channel + payment breakdown (this month)
  const chan = [
    { label: "Onsite", v: sum(mineMonth.filter((s) => s.channel === "onsite")) },
    { label: "Online", v: sum(mineMonth.filter((s) => s.channel === "online")) },
    { label: "Cash", v: sum(mineMonth.filter((s) => s.payment_method === "cash")) },
    { label: "GCash", v: sum(mineMonth.filter((s) => s.payment_method === "gcash")) },
    { label: "Bank", v: sum(mineMonth.filter((s) => s.payment_method === "bank_transfer")) },
  ];
  const chanMax = Math.max(...chan.map((c) => c.v), 1);

  // Monthly target ring
  const target = db.settings.monthly_target ?? 50000000;
  const monthSales = sum(mineMonth);
  const pct = Math.min(999, Math.round((monthSales / target) * 100));

  // Owner: all branches today + week/month totals
  const allToday = sum(completed.filter((s) => manilaDateKey(s.created_at) === today));
  const weekKeys = Array.from({ length: 7 }, (_, i) => daysAgoKey(i));
  const allWeek = sum(completed.filter((s) => weekKeys.includes(manilaDateKey(s.created_at))));
  const allMonth = sum(completed.filter((s) => manilaDateKey(s.created_at).startsWith(monthPrefix)));
  const branchCompare = db.branches.map((b) => ({
    name: b.name.replace("Branch ", "B").split(" - ")[0],
    total: sum(completed.filter((s) => s.branch_id === b.id && manilaDateKey(s.created_at) === today)) / 100,
  }));

  // Cheques due today/tomorrow or already overdue (owner sees all branches).
  const tomorrowKey = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); })();
  const pdcDue = db.pdc_checks
    .filter((c) => c.status === "pending")
    .filter((c) => isOwner || c.branch_id === myBranch)
    .filter((c) => c.due_date <= tomorrowKey).length;

  const money = (v: unknown) => `₱${Number(v).toLocaleString()}`;

  return (
    <div className="-m-4 min-h-[calc(100vh-3.5rem)] bg-slate-100 p-4 pb-24 text-slate-900">
      {/* Title bar */}
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-xl font-extrabold italic tracking-wide text-slate-900">BUSINESS DASHBOARD</h1>
          <p className="text-xs text-slate-500">{branch?.name} · {new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "long", year: "numeric" })}</p>
        </div>
        <span className="text-[10px] text-slate-500 text-right">Daily and monthly report<br />in a glance</span>
      </div>

      {/* KPI gradient tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Kpi title="Sales Today" value={peso(salesToday)} icon="💵" grad="from-emerald-500 to-green-700" />
        <Kpi title="Items Sold Today" value={String(itemsToday)} icon="📦" grad="from-sky-500 to-blue-700" />
        {isOwner ? (
          <Kpi title="Profit Today" value={peso(profitToday)} sub={`${marginToday}% margin`} icon="📈" grad="from-amber-400 to-orange-600" />
        ) : (
          <Kpi title="Transactions Today" value={String(mineToday.length)} icon="🧾" grad="from-amber-400 to-orange-600" />
        )}
        <Kpi title="Low / Out of Stock" value={`${lowStock} / ${outStock}`} icon="⚠️" grad="from-rose-500 to-red-700" href="/reorder" />
      </div>

      {/* Owner: company-wide totals across all branches */}
      {isOwner && (
        <div className="rounded-2xl bg-gradient-to-br from-orange-700 to-orange-900 p-4 mb-3 shadow-lg">
          <div className="text-[11px] font-bold uppercase tracking-wide text-orange-100 mb-2">
            👑 All branches combined ({db.branches.length} stores)
          </div>
          <div className="grid grid-cols-3 gap-3 text-white">
            <div>
              <div className="text-[10px] uppercase text-orange-200 font-bold">Today</div>
              <div className="text-xl font-extrabold tabular-nums leading-tight">{peso(allToday)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-orange-200 font-bold">This week</div>
              <div className="text-xl font-extrabold tabular-nums leading-tight">{peso(allWeek)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-orange-200 font-bold">This month</div>
              <div className="text-xl font-extrabold tabular-nums leading-tight">{peso(allMonth)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Navy stat tiles: this month */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Navy label="This Month" value={peso(monthSales)} />
        <Navy label={`Onsite (${mineMonth.filter((s) => s.channel === "onsite").length})`} value={peso(chan[0].v)} />
        <Navy label={`Online (${mineMonth.filter((s) => s.channel === "online").length})`} value={peso(chan[1].v)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Daily sales trend */}
        <Panel title="Daily Sales Trend" right={peak > 0 ? `Peak ₱${peak.toLocaleString()}` : ""} className="lg:col-span-2">
          <div className="h-48">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.7} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: TICK }} interval={1} />
                <YAxis tick={{ fontSize: 9, fill: TICK }} width={48} />
                <Tooltip
                  formatter={money}
                  contentStyle={{ background: "#ffffff", border: `1px solid ${GRID}`, borderRadius: 8, color: "#0f172a" }}
                  labelFormatter={(d) => `Day ${d}`}
                />
                <Area type="monotone" dataKey="total" name="Sales (₱)" stroke={GREEN} strokeWidth={2} fill="url(#gTrend)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Monthly target ring */}
        <Panel title="Monthly Sales Target">
          <div className="flex items-center gap-4">
            <Ring pct={pct} />
            <div className="text-sm">
              <div className="text-slate-500 text-xs">Current</div>
              <div className="font-extrabold text-slate-900 tabular-nums">{peso(monthSales)}</div>
              <div className="text-slate-500 text-xs mt-2">Goal</div>
              <div className="font-bold text-slate-600 tabular-nums">{peso(target)}</div>
            </div>
          </div>
        </Panel>

        {/* Bestselling items */}
        <Panel title="Bestselling Items (this month)" className="lg:col-span-2">
          <div className="space-y-2">
            {best.map(({ p, qty }) => (
              <div key={p.id}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="truncate mr-2 text-slate-600">{p.name} {p.size_variant}</span>
                  <span className="font-bold text-slate-900 tabular-nums">{qty} {p.unit}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200">
                  <div
                    className="h-2.5 rounded-full bg-gradient-to-r from-sky-600 to-sky-400"
                    style={{ width: `${Math.max(6, (qty / bestMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {best.length === 0 && <p className="text-slate-500 text-sm py-4 text-center">No sales yet this month</p>}
          </div>
        </Panel>

        {/* Inventory status */}
        <Panel title="Inventory Status">
          <div className="flex items-end justify-around h-32 pt-2">
            <MiniBar label="In Stock" value={inStock} max={inStock + lowStock + outStock} color="bg-gradient-to-t from-green-700 to-emerald-400" />
            <MiniBar label="Low Stock" value={lowStock} max={inStock + lowStock + outStock} color="bg-gradient-to-t from-amber-700 to-amber-400" />
            <MiniBar label="Out of Stock" value={outStock} max={inStock + lowStock + outStock} color="bg-gradient-to-t from-red-800 to-rose-500" />
          </div>
        </Panel>

        {/* Channel / payment bars */}
        <Panel title="Sales Channels & Payments (this month)">
          <div className="space-y-2">
            {chan.map((c) => (
              <div key={c.label}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-slate-600">{c.label}</span>
                  <span className="font-bold text-slate-900 tabular-nums">{peso(c.v)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-200">
                  <div
                    className="h-2.5 rounded-full bg-gradient-to-r from-orange-700 to-orange-400"
                    style={{ width: `${Math.max(3, (c.v / chanMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Owner: all-branch comparison */}
        {isOwner && (
          <Panel title="Today by Branch (all branches)" right={`Today ${peso(allToday)} · Week ${peso(allWeek)} · Month ${peso(allMonth)}`} className="lg:col-span-2">
            <div className="h-44">
              <ResponsiveContainer>
                <BarChart data={branchCompare} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: TICK }} />
                  <YAxis tick={{ fontSize: 9, fill: TICK }} width={48} />
                  <Tooltip
                    formatter={money}
                    contentStyle={{ background: "#ffffff", border: `1px solid ${GRID}`, borderRadius: 8, color: "#0f172a" }}
                  />
                  <Bar dataKey="total" name="Sales (₱)" fill={ORANGE} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3 mt-3">
        <Quick href="/inventory/pull-down" icon="⬇️" label="Pull Down" />
        <Quick href="/expenses" icon="💸" label="Expenses" />
        <Quick href="/pdc" icon="🧾" label={pdcDue > 0 ? `PDC (${pdcDue} due)` : "PDC Due"} />
        <Quick href="/reports" icon="📈" label="Reports" />
      </div>
    </div>
  );
}

function Kpi({ title, value, sub, icon, grad, href }: { title: string; value: string; sub?: string; icon: string; grad: string; href?: string }) {
  const body = (
    <div className={`rounded-2xl bg-gradient-to-br ${grad} p-3 shadow-lg h-full`}>
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-white/80">
        {title} <span className="text-base">{icon}</span>
      </div>
      <div className="text-lg font-extrabold text-slate-900 tabular-nums mt-1 leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-white/80 font-semibold">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Navy({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-extrabold text-slate-900 tabular-nums text-sm mt-0.5">{value}</div>
    </div>
  );
}

function Panel({ title, right, className = "", children }: { title: string; right?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl bg-white border border-slate-200 shadow-sm p-4 ${className}`}>
      <div className="flex justify-between items-baseline mb-3 gap-2">
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {right && <span className="text-[10px] text-slate-500 text-right">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const h = max > 0 ? Math.max(8, (value / max) * 100) : 8;
  return (
    <div className="flex flex-col items-center gap-1 w-16">
      <span className="text-sm font-extrabold text-slate-900 tabular-nums">{value}</span>
      <div className="flex items-end h-20 w-7">
        <div className={`w-full rounded-t-md ${color}`} style={{ height: `${h}%` }} />
      </div>
      <span className="text-[10px] text-slate-500 text-center leading-tight">{label}</span>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, pct) / 100) * c;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="#e2e8f0" strokeWidth="11" />
      <circle
        cx="48" cy="48" r={r} fill="none"
        stroke="url(#ringGrad)" strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform="rotate(-90 48 48)"
      />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <text x="48" y="53" textAnchor="middle" fill="#0f172a" fontSize="18" fontWeight="800">{pct}%</text>
    </svg>
  );
}

function Quick({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-3 text-center hover:border-orange-500">
      <div className="text-xl">{icon}</div>
      <div className="text-[11px] font-semibold text-slate-600 mt-1">{label}</div>
    </Link>
  );
}
