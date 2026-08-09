"use client";
// The door of the building. Everything — the sign-in screen included — sits
// behind this. Once a device is let in it is not asked again, so staff meet it
// once and then never think about it.
import { useEffect, useState } from "react";
import { useDB, tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { isUnlocked, markUnlocked, verifyPassword } from "@/lib/lock";
import { describeDevice, deviceId } from "@/lib/device";

// Say hello at most this often. The point is a believable "last used", not a
// running commentary — every write goes to all six branches.
const SEEN_EVERY = 15 * 60 * 1000;

export default function ShopLock({ children }: { children: React.ReactNode }) {
  const db = useDB();
  const session = useSession();
  const stored = db.settings?.shop_password ?? "";
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const me = mounted ? deviceId() : "";
  const record = me ? db.devices.find((d) => d.id === me) : undefined;
  // Only a record that says so locks the device. A missing one means the shared
  // database has not reached us yet, and guessing "locked" there would shut a
  // branch out over a slow connection.
  const cutOff = Boolean(record?.revoked);

  useEffect(() => setMounted(true), []);
  // Re-checked whenever the stored value changes: a password changed at head
  // office reaches the branches and asks them again.
  useEffect(() => setOpen(isUnlocked(stored)), [stored]);

  // Put this device on the shop's list, and keep "last used" roughly current.
  useEffect(() => {
    if (!mounted || !me || !open || cutOff) return;
    const now = Date.now();
    const seen = record ? new Date(record.last_seen).getTime() : 0;
    const fresh = record && now - seen < SEEN_EVERY && record.branch_id === (session?.branch_id ?? "");
    if (fresh) return;
    tx((d) => {
      const i = d.devices.findIndex((x) => x.id === me);
      const patch = {
        detected: describeDevice(),
        branch_id: session?.branch_id ?? "",
        last_user_id: session?.user_id ?? "",
        last_seen: new Date(now).toISOString(),
      };
      if (i >= 0) d.devices[i] = { ...d.devices[i], ...patch };
      else
        d.devices.push({
          id: me,
          name: "",
          first_seen: new Date(now).toISOString(),
          revoked: false,
          ...patch,
        });
    });
  }, [mounted, me, open, cutOff, record, session?.branch_id, session?.user_id]);

  // Whether a device has been let in is only known on the device, so nothing is
  // drawn until the browser is running it.
  if (!mounted) return null;
  if (!stored || (open && !cutOff)) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      if (await verifyPassword(pw, stored)) {
        markUnlocked(stored);
        // Typing the password is how a device that was cut off comes back: it
        // is the only proof we have that whoever holds it is meant to be here.
        if (cutOff) {
          tx((d) => {
            const i = d.devices.findIndex((x) => x.id === me);
            if (i >= 0) d.devices[i] = { ...d.devices[i], revoked: false, last_seen: new Date().toISOString() };
          });
        }
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
          {cutOff && !err && (
            <p className="text-sm font-semibold text-amber-700">
              This device was removed from the shop&apos;s list. Enter the password to use it again.
            </p>
          )}
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
