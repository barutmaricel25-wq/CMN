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
//
// This has to run on rows from the shared database too, not only on the copy
// saved here: a customer written before branches were added comes back from
// Supabase without one, and every screen that groups by branch then loses it.
//
// An empty list is an answer, not a gap. A shop that has deleted every demo
// product has an empty catalogue, and refilling it from the seed puts the demo
// shop back — which then syncs to every branch and reads as the system
// resetting itself. The demo is only ever for a device with nothing saved at
// all, and load() handles that case on its own.
//
// Branches and staff are the exception: with those empty nobody could sign in,
// so an empty one there means the saved copy is broken, not deliberate.
function normalize(raw: unknown): DB {
  const d = (raw ?? {}) as Partial<DB> & Record<string, unknown>;
  const seed = buildSeed();

  const arr = <T,>(v: unknown, fallback: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
  const orSeed = <T,>(list: T[], seedList: T[]): T[] => (list.length ? list : seedList);

  const savedBranches = orSeed(arr(d.branches, seed.branches), seed.branches);
  // Devices saved before branches had a listing order get it back by name.
  const orderByName = new Map(seed.branches.map((b) => [b.name.toLowerCase(), b.sort_order]));
  d.branches = inBranchOrder(
    savedBranches.map((b) => ({
      ...b,
      has_stockroom: b.has_stockroom ?? true,
      address: b.address ?? "",
      sort_order: b.sort_order ?? orderByName.get((b.name ?? "").toLowerCase()) ?? 999,
    }))
  );

  const savedUsers = orSeed(arr(d.users, seed.users), seed.users);
  d.users = savedUsers.map((u) => ({
    ...u,
    // The role now called cashier was briefly called assistant manager.
    role: (u.role as string) === "assistant_manager" ? "cashier" : u.role,
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

  // Never refilled from the seed: an empty catalogue is a real state.
  const products = arr<DB["products"][number]>(d.products);
  // The whole ACCESSORIES sheet originally imported as "collars/leash/harness".
  // Move the brushes, feeders, balls and mats to their real categories on
  // devices that already installed the app — only for rows still sitting in
  // that bucket, so a category anyone edited by hand is left alone.
  const seedCategory = new Map(seed.products.map((p) => [p.sku, p.category]));
  d.products = products.map((p) => {
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
  d.customers = arr<DB["customers"][number]>(d.customers).map((c) => ({
    ...c,
    // Text boxes need a string to hold on to. A field left undefined makes its
    // input stop tracking what the record actually says, which is how a value
    // ends up on the list but not in the form that edits it.
    name: c.name ?? "",
    phone: c.phone ?? "",
    address: c.address ?? "",
    notes: c.notes ?? "",
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
  d.inventory = arr<DB["inventory"][number]>(d.inventory);
  d.stock_movements = arr<DB["stock_movements"][number]>(d.stock_movements);
  d.delivery_items = arr<DB["delivery_items"][number]>(d.delivery_items);
  d.transfers = arr<DB["transfers"][number]>(d.transfers);
  d.transfer_items = arr<DB["transfer_items"][number]>(d.transfer_items);
  d.sales = arr<DB["sales"][number]>(d.sales);
  d.sale_items = arr<DB["sale_items"][number]>(d.sale_items).map((i) => ({
    ...i,
    by_kilo: i.by_kilo ?? false,
    stock_qty: i.stock_qty ?? null,
  }));
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
  d.devices = arr<DB["devices"][number]>(d.devices);
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
// Does the shared database already hold a finished copy? Until the answer is
// known, this device must not send its own — a device that has just installed
// the app is holding demo data, and pushing that would overwrite the shop.
let serverHasData: boolean | null = null;
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
  // A device that has synced before keeps its unsent work; the refresh can wait.
  // A device that never has is holding the demo shop the app ships with, and
  // taking the shared copy is the only safe thing to do with it.
  if (unsent && lastPushed) return;
  const startedAt = localEdits;
  const { db: raw, watermark } = await withTimeout(fetchAll(), 90000, "Loading");
  if (!raw.branches.length || !raw.users.length) {
    throw new Error("The shared database has no branches or staff yet — keeping this device's copy.");
  }
  // Rows written before a field existed come back without it; fill them in
  // here, exactly as for a copy saved by an older build.
  const fresh = normalize(raw);
  if (localEdits !== startedAt) return; // edited while we were fetching
  db = fresh;
  lastPushed = clone(fresh);
  unsent = false;
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

  // Grouped, not one at a time: clearing the demo shop leaves fourteen thousand
  // deletions, and searching the whole inventory for each of them in turn is
  // long enough to lock up a phone.
  const removals = new Map<Table, Set<string>>();
  c.deletions.forEach((del) => {
    const t = del.table_name as Table;
    if (!TABLES.includes(t)) return;
    if (!removals.has(t)) removals.set(t, new Set());
    removals.get(t)!.add(del.row_id);
  });
  removals.forEach((ids, t) => {
    const list = d[t] as unknown as { id: string }[];
    const kept = list.filter((r) => !ids.has(r.id));
    touched += list.length - kept.length;
    (d[t] as unknown as { id: string }[]) = kept;
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
    // Changed rows arrive raw from the server, so upgrade the shape again.
    db = freshLists(normalize({ ...d }));
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

// Roughly how much has to go up: rows that changed, plus rows that vanished.
function pushBudget(prev: DB, next: DB): number {
  let rows = 0;
  TABLES.forEach((t) => {
    const before = prev[t] as unknown as { id: string }[];
    const after = next[t] as unknown as { id: string }[];
    rows += Math.abs(before.length - after.length) + Math.min(before.length, after.length) / 20;
  });
  // 20 seconds to get going, then a second for every fifty rows, up to five
  // minutes for a really big clear-out.
  return Math.min(300000, 20000 + Math.round(rows / 50) * 1000);
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
      // Twenty seconds is right for a price change and nowhere near enough for
      // clearing the demo data, which removes thousands of rows a couple of
      // hundred at a time. Time it against the size of the job, or the save
      // fails at the same point on every retry and never gets through.
      await withTimeout(pushDiff(lastPushed!, target), pushBudget(lastPushed!, target), "Saving");
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
    serverHasData = await withTimeout(cloudReady(), 12000, "Connecting");
    if (serverHasData) {
      // Only the very first time does this device read everything; after that
      // it just asks what changed.
      await catchUp();
      // Anything typed while this device was still connecting can go up now
      // that there is a copy of the server to compare against.
      if (unsent && lastPushed) await flush();
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

// A copy whose lists are new arrays, not the same ones with different contents.
// Screens memoise their work against db.expenses, db.inventory and the rest, so
// a list that was edited in place looks unchanged to them and they keep showing
// what was there before — an expense recorded but not listed until a reload.
// Copying the arrays is only the references, cheap even for the big tables.
function freshLists(d: DB): DB {
  const out = { ...d } as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (Array.isArray(v)) out[k] = [...v];
  }
  return out as unknown as DB;
}

// All mutations go through tx(): mutate a draft, then persist + notify.
export function tx(fn: (d: DB) => void) {
  const d = load();
  fn(d);
  localEdits++;
  db = freshLists(d); // new references so every screen re-reads its lists
  persist();
  notify();
  if (cloudEnabled) {
    unsent = true;
    if (lastPushed) void flush();
    // Nothing to diff against yet. Send the whole copy only when the shared
    // database is known to be empty — that is the "first device uploads its
    // data" case. Otherwise wait for the first pull: sending now would put this
    // device's demo catalogue over the top of a shop already using the app.
    else if (serverHasData === false) void fullUpload();
  }
  // Cross-tab sync on one device (and the order board demo).
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new Event("cmn-db-changed")); } catch { /* noop */ }
  }
}

// Throw away what this device has and take the shared copy whole. For a device
// that has drifted — it missed something and its bookmark has already moved
// past it, so asking "what changed since" will never mention it again.
export async function rebuildFromCloud(): Promise<string> {
  if (!cloudEnabled) return "This device isn't connected to a shared database.";
  if (unsent) {
    await flush();
    if (unsent) return `⚠ This device has changes that haven't been sent yet: ${syncError}`;
  }
  try {
    setSync("saving");
    writeMark("");        // forget where we had got to
    lastPushed = null;    // and force a full read rather than a diff
    await pull();
    setSync("online");
    const d = db ?? load();
    return `✅ Rebuilt from the shared database — ${d.products.filter((p) => p.active).length} products, ${d.customers.filter((c) => c.active).length} customers.`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSync("error", msg);
    return `⚠ Could not rebuild: ${msg}`;
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
