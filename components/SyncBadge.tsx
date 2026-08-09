"use client";
// Tells staff at a glance whether this device is on the shared database.
import { useState } from "react";
import { rebuildFromCloud, refreshFromCloud, uploadToCloud, useSync } from "@/lib/store";

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

  // "Offline" for every failure sends people to check their signal when the
  // signal is fine and the database refused something. Only call it offline
  // when it looks like the connection.
  const netDown = typeof navigator !== "undefined" && navigator.onLine === false;
  const looksLikeConnection =
    netDown || /failed to fetch|networkerror|load failed|timed out|no answer/i.test(error);

  const look = {
    connecting: { dot: "bg-slate-400 animate-pulse", label: "Connecting…", tone: "text-slate-600" },
    saving: { dot: "bg-amber-500 animate-pulse", label: "Saving…", tone: "text-amber-700" },
    online: { dot: "bg-emerald-500", label: "All branches in sync", tone: "text-emerald-700" },
    error: {
      dot: "bg-red-500",
      label: looksLikeConnection ? "Offline — will send when back" : "Not syncing — needs a look",
      tone: "text-red-700",
    },
    device: { dot: "bg-slate-400", label: "This device only", tone: "text-slate-600" },
  }[state];

  // A refusal naming a table nobody has heard of is a migration that has not
  // been run. Say which file, rather than leaving the message to be puzzled over.
  const missing = /could not find the table '(?:public\.)?([a-z_]+)'|relation "(?:public\.)?([a-z_]+)" does not exist/i.exec(
    error
  );
  const missingTable = missing ? missing[1] || missing[2] : "";

  // A missing column is the same story — a migration that has not been run —
  // but it is never skipped: skipping would drop what the shop just typed.
  const col = /could not find the '([a-z_]+)' column of '([a-z_]+)'|column ([a-z_]+)\.([a-z_]+) does not exist/i.exec(error);
  const missingColumn = col ? { column: col[1] || col[4], table: col[2] || col[3] } : null;

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
          ? looksLikeConnection
            ? "Your work is safe on this device and will be sent to the other branches as soon as the connection returns."
            : "Your work is safe on this device, but it is not reaching the other branches. The reason is below."
          : "All six branches share one set of books — a sale or stock change here shows everywhere within seconds."}
      </p>
      {error && <p className="text-[11px] text-red-600 mt-1 break-words">{error}</p>}
      {missingColumn && (
        <p className="text-xs font-semibold text-amber-800 mt-1">
          The shared database has no <code>{missingColumn.column}</code> column on <code>{missingColumn.table}</code>.
          A database change hasn&apos;t been run yet: in Supabase → SQL Editor → New query, run the files in
          <b> supabase/migrations/</b> you haven&apos;t run (they are safe to run twice), then press ⬇️ Get latest.
          Nothing is lost meanwhile — this device keeps everything and sends it once the column exists.
        </p>
      )}
      {missingTable && (
        <p className="text-xs font-semibold text-amber-800 mt-1">
          The shared database has no <code>{missingTable}</code> table. In Supabase → SQL Editor → New query, paste the
          migration for it from <b>supabase/migrations/</b> and press Run, then press ⬇️ Get latest here.
        </p>
      )}
      <SyncButtons />
    </div>
  );
}

// The app syncs on its own; these are for when you want to make it happen now
// and see the result rather than wonder.
function SyncButtons() {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [asking, setAsking] = useState(false);

  const run = async (what: "down" | "up" | "rebuild") => {
    setBusy(what);
    setMsg("");
    setAsking(false);
    setMsg(
      await (what === "down" ? refreshFromCloud() : what === "up" ? uploadToCloud() : rebuildFromCloud())
    );
    setBusy("");
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button className="btn-secondary !py-2 text-xs" disabled={!!busy} onClick={() => run("down")}>
          {busy === "down" ? "Getting…" : "⬇️ Get latest"}
        </button>
        <button className="btn-secondary !py-2 text-xs" disabled={!!busy} onClick={() => run("up")}>
          {busy === "up" ? "Sending…" : "⬆️ Send mine up"}
        </button>
      </div>
      <p className="text-[10px] text-slate-400 mt-1">
        Get latest = take what the other branches have. Send mine up = push what is on this device to everyone.
      </p>
      {asking ? (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 mt-2">
          <p className="text-xs font-semibold text-amber-900">
            Replace everything on this device with the shared copy?
          </p>
          <p className="text-[11px] text-amber-800 mt-0.5">
            For a branch still showing something the others have deleted. It reads the whole database again instead of
            asking what changed. Anything this device hasn&apos;t sent yet goes up first, so nothing is lost.
          </p>
          <div className="flex gap-2 mt-2">
            <button className="btn-ghost flex-1 !py-2 text-xs" onClick={() => setAsking(false)}>Cancel</button>
            <button className="btn-primary flex-1 !py-2 text-xs" onClick={() => run("rebuild")}>Rebuild</button>
          </div>
        </div>
      ) : (
        <button className="btn-ghost w-full !py-2 text-xs mt-1" disabled={!!busy} onClick={() => setAsking(true)}>
          {busy === "rebuild" ? "Rebuilding…" : "🔄 Rebuild from the shared database"}
        </button>
      )}
      {msg && <p className="text-xs font-semibold mt-1 break-words">{msg}</p>}
    </>
  );
}
