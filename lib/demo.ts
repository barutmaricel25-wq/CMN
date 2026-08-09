"use client";
// The app ships with a demo shop inside it — a fortnight of made-up trading, a
// catalogue, ten customers — so nothing looks empty on the first day. Once a
// real shop is using it that data is a liability: it is filed against the staff
// and branch records it shipped with, so renaming those to real people makes
// fake sales read as theirs.
//
// Everything the demo wrote can be told apart by its id. The seed uses fixed
// ids — "p31", "c4", "seed-sale-b3-2-1", "att-b1-1", "exp-b2-rent", "oo1",
// "pdc1" — while anything the shop does gets a random one. So none of this can
// catch real work.
//
// Two things are deliberately never touched:
//   · staff and branches, because those records were renamed into the real
//     people and the real branches and are in use;
//   · stock quantities, because they have been counted since and wiping them
//     would empty the shelves according to the app.
import { DB } from "./types";
import { tx } from "./store";

const seeded = {
  product: (id: string) => /^p\d+$/.test(id),
  customer: (id: string) => /^c\d+$/.test(id),
  sale: (id: string) => id.startsWith("seed-sale-"),
  attendance: (id: string) => /^att-b\d+-\d+$/.test(id),
  expense: (id: string) => /^exp-b\d+-/.test(id),
  order: (id: string) => /^oo\d+$/.test(id),
  cheque: (id: string) => /^pdc\d+$/.test(id),
};

export type SampleGroup = "history" | "products" | "customers";

export const GROUP_LABEL: Record<SampleGroup, string> = {
  history: "Made-up trading",
  products: "Demo products",
  customers: "Demo customers",
};

export interface SampleTally {
  history: number;
  products: number;
  customers: number;
  // A few names, so what is about to go can be recognised rather than counted.
  productNames: string[];
  customerNames: string[];
  total: number;
}

export function isSampleRow(table: "stock_movements" | "sales", id: string): boolean {
  return seeded.sale(id);
}

export function countSampleData(db: DB): SampleTally {
  const history =
    db.sales.filter((r) => seeded.sale(r.id)).length +
    db.sale_items.filter((r) => seeded.sale(r.id)).length +
    db.stock_movements.filter((r) => seeded.sale(r.id)).length +
    db.attendance.filter((r) => seeded.attendance(r.id)).length +
    db.expenses.filter((r) => seeded.expense(r.id)).length +
    db.online_orders.filter((r) => seeded.order(r.id)).length +
    db.pdc_checks.filter((r) => seeded.cheque(r.id)).length;

  const products = db.products.filter((p) => seeded.product(p.id) && p.active);
  const customers = db.customers.filter((c) => seeded.customer(c.id) && c.active);

  return {
    history,
    products: products.length,
    customers: customers.length,
    productNames: products.slice(0, 3).map((p) => `${p.brand} ${p.name}`.trim()),
    customerNames: customers.slice(0, 3).map((c) => c.name),
    total: history + products.length + customers.length,
  };
}

export function clearSampleData(groups: SampleGroup[]): SampleTally {
  const want = new Set(groups);
  let history = 0;
  let products = 0;
  let customers = 0;

  tx((d) => {
    if (want.has("history")) {
      const drop = <T extends { id: string }>(list: T[], is: (id: string) => boolean): T[] => {
        const kept = list.filter((r) => !is(r.id));
        history += list.length - kept.length;
        return kept;
      };
      d.sales = drop(d.sales, seeded.sale);
      d.sale_items = drop(d.sale_items, seeded.sale);
      d.stock_movements = drop(d.stock_movements, seeded.sale);
      d.attendance = drop(d.attendance, seeded.attendance);
      d.expenses = drop(d.expenses, seeded.expense);
      d.online_orders = drop(d.online_orders, seeded.order);
      d.pdc_checks = drop(d.pdc_checks, seeded.cheque);

      const highest: Record<string, number> = {};
      d.sales.forEach((s) => {
        if (s.receipt_no > (highest[s.branch_id] ?? 0)) highest[s.branch_id] = s.receipt_no;
      });
      d.branches.forEach((b) => {
        d.receipt_counters[b.id] = highest[b.id] ?? 0;
      });
    }

    // Anything still referred to by what is left is hidden rather than erased,
    // so a receipt that mentions it still adds up. Same rule as deleting by
    // hand. After the history has gone there is usually nothing left to refer
    // to it, and it goes properly.
    if (want.has("products")) {
      const stillSold = new Set(d.sale_items.map((i) => i.product_id));
      d.products = d.products.filter((p) => {
        if (!seeded.product(p.id) || !p.active) return true;
        products++;
        if (stillSold.has(p.id)) {
          p.active = false;
          return true;
        }
        return false;
      });
      const gone = new Set(d.products.filter((p) => !p.active && seeded.product(p.id)).map((p) => p.id));
      d.inventory = d.inventory.filter((i) => !seeded.product(i.product_id) || gone.has(i.product_id));
    }

    if (want.has("customers")) {
      const known = new Set([
        ...d.sales.map((s) => s.customer_id),
        ...d.online_orders.map((o) => o.customer_id),
        ...d.pdc_checks.map((c) => c.customer_id),
      ]);
      d.customers = d.customers.filter((c) => {
        if (!seeded.customer(c.id) || !c.active) return true;
        customers++;
        if (known.has(c.id)) {
          c.active = false;
          return true;
        }
        return false;
      });
    }
  });

  return { history, products, customers, productNames: [], customerNames: [], total: history + products + customers };
}
