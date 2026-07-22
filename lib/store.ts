"use client";
// Demo-mode data layer: a localStorage-persisted DB with pub/sub reactivity.
// Every screen reads via useDB() and writes via tx(). This module is the single
// swap point for a future Supabase adapter (same action signatures, async).
import { useSyncExternalStore } from "react";
import { DB } from "./types";
import { buildSeed } from "./seed";

const KEY = "cmn-demo-db-v1";
let db: DB | null = null;
const listeners = new Set<() => void>();

function load(): DB {
  if (db) return db;
  if (typeof window === "undefined") {
    // SSR render pass: give a throwaway seed (client re-renders with real data).
    return buildSeed();
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      db = JSON.parse(raw) as DB;
      return db;
    }
  } catch {
    // corrupted storage — reseed
  }
  db = buildSeed();
  persist();
  return db;
}

function persist() {
  if (!db || typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("localStorage full — trimming old movements/audit rows", e);
    // Emergency trim: keep the most recent 2000 movements & 500 audit rows.
    db.stock_movements = db.stock_movements.slice(-2000);
    db.audit_log = db.audit_log.slice(-500);
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* give up */ }
  }
}

export function getDB(): DB {
  return load();
}

// All mutations go through tx(): mutate a draft, then persist + notify.
export function tx(fn: (d: DB) => void) {
  const d = load();
  fn(d);
  db = { ...d }; // new reference so useSyncExternalStore re-renders
  persist();
  listeners.forEach((l) => l());
  // Cross-tab sync (simulates Supabase Realtime for the order board demo).
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new Event("cmn-db-changed")); } catch { /* noop */ }
  }
}

export function resetDemo() {
  db = buildSeed();
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      db = null;
      load();
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot: DB = buildSeed();

export function useDB(): DB {
  return useSyncExternalStore(subscribe, load, () => serverSnapshot);
}
