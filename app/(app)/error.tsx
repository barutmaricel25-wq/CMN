"use client";
// Friendly recovery screen: never leave the user on a blank "Application error".
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="card p-6 max-w-md mx-auto text-center mt-8">
      <div className="text-4xl mb-2">😿</div>
      <h1 className="font-bold text-lg mb-1">Something went wrong</h1>
      <p className="text-sm text-slate-500 mb-4">
        This screen hit an error. Try again — if it keeps happening, resetting the demo data on this
        device usually fixes it (this only clears data stored on this phone/tablet).
      </p>
      <div className="space-y-2">
        <button className="btn-primary w-full" onClick={() => reset()}>↻ Try again</button>
        <button
          className="btn-secondary w-full"
          onClick={() => {
            if (window.confirm("Reset the demo data on this device? Anything entered here will be cleared.")) {
              localStorage.removeItem("cmn-demo-db-v1");
              window.location.href = "/dashboard";
            }
          }}
        >
          🔄 Reset demo data on this device
        </button>
      </div>
      {error.digest && <p className="text-[10px] text-slate-400 mt-3">Ref: {error.digest}</p>}
    </div>
  );
}
