"use client";
// Tells staff at a glance whether this device is on the shared database.
import { useSync } from "@/lib/store";

export default function SyncBadge({ full = false }: { full?: boolean }) {
  const { shared, state, error } = useSync();

  if (!shared) {
    return full ? (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
        <div className="font-bold text-sm text-amber-900">📱 This device only</div>
        <p className="text-xs text-amber-800 mt-0.5">
          Sales, stock and prices are saved on this phone alone — other branches won&apos;t see them. Keep taking
          backups below, or connect the shared database so all six branches work off the same numbers.
        </p>
      </div>
    ) : null;
  }

  const look = {
    connecting: { dot: "bg-slate-400 animate-pulse", label: "Connecting…", tone: "text-slate-600" },
    saving: { dot: "bg-amber-500 animate-pulse", label: "Saving…", tone: "text-amber-700" },
    online: { dot: "bg-emerald-500", label: "All branches in sync", tone: "text-emerald-700" },
    error: { dot: "bg-red-500", label: "Offline — will send when back", tone: "text-red-700" },
    device: { dot: "bg-slate-400", label: "This device only", tone: "text-slate-600" },
  }[state];

  if (!full) {
    return (
      <span className="inline-flex items-center gap-1.5" title={error || look.label}>
        <span className={`w-2 h-2 rounded-full ${look.dot}`} />
        <span className="text-[11px] font-semibold text-orange-100">{look.label}</span>
      </span>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${look.dot}`} />
        <span className={`font-bold text-sm ${look.tone}`}>{look.label}</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">
        {state === "error"
          ? "Your work is safe on this device and will be sent to the other branches as soon as the connection returns."
          : "All six branches share one set of books — a sale or stock change here shows everywhere within seconds."}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1 break-words">{error}</p>}
    </div>
  );
}
