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
  "devices",
] as const;
export type Table = (typeof TABLES)[number];

type Row = { id: string } & Record<string, unknown>;

// updated_at belongs to the server. Keeping it on the local copy would make
// every pulled row look changed on the next push, which would bump it again —
// a loop that never settles.
const stripStamp = (r: Row): Row => {
  const { updated_at: _drop, ...rest } = r as Record<string, unknown>;
  return rest as Row;
};
const rowsOf = (d: DB, t: Table) => (d[t] as unknown as Row[]) ?? [];

// Supabase caps a single response at 1000 rows, and the tables are bigger —
// a branch's stock alone runs to tens of thousands of rows. Reading them in
// pages only works if the rows come back in a settled order: without one,
// Postgres may answer each page differently, skipping some rows and repeating
// others. So: order by the key, ask for the row count once rather than on every
// page (it re-counts the whole table each time), fetch the remaining pages a
// few at a time instead of one after another, and check the total adds up.
const PAGE = 1000;
const AT_ONCE = 4;

// A table added by a later migration does not exist in a database that has not
// had that migration run yet. One missing table must not stop the other
// seventeen from syncing — the shop would simply stop saving, with an error
// naming a table nobody has heard of. So: notice it, skip it, carry on, and let
// the screen that needs it say what to run.
const absent = new Set<string>();
export const tableMissing = (t: string) => absent.has(t);

function isMissingTable(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  const m = (e.message ?? "").toLowerCase();
  // Only a missing *table*. A missing column reads almost the same ("column
  // customers.cp_number does not exist") and skipping the table for that would
  // quietly stop the customers syncing at all — exactly the kind of silence
  // this app must not have.
  return (
    e.code === "42P01" ||
    e.code === "PGRST205" ||
    /relation ".*" does not exist/.test(m) ||
    m.includes("could not find the table")
  );
}

function skipIfMissing(table: string, e: { message?: string; code?: string } | null): boolean {
  if (!isMissingTable(e)) return false;
  if (!absent.has(table)) {
    absent.add(table);
    console.warn(`Table "${table}" is not in the shared database yet — skipping it. Run its migration in the SQL Editor.`);
  }
  return true;
}

async function page(table: string, keyCol: string, from: number, withCount: boolean) {
  const q = sb()
    .from(table)
    .select("*", withCount ? { count: "exact" } : undefined)
    .order(keyCol, { ascending: true })
    .range(from, from + PAGE - 1);
  const { data, error, count } = await q;
  if (error) {
    if (skipIfMissing(table, error)) return { rows: [] as Row[], count: 0 };
    throw new Error(`${table}: ${error.message}`);
  }
  return { rows: (data ?? []) as Row[], count: count ?? null };
}

// Every table is keyed by "id" except app_state, which is keyed by "key".
async function selectAll(table: string, keyCol = "id"): Promise<Row[]> {
  const seen = new Map<string, Row>();
  const keep = (rows: Row[]) =>
    rows.forEach((r) => seen.set(String((r as Record<string, unknown>)[keyCol]), r));

  const first = await page(table, keyCol, 0, true);
  keep(first.rows);
  const total = first.count;

  if (total !== null && total > PAGE) {
    const starts: number[] = [];
    for (let from = PAGE; from < total; from += PAGE) starts.push(from);
    for (let i = 0; i < starts.length; i += AT_ONCE) {
      const batch = await Promise.all(
        starts.slice(i, i + AT_ONCE).map((from) => page(table, keyCol, from, false))
      );
      batch.forEach((b) => keep(b.rows));
    }
  } else if (total === null && first.rows.length === PAGE) {
    // No count came back; fall back to walking the pages.
    for (let from = PAGE; ; from += PAGE) {
      const next = await page(table, keyCol, from, false);
      keep(next.rows);
      if (next.rows.length < PAGE) break;
    }
  }

  const rows = [...seen.values()];
  if (total !== null && rows.length < total) {
    // Better to stay on the copy we already have than to show a short list.
    throw new Error(`${table}: only ${rows.length} of ${total} rows came back — not using an incomplete read`);
  }
  return rows;
}

export async function fetchAll(): Promise<{ db: DB; watermark: string }> {
  const seed = buildSeed();
  const lists = await Promise.all(TABLES.map((t) => selectAll(t)));
  const state = await selectAll("app_state", "key");
  const stateOf = (key: string) => state.find((r) => (r as { key?: string }).key === key)?.value;

  const watermark = markFrom([...lists, state], new Date(0).toISOString());

  const d = { ...seed } as unknown as Record<string, unknown>;
  TABLES.forEach((t, i) => {
    d[t] = lists[i].map(stripStamp);
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
  return { db, watermark };
}

// What changed since a device last looked. Far cheaper than fetchAll: a quiet
// minute returns nothing at all instead of tens of thousands of rows.
export interface Changes {
  rows: Partial<Record<Table, Row[]>>;
  state: Row[];
  deletions: { table_name: string; row_id: string }[];
  watermark: string;
}

// The high-water mark is taken from the rows themselves, so no clock has to be
// agreed between the phone and the server. Backing off a couple of seconds
// means a row committed slightly out of order is picked up next time rather
// than missed; re-reading a handful of rows costs nothing.
const OVERLAP_MS = 2000;

function markFrom(rows: Row[][], since: string): string {
  let max = since;
  rows.forEach((list) =>
    list.forEach((r) => {
      const u = String((r as Record<string, unknown>).updated_at ?? "");
      if (u > max) max = u;
    })
  );
  if (max === since) return since;
  return new Date(new Date(max).getTime() - OVERLAP_MS).toISOString();
}

async function changedSince(table: string, since: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb()
      .from(table)
      .select("*")
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (skipIfMissing(table, error)) return out;
      throw new Error(`${table}: ${error.message}`);
    }
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

export async function fetchChanges(since: string): Promise<Changes> {
  const lists = await Promise.all(TABLES.map((t) => changedSince(t, since)));
  const state = await changedSince("app_state", since);
  const { data: dels, error } = await sb()
    .from("deletions")
    .select("table_name,row_id,deleted_at")
    .gt("deleted_at", since);
  if (error && !skipIfMissing("deletions", error)) throw new Error(`deletions: ${error.message}`);
  const deletions = (dels ?? []) as (Changes["deletions"][number] & { deleted_at?: string })[];

  const watermark = markFrom(
    [...lists, state, deletions.map((x) => ({ id: x.row_id, updated_at: x.deleted_at })) as Row[]],
    since
  );

  const rows: Partial<Record<Table, Row[]>> = {};
  TABLES.forEach((t, i) => {
    if (lists[i].length) rows[t] = lists[i].map(stripStamp);
  });
  return { rows, state: state.map(stripStamp), deletions, watermark };
}

// Has a first upload ever finished? The marker is written last, so a run that
// stopped part-way leaves it unset and the half-filled tables are not trusted.
export async function cloudReady(): Promise<boolean> {
  const { data, error } = await sb().from("app_state").select("value").eq("key", "upload_complete").maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value === true;
}

async function upsert(table: string, rows: Row[]) {
  if (absent.has(table)) return;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from(table).upsert(rows.slice(i, i + 500));
    if (error) {
      if (skipIfMissing(table, error)) return;
      throw new Error(`${table}: ${error.message}`);
    }
  }
}

async function putState(key: string, value: unknown) {
  const { error } = await sb().from("app_state").upsert({ key, value });
  if (error) throw new Error(`app_state.${key}: ${error.message}`);
}

// The moment the upload finished, according to the server. Taking the phone's
// clock instead would re-read everything just written.
export async function markAfterUpload(): Promise<string> {
  const { data, error } = await sb()
    .from("app_state")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`sync mark: ${error.message}`);
  const stamp = (data?.[0] as { updated_at?: string } | undefined)?.updated_at;
  return stamp ?? new Date().toISOString();
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
      const batch = gone.slice(i, i + 200);
      const { error } = await sb().from(t).delete().in("id", batch);
      if (error && !skipIfMissing(t, error)) throw new Error(`${t}: ${error.message}`);
      // A row that is simply gone can't be noticed by asking for recent
      // changes, so leave a note for the other devices.
      const { error: delErr } = await sb()
        .from("deletions")
        .upsert(batch.map((id) => ({ table_name: t, row_id: id })));
      if (delErr && !skipIfMissing("deletions", delErr)) throw new Error(`deletions: ${delErr.message}`);
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
