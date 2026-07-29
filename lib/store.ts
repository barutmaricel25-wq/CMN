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

// Upgrade a database saved by an older build: backfill collections and fields
// added since, so existing devices keep their data instead of crashing.
function normalize(raw: unknown): DB {
  const d = (raw ?? {}) as Partial<DB> & Record<string, unknown>;
  const seed = buildSeed();

  const arr = <T,>(v: unknown, fallback: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : fallback);

  d.branches = arr(d.branches, seed.branches).map((b) => ({
    ...b,
    has_stockroom: b.has_stockroom ?? true,
    address: b.address ?? "",
  }));

  d.users = arr(d.users, seed.users).map((u) => ({
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
