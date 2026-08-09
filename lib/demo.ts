"use client";
// The app ships with a fortnight of made-up trading so the dashboards have
// something in them before a shop starts using it. Once real work begins that
// history is a liability: it is attributed to whichever staff record happens to
// sit at that id, so renaming the demo staff to real people makes fake sales
// read as theirs.
//
// Every sample row can be told apart by its id. The seed writes fixed ids —
// "seed-sale-b3-2-1", "att-b1-1", "exp-b2-rent", "oo1", "pdc1" — while anything
// the shop does gets a random uuid. So this can never catch real work.
import { DB } from "./types";
import { tx } from "./store";

const SAMPLE = {
  sales: (id: string) => id.startsWith("seed-sale-"),
  sale_items: (id: string) => id.startsWith("seed-sale-"),
  stock_movements: (id: string) => id.startsWith("seed-sale-"),
  attendance: (id: string) => /^att-b\d+-\d+$/.test(id),
  expenses: (id: string) => /^exp-b\d+-/.test(id),
  online_orders: (id: string) => /^oo\d+$/.test(id),
  pdc_checks: (id: string) => /^pdc\d+$/.test(id),
} as const;

export type SampleTable = keyof typeof SAMPLE;
export const SAMPLE_LABEL: Record<SampleTable, string> = {
  sales: "sales",
  sale_items: "sale lines",
  stock_movements: "stock movements",
  attendance: "attendance records",
  expenses: "expenses",
  online_orders: "online orders",
  pdc_checks: "cheques",
};

export function isSampleRow(table: SampleTable, id: string): boolean {
  return SAMPLE[table](id);
}

export function countSampleData(db: DB): Record<SampleTable, number> {
  const out = {} as Record<SampleTable, number>;
  (Object.keys(SAMPLE) as SampleTable[]).forEach((t) => {
    out[t] = (db[t] as { id: string }[]).filter((r) => SAMPLE[t](r.id)).length;
  });
  return out;
}

// Stock levels are left exactly as they are. They started as demo numbers too,
// but by now they have been counted and corrected, and wiping them would leave
// the shop with nothing on the shelves according to the app.
export function clearSampleData(): Record<SampleTable, number> {
  const removed = {} as Record<SampleTable, number>;
  tx((d) => {
    (Object.keys(SAMPLE) as SampleTable[]).forEach((t) => {
      const before = (d[t] as { id: string }[]).length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d as any)[t] = (d[t] as { id: string }[]).filter((r) => !SAMPLE[t](r.id));
      removed[t] = before - (d[t] as { id: string }[]).length;
    });
    // Receipt numbers came from the sample sales too, so the first real receipt
    // would otherwise be #000091. Re-derive each branch's counter from the
    // receipts that are actually left, which never reuses a number that has
    // been printed.
    const highest: Record<string, number> = {};
    d.sales.forEach((s2) => {
      if (s2.receipt_no > (highest[s2.branch_id] ?? 0)) highest[s2.branch_id] = s2.receipt_no;
    });
    d.branches.forEach((b) => {
      d.receipt_counters[b.id] = highest[b.id] ?? 0;
    });
  });
  return removed;
}
