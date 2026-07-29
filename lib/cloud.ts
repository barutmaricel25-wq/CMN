"use client";
// Shared-database mode. When NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY are set, every branch reads and writes the same
// Supabase tables instead of each device keeping its own copy.
//
// The app still works against one plain DB object in memory. This module only
// has to do three things: load that object, push whatever changed after each
// edit, and re-load when another branch changes something.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { DB, inBranchOrder } from "./types";
import { buildSeed } from "./seed";

// The Supabase settings page offers several addresses. Only the plain project
// URL works here, so trim the REST/auth suffixes and any trailing slash rather
// than failing with "Invalid path specified in request URL".
function projectUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rest|auth|realtime|storage|functions)\/v\d+$/i, "")
    .replace(/\/+$/, "");
}

const URL_ = projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const KEY_ = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

export const cloudEnabled = Boolean(URL_ && KEY_);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) client = createClient(URL_, KEY_, { auth: { persistSession: false } });
  return client;
}

// Every list in the DB is one table of the same name.
export const TABLES = [
  "branches",
  "users",
  "products",
  "customers",
  "inventory",
  "stock_movements",
  "deliveries",
  "delivery_items",
  "transfers",
  "transfer_items",
  "sales",
  "sale_items",
  "online_orders",
  "attendance",
  "expenses",
  "pdc_checks",
  "payroll",
  "audit_log",
] as const;
export type Table = (typeof TABLES)[number];

type Row = { id: string } & Record<string, unknown>;
const rowsOf = (d: DB, t: Table) => (d[t] as unknown as Row[]) ?? [];

// Supabase caps a single response at 1000 rows, and the catalogue is bigger.
// Reading it in pages only works if the rows come back in a settled order —
// without one, Postgres is free to answer each page differently, which skips
// some rows and repeats others. Hence the explicit order by id, the check that
// the pages add up to the row count the server reports, and the de-duplication.
// Every table is keyed by "id" except app_state, which is keyed by "key".
async function selectAll(table: string, keyCol = "id"): Promise<Row[]> {
  const size = 1000;
  const seen = new Map<string, Row>();
  let total: number | null = null;

  for (let from = 0; ; from += size) {
    const { data, error, count } = await sb()
      .from(table)
      .select("*", { count: "exact" })
      .order(keyCol, { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (total === null) total = count ?? null;
    (data ?? []).forEach((r) => seen.set(String((r as Record<string, unknown>)[keyCol]), r as Row));
    if (!data || data.length < size) break;
  }

  const rows = [...seen.values()];
  if (total !== null && rows.length < total) {
    // Better to stay on the copy we already have than to show a short list.
    throw new Error(`${table}: only ${rows.length} of ${total} rows came back — not using an incomplete read`);
  }
  return rows;
}

export async function fetchAll(): Promise<DB> {
  const seed = buildSeed();
  const lists = await Promise.all(TABLES.map((t) => selectAll(t)));
  const state = await selectAll("app_state", "key");
  const stateOf = (key: string) => state.find((r) => (r as { key?: string }).key === key)?.value;

  const d = { ...seed } as unknown as Record<string, unknown>;
  TABLES.forEach((t, i) => {
    d[t] = lists[i];
  });
  d.settings = { ...seed.settings, ...((stateOf("settings") as object) ?? {}) };
  d.receipt_counters = (stateOf("receipt_counters") as Record<string, number>) ?? {};
  d.seeded_at = (stateOf("seeded_at") as string) ?? seed.seeded_at;

  const db = d as unknown as DB;
  // Postgres hands rows back in no particular order; the shop has its own.
  db.branches = inBranchOrder(db.branches);
  // Receipt numbers are handed out on the device. Re-derive each branch's
  // counter from the receipts already banked so two tills can't reuse a number
  // after one of them has been offline.
  db.sales.forEach((s) => {
    const seen = db.receipt_counters[s.branch_id] ?? 0;
    if (s.receipt_no > seen) db.receipt_counters[s.branch_id] = s.receipt_no;
  });
  return db;
}

// Has a first upload ever finished? The marker is written last, so a run that
// stopped part-way leaves it unset and the half-filled tables are not trusted.
export async function cloudReady(): Promise<boolean> {
  const { data, error } = await sb().from("app_state").select("value").eq("key", "upload_complete").maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value === true;
}

async function upsert(table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from(table).upsert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function putState(key: string, value: unknown) {
  const { error } = await sb().from("app_state").upsert({ key, value });
  if (error) throw new Error(`app_state.${key}: ${error.message}`);
}

export async function pushAll(d: DB) {
  await putState("upload_complete", false);
  for (const t of TABLES) await upsert(t, rowsOf(d, t));
  await putState("settings", d.settings);
  await putState("receipt_counters", d.receipt_counters);
  await putState("seeded_at", d.seeded_at);
  await putState("upload_complete", true); // written last, on purpose
}

// Send only what actually changed since the last push.
export async function pushDiff(prev: DB, next: DB) {
  for (const t of TABLES) {
    const before = new Map(rowsOf(prev, t).map((r) => [r.id, JSON.stringify(r)]));
    const after = rowsOf(next, t);
    const changed = after.filter((r) => before.get(r.id) !== JSON.stringify(r));
    if (changed.length) await upsert(t, changed);

    const kept = new Set(after.map((r) => r.id));
    const gone = [...before.keys()].filter((id) => !kept.has(id));
    for (let i = 0; i < gone.length; i += 200) {
      const { error } = await sb().from(t).delete().in("id", gone.slice(i, i + 200));
      if (error) throw new Error(`${t}: ${error.message}`);
    }
  }
  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) await putState("settings", next.settings);
  if (JSON.stringify(prev.receipt_counters) !== JSON.stringify(next.receipt_counters))
    await putState("receipt_counters", next.receipt_counters);
}

// Tell us when any branch changes anything.
export function subscribeRealtime(onChange: () => void): () => void {
  const channel = sb().channel("cmn-all");
  channel.on("postgres_changes", { event: "*", schema: "public" }, onChange).subscribe();
  return () => {
    sb().removeChannel(channel);
  };
}
