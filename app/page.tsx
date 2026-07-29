"use client";
// Demo sign-in: pick a branch device account, identify yourself, enter PIN.
// Real deployment: Supabase Auth email/password + staff PIN (see README).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDB } from "@/lib/store";
import { setSession, useSession } from "@/lib/session";
import { User } from "@/lib/types";
import PinModal from "@/components/PinModal";

export default function LoginPage() {
  const db = useDB();
  const session = useSession();
  const router = useRouter();
  const [pinFor, setPinFor] = useState<User | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && session) router.replace("/dashboard");
  }, [mounted, session, router]);

  if (!mounted) return null;

  const byBranch = (bid: string | null) => db.users.filter((u) => u.branch_id === bid && u.active);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-b from-orange-50 to-orange-200">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.jpg" alt="CMN Trading Corporation logo" className="w-28 h-28 mx-auto rounded-full shadow-lg mb-3" />
          <h1 className="text-2xl font-extrabold text-orange-900">CMN Trading Corporation</h1>
          <p className="text-orange-800/70 text-sm">Multi-branch management system</p>
        </div>

        <div className="card p-4 mb-4">
          <h2 className="font-bold mb-2">Owner</h2>
          {byBranch(null).map((u) => (
            <button key={u.id} className="btn-secondary w-full justify-between" onClick={() => setPinFor(u)}>
              <span>👑 {u.name}</span>
              <span className="text-xs text-slate-400">Owner</span>
            </button>
          ))}
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto pb-4">
          {db.branches.map((b) => (
            <div key={b.id} className="card p-4">
              <h2 className="font-bold mb-2">{b.name}</h2>
              <div className="grid grid-cols-1 gap-2">
                {byBranch(b.id).map((u) => (
                  <button key={u.id} className="btn-secondary justify-between" onClick={() => setPinFor(u)}>
                    <span>
                      {u.role === "manager" ? "🧑‍💼" : "🧑"} {u.name}
                      <span className="ml-2 text-xs text-slate-400 uppercase">{u.role}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-orange-900/60 text-xs text-center mt-2">
          Tap your name, then enter your own PIN.
        </p>
      </div>

      {pinFor && (
        <PinModal
          title={pinFor.name}
          subtitle="Enter your 4-digit PIN"
          onCancel={() => setPinFor(null)}
          onSuccess={(u) => {
            if (u.id !== pinFor.id) return; // must match selected person
            setSession({ user_id: u.id, branch_id: u.branch_id ?? db.branches[0].id });
            router.replace("/dashboard");
          }}
        />
      )}
    </main>
  );
}
