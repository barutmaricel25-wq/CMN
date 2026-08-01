"use client";
// The door of the building. Everything — the sign-in screen included — sits
// behind this. Once a device is let in it is not asked again, so staff meet it
// once and then never think about it.
import { useEffect, useState } from "react";
import { useDB } from "@/lib/store";
import { isUnlocked, markUnlocked, verifyPassword } from "@/lib/lock";

export default function ShopLock({ children }: { children: React.ReactNode }) {
  const db = useDB();
  const stored = db.settings?.shop_password ?? "";
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setMounted(true), []);
  // Re-checked whenever the stored value changes: a password changed at head
  // office reaches the branches and asks them again.
  useEffect(() => setOpen(isUnlocked(stored)), [stored]);

  // Whether a device has been let in is only known on the device, so nothing is
  // drawn until the browser is running it.
  if (!mounted) return null;
  if (!stored || open) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      if (await verifyPassword(pw, stored)) {
        markUnlocked(stored);
        setOpen(true);
      } else {
        setErr("That isn't the shop password.");
        setPw("");
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-orange-50 to-orange-200">
      <form className="w-full max-w-sm" onSubmit={submit}>
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="CMN Trading Corporation logo" className="w-24 h-24 mx-auto rounded-full shadow-lg mb-3" />
          <h1 className="text-xl font-extrabold text-orange-900">CMN Trading Corporation</h1>
        </div>
        <div className="card p-5 space-y-3">
          <div>
            <label className="label">Shop password</label>
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </div>
          {err && <p className="text-sm font-semibold text-red-600">{err}</p>}
          <button className="btn-primary w-full" disabled={!pw || busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
          <p className="text-xs text-slate-500">
            Asked once on this phone or computer. Ask the owner for it — it is not written down in the app.
          </p>
        </div>
      </form>
    </main>
  );
}
