"use client";
// PIN pad for privileged actions (void, override, adjustment) and cashier ID.
import { useState } from "react";
import { verifyPin } from "@/lib/session";
import { User } from "@/lib/types";

export default function PinModal({
  title,
  subtitle,
  managerOnly = false,
  branch_id,
  onSuccess,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  managerOnly?: boolean;
  branch_id?: string | null;
  onSuccess: (user: User) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  function press(d: string) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError("");
    if (next.length === 4) {
      const user = verifyPin(next, { managerOnly, branch_id });
      if (user) {
        onSuccess(user);
      } else {
        setError(managerOnly ? "Invalid manager PIN" : "Invalid PIN");
        setTimeout(() => setPin(""), 400);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="card w-full max-w-xs p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-center">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 text-center mt-1">{subtitle}</p>}
        <div className="flex justify-center gap-3 my-5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 ${
                pin.length > i ? "bg-orange-700 border-orange-700" : "border-slate-300"
              }`}
            />
          ))}
        </div>
        {error && <p className="text-red-600 text-sm text-center mb-3 font-semibold">{error}</p>}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
            k === "" ? (
              <div key={i} />
            ) : (
              <button
                key={i}
                className="btn-secondary text-xl py-4"
                onClick={() => (k === "⌫" ? setPin(pin.slice(0, -1)) : press(k))}
              >
                {k}
              </button>
            )
          )}
        </div>
        <button className="btn-ghost w-full mt-4" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
