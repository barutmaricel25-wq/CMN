"use client";
// App shell: top bar (branch switcher for owner) + bottom tab nav (mobile-first)
// with an overflow "More" sheet for secondary screens.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useDB } from "@/lib/store";
import { setSession, useSession } from "@/lib/session";

const PRIMARY_TABS = [
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/pos", label: "POS", icon: "🛒" },
  { href: "/orders", label: "Orders", icon: "📦" },
  { href: "/inventory", label: "Stock", icon: "🏬" },
];

const MORE_LINKS = [
  { href: "/inventory/pull-down", label: "Pull Down (2F → Store)", icon: "⬇️" },
  { href: "/inventory/deliveries", label: "Receive Delivery", icon: "🚚" },
  { href: "/inventory/movements", label: "Movements Ledger", icon: "📒" },
  { href: "/inventory/count", label: "Stock Count", icon: "🔢" },
  { href: "/transfers", label: "Branch Transfers", icon: "🔁" },
  { href: "/reorder", label: "Reorder Suggestions", icon: "🧾" },
  { href: "/products", label: "Products & Prices", icon: "🏷️" },
  { href: "/customers", label: "Customers", icon: "👥" },
  { href: "/reports", label: "Reports & End-of-Day", icon: "📈" },
  { href: "/attendance", label: "Time & Attendance", icon: "⏰" },
  { href: "/admin", label: "Admin & Settings", icon: "⚙️" },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const db = useDB();
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !session) router.replace("/");
  }, [mounted, session, router]);
  useEffect(() => setMore(false), [pathname]);

  if (!mounted || !session) return null;

  const user = db.users.find((u) => u.id === session.user_id);
  const branch = db.branches.find((b) => b.id === session.branch_id);
  if (!user) return null;

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-emerald-800 text-white shadow">
        <div className="flex items-center justify-between px-4 py-2.5 max-w-5xl mx-auto">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">🐾</span>
            <div className="min-w-0">
              <div className="font-bold leading-tight text-sm">CMN Pet Supply</div>
              {user.role === "owner" ? (
                <select
                  className="bg-emerald-900 text-emerald-100 text-xs rounded px-1 py-0.5 max-w-[160px]"
                  value={session.branch_id ?? ""}
                  onChange={(e) => setSession({ ...session, branch_id: e.target.value })}
                >
                  {db.branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              ) : (
                <div className="text-emerald-200 text-xs truncate">{branch?.name}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-right">
            <div>
              <div className="text-xs font-semibold">{user.name}</div>
              <div className="text-[10px] uppercase text-emerald-300">{user.role}</div>
            </div>
            <button
              className="text-xs bg-emerald-900 rounded-lg px-2 py-1.5"
              onClick={() => { setSession(null); router.replace("/"); }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4">{children}</main>

      {more && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setMore(false)}>
          <div
            className="absolute bottom-16 left-0 right-0 bg-white rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-2 gap-2 max-w-5xl mx-auto">
              {MORE_LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="btn-secondary justify-start text-left">
                  <span>{l.icon}</span> <span className="text-sm">{l.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200">
        <div className="grid grid-cols-5 max-w-5xl mx-auto">
          {PRIMARY_TABS.map((t) => {
            const active = pathname === t.href || (t.href !== "/dashboard" && pathname.startsWith(t.href));
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center py-2 text-xs font-semibold ${
                  active ? "text-emerald-700" : "text-slate-500"
                }`}
              >
                <span className="text-xl">{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
          <button
            className={`flex flex-col items-center py-2 text-xs font-semibold ${more ? "text-emerald-700" : "text-slate-500"}`}
            onClick={() => setMore(!more)}
          >
            <span className="text-xl">☰</span>
            More
          </button>
        </div>
      </nav>
    </div>
  );
}
