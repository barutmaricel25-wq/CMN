"use client";
// The data layer. Every screen reads via useDB() and writes via tx().
//
// Two modes, decided by whether Supabase is configured:
//   · shared  — all six branches read and write one Supabase database, with
//               live updates; localStorage is kept as an offline cache
//   · device  — each device keeps its own copy in localStorage (demo mode)
// Screens and actions are identical either way.
import { useSyncExternalStore } from "react";
import { DB } from "./types";
import { buildSeed } from "./seed";
import { cloudEnabled, cloudReady, fetchAll, pushAll, pushDiff, subscribeRealtime } from "./cloud";

const KEY = "cmn-demo-db-v1";
let db: DB | null = null;
const listeners = new Set<() => void>();

const clone = (d: DB): DB => JSON.parse(JSON.stringify(d)) as DB;
const notify = () => listeners.forEach((l) => l());

// Upgrade a database saved by an older build: backfill collections and fields
// added since, so existing devices keep their data instead of crashing.
function normalize(raw: unknown): DB {
  const d = (raw ?? {}) as Partial<DB> & Record<string, unknown>;
  const seed = buildSeed();

  const arr = <T,>(v: unknown, fallback: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : fallback);

  // An empty branches/users list means the saved copy is unusable — nobody
  // could even sign in — so fall back to the seed rather than showing a blank
  // screen forever.
  const savedBranches = arr(d.branches, seed.branches);
  d.branches = (savedBranches.length ? savedBranches : seed.branches).map((b) => ({
    ...b,
    has_stockroom: b.has_stockroom ?? true,
    address: b.address ?? "",
  }));

  const savedUsers = arr(d.users, seed.users);
  d.users = (savedUsers.length ? savedUsers : seed.users).map((u) => ({
    ...u,
    contact_number: u.contact_number ?? "",
    address: u.address ?? "",
    sss_id: u.sss_id ?? "",
    philhealth_id: u.philhealth_id ?? "",
    pagibig_id: u.pagibig_id ?? "",
    birthday: u.birthday ?? "",
    hired_date: u.hired_date ?? "",
    salary_rate: u.salary_rate ?? 0,
    daily_rate: u.daily_rate ?? 75500,
    hourly_rate: u.hourly_rate ?? Math.round(75500 / 8),
  }));

  // Products gained ORD W/S and per-kilo columns; reseed if the catalog is empty.
  const products = arr(d.products, seed.products);
  // The whole ACCESSORIES sheet originally imported as "collars/leash/harness".
  // Move the brushes, feeders, balls and mats to their real categories on
  // devices that already installed the app — only for rows still sitting in
  // that bucket, so a category anyone edited by hand is left alone.
  const seedCategory = new Map(seed.products.map((p) => [p.sku, p.category]));
  d.products = (products.length ? products : seed.products).map((p) => {
    const correct = seedCategory.get(p.sku);
    const category =
      p.category === "collars/leash/harness" && correct && correct !== p.category
        ? correct
        : p.category;
    return { ...p, category, ord_ws_price: p.ord_ws_price ?? null, per_kilo: p.per_kilo ?? null };
  });

  d.customers = arr(d.customers, seed.customers).map((c) => ({
    ...c,
    payment_terms: c.payment_terms ?? "cash",
  }));

  d.deliveries = arr<DB["deliveries"][number]>(d.deliveries).map((del) => ({
    ...del,
    supplier_contact: del.supplier_contact ?? "",
    supplier_address: del.supplier_address ?? "",
    terms: del.terms ?? "cod",
    due_date: del.due_date ?? null,
    // Older rows stored an ISO timestamp; the UI now expects YYYY-MM-DD.
    delivery_date: (del.delivery_date ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
  }));

  // Collections introduced later.
  d.inventory = arr(d.inventory, seed.inventory);
  d.stock_movements = arr<DB["stock_movements"][number]>(d.stock_movements);
  d.delivery_items = arr<DB["delivery_items"][number]>(d.delivery_items);
  d.transfers = arr<DB["transfers"][number]>(d.transfers);
  d.transfer_items = arr<DB["transfer_items"][number]>(d.transfer_items);
  d.sales = arr<DB["sales"][number]>(d.sales);
  d.sale_items = arr<DB["sale_items"][number]>(d.sale_items);
  d.online_orders = arr<DB["online_orders"][number]>(d.online_orders);
  d.attendance = arr<DB["attendance"][number]>(d.attendance);
  d.expenses = arr<DB["expenses"][number]>(d.expenses);
  d.pdc_checks = arr<DB["pdc_checks"][number]>(d.pdc_checks);
  d.payroll = arr<DB["payroll"][number]>(d.payroll).map((r) => ({
    ...r,
    sss_contribution: r.sss_contribution ?? 0,
    philhealth_contribution: r.philhealth_contribution ?? 0,
    pagibig_contribution: r.pagibig_contribution ?? 0,
    sss_loan: r.sss_loan ?? 0,
  }));
  d.audit_log = arr<DB["audit_log"][number]>(d.audit_log);
  d.receipt_counters = (d.receipt_counters ?? {}) as Record<string, number>;

  d.settings = { ...seed.settings, ...(d.settings ?? {}) };
  d.seeded_at = d.seeded_at ?? seed.seeded_at;

  return d as DB;
}

function load(): DB {
  if (db) return db;
  if (typeof window === "undefined") {
    // SSR render pass: give a throwaway seed (client re-renders with real data).
    return buildSeed();
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      db = normalize(JSON.parse(raw));
      persist(); // save the upgraded shape
      return db;
    }
  } catch (e) {
    console.warn("Saved data unreadable — starting from a fresh seed.", e);
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

// ---------- Shared-database sync ----------
export type SyncState = "device" | "connecting" | "online" | "saving" | "error";
let syncState: SyncState = cloudEnabled ? "connecting" : "device";
let syncError = "";
let lastPushed: DB | null = null; // what the server is known to hold
let pushing = false;
let pushAgain = false;
let started = false;

export interface SyncInfo { shared: boolean; state: SyncState; error: string }
let statusSnap: SyncInfo = { shared: cloudEnabled, state: syncState, error: syncError };

function setSync(state: SyncState, error = "") {
  syncState = state;
  syncError = error;
  statusSnap = { shared: cloudEnabled, state, error };
  notify();
}

const offlineSnap: SyncInfo = { shared: false, state: "device", error: "" };

// Live connection status for the header/admin indicator.
export function useSync(): SyncInfo {
  return useSyncExternalStore(
    subscribe,
    () => statusSnap,
    () => offlineSnap
  );
}

// A request that never answers must not leave the badge stuck on "Connecting…";
// staff need to know their branch is working offline.
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out — no answer from the shared database`)), ms)),
  ]);
}

// Pull the shared database in, replacing whatever this device had cached.
async function pull() {
  const fresh = await withTimeout(fetchAll(), 20000, "Loading");
  if (!fresh.branches.length || !fresh.users.length) {
    throw new Error("The shared database has no branches or staff yet — keeping this device's copy.");
  }
  db = fresh;
  lastPushed = clone(fresh);
  persist();
  notify();
}

async function flush() {
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    setSync("saving");
    for (;;) {
      pushAgain = false;
      const target = db!;
      await withTimeout(pushDiff(lastPushed!, target), 20000, "Saving");
      lastPushed = clone(target);
      if (!pushAgain) break;
    }
    setSync("online");
  } catch (e) {
    // Keep the edit on the device and try again — the shop cannot stop selling
    // because the internet dropped.
    setSync("error", e instanceof Error ? e.message : String(e));
    setTimeout(flush, 5000);
  } finally {
    pushing = false;
  }
}

// Keep the device's own copy from just before it first joined the shared
// database. If the join goes wrong, whatever was typed in on this device —
// staff names, PINs, prices — can still be recovered.
const PRE_SYNC_KEY = "cmn-pre-sync-backup";

export function preSyncBackup(): DB | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PRE_SYNC_KEY);
    return raw ? (JSON.parse(raw) as DB) : null;
  } catch {
    return null;
  }
}

// Put that copy back, then send it up so the other branches get it too.
export async function restorePreSync(): Promise<boolean> {
  const saved = preSyncBackup();
  if (!saved) return false;
  db = normalize(saved);
  persist();
  notify();
  if (!cloudEnabled) return true;
  try {
    setSync("saving");
    await withTimeout(pushAll(db), 180000, "Upload");
    lastPushed = clone(db);
    setSync("online");
  } catch (e) {
    setSync("error", e instanceof Error ? e.message : String(e));
  }
  return true;
}

async function startCloud() {
  if (started || !cloudEnabled || typeof window === "undefined") return;
  started = true;
  try {
    // Take the safety copy before anything from the server can replace it.
    // load() first, so a device that has not written its copy out yet still
    // gets one saved.
    load();
    if (!localStorage.getItem(PRE_SYNC_KEY)) {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(PRE_SYNC_KEY, raw);
    }
    if (await withTimeout(cloudReady(), 12000, "Connecting")) {
      await pull();
    } else {
      // Either nothing is up there yet, or a previous upload stopped halfway.
      // Send this device's copy and only mark it complete once it all lands,
      // so a half-filled database is never mistaken for the real thing.
      const local = load();
      await withTimeout(pushAll(local), 180000, "First upload");
      lastPushed = clone(local);
    }
    setSync("online");
    subscribeRealtime(() => {
      // Ignore echoes of our own writes; our copy is already ahead.
      if (pushing || pushAgain) return;
      pull().catch(() => undefined);
    });
  } catch (e) {
    setSync("error", e instanceof Error ? e.message : String(e));
    setTimeout(() => {
      started = false;
      startCloud();
    }, 8000);
  }
}

// All mutations go through tx(): mutate a draft, then persist + notify.
export function tx(fn: (d: DB) => void) {
  const d = load();
  fn(d);
  db = { ...d }; // new reference so useSyncExternalStore re-renders
  persist();
  notify();
  if (cloudEnabled && lastPushed) void flush();
  // Cross-tab sync on one device (and the order board demo).
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new Event("cmn-db-changed")); } catch { /* noop */ }
  }
}

// Admin → start over. On a shared database this only refreshes this device;
// wiping six branches' books is not something a button should do.
export function resetDemo() {
  if (cloudEnabled) {
    pull().catch((e) => setSync("error", e instanceof Error ? e.message : String(e)));
    return;
  }
  db = buildSeed();
  persist();
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  void startCloud();
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
