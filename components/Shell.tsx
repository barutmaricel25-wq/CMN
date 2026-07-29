"use client";
// App shell: header with global search, left sidebar (permanent on desktop,
// slide-in drawer on mobile) + bottom tab bar for thumb use on phones.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDB } from "@/lib/store";
import SyncBadge from "@/components/SyncBadge";
import { setSession, useSession } from "@/lib/session";
import { brandName } from "@/lib/util";
import { Role } from "@/lib/types";

// `roles` limits who sees the link; omit to show it to everyone.
type NavItem = { href: string; label: string; icon: string; roles?: Role[] };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "🏠" },
  { href: "/pos", label: "POS (Cashier)", icon: "🛒" },
  { href: "/orders", label: "Online Orders", icon: "📦" },
  { href: "/inventory", label: "Stock", icon: "🏬" },
  { href: "/inventory/pull-down", label: "Pull Down / Get Stock", icon: "⬇️" },
  // Receiving deliveries: owner + branch managers (never staff).
  { href: "/inventory/deliveries", label: "Receive Delivery", icon: "🚚", roles: ["owner", "manager"] },
  { href: "/inventory/movements", label: "Movements Ledger", icon: "📒" },
  { href: "/inventory/count", label: "Stock Count", icon: "🔢" },
  { href: "/transfers", label: "Branch Transfers", icon: "🔁" },
  { href: "/reorder", label: "Reorder Suggestions", icon: "🧾" },
  { href: "/products", label: "Products & Prices", icon: "🏷️" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/expenses", label: "Expenses", icon: "💸" },
  { href: "/pdc", label: "PDC Due Dates", icon: "🧾" },
  { href: "/payroll", label: "Payroll", icon: "🧑‍💼" },
  { href: "/reports", label: "Reports & End-of-Day", icon: "📈" },
  { href: "/attendance", label: "Time & Attendance", icon: "⏰" },
  { href: "/admin", label: "Admin & Settings", icon: "⚙️", roles: ["owner", "manager"] },
];

const TABS = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/products", label: "Prices", icon: "🏷️" },
  { href: "/pos", label: "POS", icon: "🛒" },
  { href: "/inventory", label: "Stock", icon: "🏬" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const db = useDB();
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !session) router.replace("/");
  }, [mounted, session, router]);
  useEffect(() => setDrawer(false), [pathname]);

  if (!mounted || !session) return null;

  const user = db.users.find((u) => u.id === session.user_id);
  const branch = db.branches.find((b) => b.id === session.branch_id);
  if (!user) return null;

  const visibleNav = NAV.filter((l) => !l.roles || l.roles.includes(user.role));

  // Owners and managers can look at any branch; staff stay on their own.
  const canSwitchBranch = user.role !== "staff";
  const awayFromHome = user.role === "manager" && user.branch_id !== session.branch_id;

  const branchPicker = (className: string) => (
    <select
      className={className}
      value={session.branch_id ?? ""}
      onChange={(e) => setSession({ ...session, branch_id: e.target.value })}
      aria-label="Branch"
    >
      {db.branches.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </select>
  );

  const navLinks = (compact: boolean) => (
    <nav className={compact ? "p-2" : "p-3"}>
      {visibleNav.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold mb-0.5 ${
              active ? "bg-orange-100 text-orange-800" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span>{l.icon}</span> {l.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen pb-20 lg:pb-4">
      <header className="sticky top-0 z-40 bg-orange-800 text-white shadow print:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button className="lg:hidden text-2xl leading-none" onClick={() => setDrawer(true)} aria-label="Open menu">
            ☰
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="CMN logo" className="w-8 h-8 rounded-full border border-orange-300 shrink-0" />
          <div className="min-w-0 hidden sm:block">
            <div className="font-bold leading-tight text-sm whitespace-nowrap">CMN Trading Corp.</div>
            {canSwitchBranch ? (
              branchPicker("bg-orange-900 text-orange-100 text-xs rounded px-1 py-0.5 max-w-[150px]")
            ) : (
              <div className="text-orange-200 text-xs truncate">{branch?.name}</div>
            )}
          </div>

          <GlobalSearch role={user.role} />

          <div className="flex items-center gap-2 text-right shrink-0">
            {/* Sync status: on the phone it sits in the branch line below. */}
            <span className="hidden sm:inline-flex">
              <SyncBadge />
            </span>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold">{user.name}</div>
              <div className="text-[10px] uppercase text-orange-300">{user.role}</div>
            </div>
            <button
              className="text-xs bg-orange-900 rounded-lg px-2 py-1.5"
              onClick={() => { setSession(null); router.replace("/"); }}
            >
              Logout
            </button>
          </div>
        </div>
        {/* Mobile: branch line under header (name hidden above on small screens) */}
        <div className="sm:hidden px-4 pb-1.5 -mt-1 text-[11px] text-orange-200 flex justify-between items-center gap-2">
          {canSwitchBranch ? (
            branchPicker("bg-orange-900 text-orange-100 text-[11px] rounded px-1.5 py-1 max-w-[45%]")
          ) : (
            <span className="truncate">{branch?.name}</span>
          )}
          <SyncBadge />
          <span className="truncate">{user.name}</span>
        </div>
      </header>

      {/* A manager looking at another branch: anything they ring up or move
          would be recorded against that branch, so say so plainly. */}
      {awayFromHome && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs px-4 py-2 flex items-center justify-between gap-2 print:hidden">
          <span>
            👀 Viewing <b>{branch?.name}</b> — not your branch. Sales and stock changes here are recorded against it.
          </span>
          <button
            className="font-bold underline whitespace-nowrap"
            onClick={() => setSession({ ...session, branch_id: user.branch_id })}
          >
            Back to mine
          </button>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed left-0 top-[52px] bottom-0 w-60 bg-white border-r border-slate-200 overflow-y-auto print:hidden">
        {navLinks(false)}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpg" alt="" className="w-8 h-8 rounded-full" />
              <div>
                <div className="font-bold text-sm">CMN Trading Corp.</div>
                <div className="text-xs text-slate-500">{branch?.name}</div>
              </div>
            </div>
            {navLinks(true)}
          </div>
        </div>
      )}

      <main className="p-4 max-w-5xl mx-auto lg:ml-60 lg:max-w-none xl:max-w-6xl">{children}</main>

      {/* Mobile bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 lg:hidden print:hidden">
        <div className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = pathname === t.href || (t.href !== "/dashboard" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center py-2 text-xs font-semibold ${
                  active ? "text-orange-700" : "text-slate-500"
                }`}
              >
                <span className="text-xl">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
          <button
            className="flex flex-col items-center py-2 text-xs font-semibold text-slate-500"
            onClick={() => setDrawer(true)}
          >
            <span className="text-xl">☰</span>
            Menu
          </button>
        </div>
      </nav>
    </div>
  );
}

// Global search: products (name/brand/barcode/SKU), customers, and screens.
function GlobalSearch({ role }: { role?: Role }) {
  const db = useDB();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(""); setOpen(false); }, [pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const term = q.trim().toLowerCase();
  const screens = term.length >= 2 ? NAV.filter((l) => (!l.roles || (role && l.roles.includes(role))) && l.label.toLowerCase().includes(term)).slice(0, 3) : [];
  const products = term.length >= 2
    ? db.products.filter((p) =>
        p.active &&
        (p.name.toLowerCase().includes(term) || p.brand.toLowerCase().includes(term) || p.barcode.includes(term) || p.sku.toLowerCase().includes(term))
      ).slice(0, 6)
    : [];
  const customers = term.length >= 2
    ? db.customers.filter((c) => c.active && (c.name.toLowerCase().includes(term) || c.phone.includes(term))).slice(0, 4)
    : [];

  function go(href: string) {
    setQ("");
    setOpen(false);
    router.push(href);
  }

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0">
      <input
        className="w-full rounded-xl bg-orange-900/70 placeholder-orange-200/70 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-300"
        placeholder="🔍 Search products, customers…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && term.length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 card max-h-[60vh] overflow-y-auto text-slate-900 z-50">
          {screens.length > 0 && (
            <div className="px-3 pt-2 pb-1">
              <div className="label">Screens</div>
              {screens.map((s) => (
                <button key={s.href} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100 text-sm font-semibold" onClick={() => go(s.href)}>
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          )}
          {products.length > 0 && (
            <div className="px-3 pt-2 pb-1 border-t border-slate-100 first:border-t-0">
              <div className="label">Products</div>
              {products.map((p) => (
                <button key={p.id} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100" onClick={() => go(`/products?q=${encodeURIComponent(p.barcode)}`)}>
                  <div className="text-sm font-semibold truncate">{brandName(p)} <span className="text-slate-400 font-normal">{p.size_variant}</span></div>
                  <div className="text-xs text-slate-500">{p.sku} · {p.barcode}</div>
                </button>
              ))}
            </div>
          )}
          {customers.length > 0 && (
            <div className="px-3 pt-2 pb-2 border-t border-slate-100 first:border-t-0">
              <div className="label">Customers</div>
              {customers.map((c) => (
                <button key={c.id} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100" onClick={() => go(`/customers?q=${encodeURIComponent(c.name)}`)}>
                  <div className="text-sm font-semibold">{c.name} <span className="badge bg-slate-200 text-slate-600 ml-1">{c.type}</span></div>
                  <div className="text-xs text-slate-500">{c.phone}</div>
                </button>
              ))}
            </div>
          )}
          {screens.length === 0 && products.length === 0 && customers.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-4">No matches for “{q}”</p>
          )}
        </div>
      )}
    </div>
  );
}
