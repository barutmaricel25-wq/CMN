"use client";
// The data layer. Every screen reads via useDB() and writes via tx().
//
// Two modes, decided by whether Supabase is configured:
//   · shared  — all six branches read and write one Supabase database, with
//               live updates; localStorage is kept as an offline cache
//   · device  — each device keeps its own copy in localStorage (demo mode)
// Screens and actions are identical either way.
import { useSyncExternalStore } from "react";
import { DB, inBranchOrder } from "./types";
import { buildSeed } from "./seed";
import { Changes, cloudEnabled, cloudReady, fetchAll, fetchChanges, markAfterUpload, pushAll, pushDiff, subscribeRealtime, TABLES, Table } from "./cloud";

const KEY = "cmn-demo-db-v1";
// How far this device has caught up with the shared database. Everything after
// this is asked for by "what changed since"; without it we fall back to a full
// load.
const MARK_KEY = "cmn-sync-mark-v1";
const readMark = () => (typeof window === "undefined" ? "" : localStorage.getItem(MARK_KEY) ?? "");
const writeMark = (m: string) => {
  if (typeof window !== "undefined") localStorage.setItem(MARK_KEY, m);
};
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
  // Devices saved before branches had a listing order get it back by name.
  const orderByName = new Map(seed.branches.map((b) => [b.name.toLowerCase(), b.sort_order]));
  d.branches = inBranchOrder(
    (savedBranches.length ? savedBranches : seed.branches).map((b) => ({
      ...b,
      has_stockroom: b.has_stockroom ?? true,
      address: b.address ?? "",
      sort_order: b.sort_order ?? orderByName.get((b.name ?? "").toLowerCase()) ?? 999,
    }))
  );

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

  // Customers used to be shared across the whole business. The ones already on
  // file are Unit 17's.
  const unit17 = d.branches.find((b) => b.name.toLowerCase() === "unit 17")?.id ?? d.branches[0]?.id ?? "";
  d.customers = arr(d.customers, seed.customers).map((c) => ({
    ...c,
    payment_terms: c.payment_terms ?? "cash",
    cp_number: c.cp_number ?? "",
    pdc_terms: c.pdc_terms ?? "none",
    branch_id: c.branch_id || unit17,
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
let unsent = false;               // edits made here that the server hasn't got
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

// Counts local edits, so a refresh that was already in flight when someone
// typed cannot land on top of what they just did.
let localEdits = 0;

// Pull the shared database in, replacing whatever this device had cached.
async function pull() {
  if (unsent) return; // this device has edits the server hasn't got yet
  const startedAt = localEdits;
  const { db: fresh, watermark } = await withTimeout(fetchAll(), 90000, "Loading");
  if (!fresh.branches.length || !fresh.users.length) {
    throw new Error("The shared database has no branches or staff yet — keeping this device's copy.");
  }
  if (localEdits !== startedAt) return; // edited while we were fetching
  db = fresh;
  lastPushed = clone(fresh);
  writeMark(watermark);
  persist();
  notify();
}

// Fold "what changed" into the copy we already hold. This is the cheap path —
// a quiet minute brings back nothing at all.
function applyChanges(d: DB, c: Changes): number {
  let touched = 0;
  TABLES.forEach((t) => {
    const incoming = c.rows[t];
    if (!incoming?.length) return;
    const list = d[t] as unknown as { id: string }[];
    const at = new Map(list.map((r, i) => [r.id, i]));
    incoming.forEach((row) => {
      const i = at.get(row.id);
      if (i === undefined) list.push(row as never);
      else list[i] = row as never;
      touched++;
    });
  });

  c.deletions.forEach((del) => {
    const t = del.table_name as Table;
    if (!TABLES.includes(t)) return;
    const list = d[t] as unknown as { id: string }[];
    const i = list.findIndex((r) => r.id === del.row_id);
    if (i >= 0) {
      list.splice(i, 1);
      touched++;
    }
  });

  c.state.forEach((row) => {
    const key = String((row as Record<string, unknown>).key ?? "");
    const value = (row as Record<string, unknown>).value;
    if (key === "settings") d.settings = { ...d.settings, ...(value as object) };
    if (key === "receipt_counters") d.receipt_counters = value as Record<string, number>;
    touched++;
  });

  d.branches = inBranchOrder(d.branches);
  return touched;
}

// Ask only for what changed. Falls back to a full load the first time, or if
// this device has drifted too far to catch up.
async function catchUp() {
  if (unsent) return;
  const since = readMark();
  if (!since) return pull();
  const startedAt = localEdits;
  const changes = await withTimeout(fetchChanges(since), 45000, "Checking for changes");
  if (localEdits !== startedAt) return; // edited while we were fetching
  const d = load();
  const touched = applyChanges(d, changes);
  writeMark(changes.watermark);
  if (touched) {
    db = { ...d };
    lastPushed = clone(db);
    persist();
    notify();
  }
}

// Send this device's whole copy up, retrying until it lands. Used when the
// shared database has no finished upload yet, and after putting back the
// pre-sync copy — both leave the server without a complete set until this wins.
let uploadRetry: ReturnType<typeof setTimeout> | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;

async function fullUpload() {
  if (uploadRetry) {
    clearTimeout(uploadRetry);
    uploadRetry = null;
  }
  try {
    setSync("saving");
    // Snapshot before sending. tx() shallow-copies the database, so the lists
    // inside are shared: an edit made while this is in flight would otherwise
    // end up recorded as already sent, and never be sent at all.
    const target = clone(db ?? load());
    await withTimeout(pushAll(target), 180000, "Upload");
    lastPushed = target;
    unsent = false;
    // Everything up there came from here, so start counting changes from the
    // moment the upload landed — by the server's clock, not the phone's.
    writeMark(await markAfterUpload());
    setSync("online");
  } catch (e) {
    setSync("error", e instanceof Error ? e.message : String(e));
    uploadRetry = setTimeout(fullUpload, 8000);
  }
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
      // Snapshot first — see the note in fullUpload. Recording the live object
      // after the send would mark edits made meanwhile as already sent.
      const target = clone(db!);
      await withTimeout(pushDiff(lastPushed!, target), 20000, "Saving");
      lastPushed = target;
      if (!pushAgain) break;
    }
    unsent = false;
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

async function startCloud() {
  if (started || !cloudEnabled || typeof window === "undefined") return;
  started = true;
  try {
    // An earlier build kept a second copy of everything here. It is no longer
    // offered, and on a catalogue this size it is worth the space back.
    localStorage.removeItem("cmn-pre-sync-backup");
    if (await withTimeout(cloudReady(), 12000, "Connecting")) {
      // Only the very first time does this device read everything; after that
      // it just asks what changed.
      await catchUp();
      setSync("online");
    } else {
      // Either nothing is up there yet, or a previous upload stopped halfway.
      // Send this device's copy and only mark it complete once it all lands,
      // so a half-filled database is never mistaken for the real thing.
      // fullUpload reports its own state — never claim "in sync" while it is
      // still retrying in the background.
      await fullUpload();
    }
    subscribeRealtime(() => {
      // Ignore echoes of our own writes; our copy is already ahead.
      if (pushing || pushAgain || unsent) return;
      // Coalesce a burst of changes into one catch-up.
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        liveTimer = null;
        catchUp().catch(() => undefined);
      }, 400);
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
  localEdits++;
  db = { ...d }; // new reference so useSyncExternalStore re-renders
  persist();
  notify();
  if (cloudEnabled) {
    unsent = true;
    // With no known server state there is nothing to diff against, so send the
    // whole copy. Skipping here used to strand the edit on the device, where
    // the next refresh quietly replaced it.
    if (lastPushed) void flush();
    else void fullUpload();
  }
  // Cross-tab sync on one device (and the order board demo).
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new Event("cmn-db-changed")); } catch { /* noop */ }
  }
}

// Force a sync by hand. The app does this on its own, but after a wobbly
// connection it helps to be able to press something and watch what happens.
export async function refreshFromCloud(): Promise<string> {
  if (!cloudEnabled) return "This device isn't connected to a shared database.";
  // Get this device's own work up first, or refreshing would discard it.
  if (unsent) {
    await fullUpload();
    if (unsent) return `⚠ This device has changes that haven't been sent yet: ${syncError}`;
  }
  try {
    setSync("saving");
    await catchUp();
    setSync("online");
    const d = db ?? load();
    return `✅ Up to date — ${d.products.filter((p) => p.active).length} products, ${d.users.length} staff.`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSync("error", msg);
    return `⚠ Could not refresh: ${msg}`;
  }
}

export async function uploadToCloud(): Promise<string> {
  if (!cloudEnabled) return "This device isn't connected to a shared database.";
  await fullUpload();
  if (syncState === "online") {
    const d = db ?? load();
    return `✅ Sent up — ${d.products.filter((p) => p.active).length} products, ${d.users.length} staff. Every branch has this now.`;
  }
  return `⚠ Could not send: ${syncError}`;
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
