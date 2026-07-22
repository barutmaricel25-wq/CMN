"use client";
// Time & attendance: forced live selfie + GPS, geofence check (flag, never
// reject), manager review with thumbnails, timesheet CSV export.
import { useState } from "react";
import { useDB, tx } from "@/lib/store";
import { useSession } from "@/lib/session";
import { clockPunch, audit } from "@/lib/actions";
import { haversineMeters, fmtTime, fmtDateTime, manilaDateKey, downloadCSV } from "@/lib/util";
import CameraCapture from "@/components/CameraCapture";
import PinModal from "@/components/PinModal";

export default function AttendancePage() {
  const db = useDB();
  const session = useSession();
  const [camera, setCamera] = useState<null | "in" | "out">(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewPin, setReviewPin] = useState<string | null>(null);
  const [tsFrom, setTsFrom] = useState(manilaDateKey(new Date(Date.now() - 13 * 86400000).toISOString()));
  const [tsTo, setTsTo] = useState(manilaDateKey());

  if (!session) return null;
  const branchId = session.branch_id!;
  const user = db.users.find((u) => u.id === session.user_id)!;
  const branch = db.branches.find((b) => b.id === branchId)!;
  const isManager = user.role !== "staff";

  const myToday = db.attendance
    .filter((a) => a.user_id === user.id && manilaDateKey(a.created_at) === manilaDateKey())
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastPunch = myToday[myToday.length - 1];
  const nextType: "in" | "out" = lastPunch?.type === "in" ? "out" : "in";

  function punch(selfie: string) {
    setBusy(true);
    setStatus("Getting GPS location…");
    const finish = (lat: number | null, lng: number | null) => {
      let within = false;
      if (lat != null && lng != null) {
        within = haversineMeters(lat, lng, branch.geofence_lat, branch.geofence_lng) <= branch.geofence_radius_m;
      }
      clockPunch({
        user_id: user.id, branch_id: branchId, type: camera!,
        selfie_url: selfie, lat, lng, within_geofence: within,
        device_info: navigator.userAgent.slice(0, 120),
      });
      setStatus(within ? `✅ Clocked ${camera} — inside branch geofence.` : `⚠ Clocked ${camera} — outside geofence, flagged for manager review (recorded anyway).`);
      setCamera(null);
      setBusy(false);
    };
    if (!navigator.geolocation) { finish(null, null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => finish(pos.coords.latitude, pos.coords.longitude),
      () => finish(null, null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // Manager: today's punches at this branch
  const todayPunches = db.attendance
    .filter((a) => a.branch_id === branchId && manilaDateKey(a.created_at) === manilaDateKey())
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Timesheet: pair in/out per user per day
  function timesheet() {
    const rows: (string | number)[][] = [["Employee", "Date", "Clock in", "Clock out", "Hours"]];
    const staff = db.users.filter((u) => u.branch_id === branchId);
    staff.forEach((u) => {
      const punches = db.attendance
        .filter((a) => a.user_id === u.id)
        .filter((a) => { const k = manilaDateKey(a.created_at); return k >= tsFrom && k <= tsTo; })
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const byDay = new Map<string, typeof punches>();
      punches.forEach((p) => {
        const k = manilaDateKey(p.created_at);
        byDay.set(k, [...(byDay.get(k) ?? []), p]);
      });
      byDay.forEach((list, day) => {
        const tin = list.find((p) => p.type === "in");
        const tout = [...list].reverse().find((p) => p.type === "out");
        const hours = tin && tout ? ((new Date(tout.created_at).getTime() - new Date(tin.created_at).getTime()) / 3600000).toFixed(2) : "";
        rows.push([u.name, day, tin ? fmtTime(tin.created_at) : "—", tout ? fmtTime(tout.created_at) : "—", hours]);
      });
    });
    downloadCSV(`timesheet-${tsFrom}-to-${tsTo}.csv`, rows);
  }

  return (
    <div className="space-y-3">
      <h1 className="font-bold text-lg">⏰ Time & Attendance</h1>

      <div className="card p-4 text-center">
        <p className="text-sm text-slate-600 mb-1">{user.name} — {branch.name}</p>
        <p className="text-xs text-slate-400 mb-3">
          {lastPunch ? `Last: clock ${lastPunch.type} at ${fmtTime(lastPunch.created_at)}` : "No punch yet today"}
        </p>
        <button className={`btn ${nextType === "in" ? "bg-emerald-700 text-white" : "bg-amber-600 text-white"} w-full text-lg !py-4`} disabled={busy} onClick={() => setCamera(nextType)}>
          📷 Clock {nextType.toUpperCase()} — take live selfie
        </button>
        <p className="text-xs text-slate-400 mt-2">Live camera only (no gallery). GPS is checked against the branch geofence ({branch.geofence_radius_m}m).</p>
        {status && <p className="text-sm font-semibold mt-2">{status}</p>}
      </div>

      {isManager && (
        <>
          <div className="card p-4">
            <h2 className="font-bold mb-2">Today at {branch.name}</h2>
            <div className="divide-y divide-slate-100">
              {todayPunches.map((a) => {
                const u = db.users.find((x) => x.id === a.user_id);
                return (
                  <div key={a.id} className="py-2 flex items-center gap-3">
                    {a.selfie_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={a.selfie_url} alt="selfie" className="w-12 h-12 rounded-xl object-cover border border-slate-200" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">?</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{u?.name} — {a.type.toUpperCase()}</div>
                      <div className="text-xs text-slate-500">{fmtDateTime(a.created_at)}</div>
                    </div>
                    {a.flagged && !a.reviewed_by && (
                      <button className="badge bg-red-100 text-red-700" onClick={() => setReviewPin(a.id)}>⚠ review</button>
                    )}
                    {a.flagged && a.reviewed_by && <span className="badge bg-slate-200 text-slate-600">reviewed</span>}
                    {!a.flagged && <span className="badge bg-emerald-100 text-emerald-700">✓ ok</span>}
                  </div>
                );
              })}
              {todayPunches.length === 0 && <p className="text-center text-sm text-slate-400 py-6">No punches today</p>}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-bold mb-2">Timesheet export (payroll)</h2>
            <div className="flex gap-2 items-end">
              <div className="flex-1"><label className="label">From</label><input className="input" type="date" value={tsFrom} onChange={(e) => setTsFrom(e.target.value)} /></div>
              <div className="flex-1"><label className="label">To</label><input className="input" type="date" value={tsTo} onChange={(e) => setTsTo(e.target.value)} /></div>
              <button className="btn-primary" onClick={timesheet}>⬇️ CSV</button>
            </div>
          </div>
        </>
      )}

      {camera && (
        <CameraCapture
          title={`Clock ${camera.toUpperCase()} selfie`}
          facing="user"
          onCancel={() => setCamera(null)}
          onCapture={punch}
        />
      )}

      {reviewPin && (
        <PinModal
          title="Manager PIN — mark reviewed" managerOnly branch_id={branchId}
          onCancel={() => setReviewPin(null)}
          onSuccess={(mgr) => {
            tx((d) => {
              const a = d.attendance.find((x) => x.id === reviewPin);
              if (a) { a.reviewed_by = mgr.id; audit(d, mgr.id, "attendance_review", "attendance", a.id, { flagged: true }, { reviewed_by: mgr.id }); }
            });
            setReviewPin(null);
          }}
        />
      )}
    </div>
  );
}
