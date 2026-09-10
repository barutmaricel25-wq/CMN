"use client";
// Domain actions. RULE: every quantity change writes a stock_movements row —
// inventory qty is always adjusted through applyMovement(), no exceptions.
import { tx, getDB } from "./store";
import { uid } from "./util";
import {
  DB, Location, MovementType, Product, Sale, SaleItem, CustomerType, PaymentMethod, OnlineOrder, OrderStatus, OnlineOrderItem, Expense, PDCCheck, PDCStatus, PayrollRecord, Delivery, DeliveryTerms, TERMS_DAYS, termsDays,
} from "./types";

// Where incoming stock lands for a branch: stockroom normally, but straight
// to the store floor for branches without a 2F stockroom.
function receivingLoc(d: DB, branch_id: string): Location {
  const b = d.branches.find((x) => x.id === branch_id);
  return b && b.has_stockroom === false ? "storefront" : "stockroom";
}

function invRow(d: DB, product_id: string, branch_id: string, location: Location) {
  let row = d.inventory.find(
    (i) => i.product_id === product_id && i.branch_id === branch_id && i.location === location
  );
  if (!row) {
    row = { id: uid(), product_id, branch_id, location, qty: 0 };
    d.inventory.push(row);
  }
  return row;
}

export function applyMovement(
  d: DB,
  m: {
    product_id: string;
    branch_id: string;
    from_location: Location | null;
    to_location: Location | null;
    qty: number;
    type: MovementType;
    reference_id?: string | null;
    performed_by: string;
    approved_by?: string | null;
    note?: string | null;
  }
) {
  if (m.qty <= 0) return;
  if (m.from_location) invRow(d, m.product_id, m.branch_id, m.from_location).qty -= m.qty;
  if (m.to_location) invRow(d, m.product_id, m.branch_id, m.to_location).qty += m.qty;
  d.stock_movements.push({
    id: uid(),
    product_id: m.product_id,
    branch_id: m.branch_id,
    from_location: m.from_location,
    to_location: m.to_location,
    qty: m.qty,
    type: m.type,
    reference_id: m.reference_id ?? null,
    performed_by: m.performed_by,
    approved_by: m.approved_by ?? null,
    note: m.note ?? null,
    created_at: new Date().toISOString(),
  });
}

export function audit(d: DB, user_id: string, action: string, entity: string, entity_id: string, before?: unknown, after?: unknown) {
  d.audit_log.push({
    id: uid(), user_id, action, entity, entity_id,
    before: before === undefined ? null : JSON.stringify(before),
    after: after === undefined ? null : JSON.stringify(after),
    created_at: new Date().toISOString(),
  });
}

// ---------- Products ----------
export function saveProduct(p: Product, user_id: string) {
  tx((d) => {
    const idx = d.products.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      audit(d, user_id, "update", "product", p.id, d.products[idx], p);
      d.products[idx] = p;
    } else {
      d.products.push(p);
      audit(d, user_id, "create", "product", p.id, undefined, p);
    }
  });
}

// Save a whole brand at once: the price list is kept brand-first ("AOZI CAT"),
// with each type under it ("Adult Small", "Adult Big") stored as its own
// product so it can carry its own prices and stock.
export function saveBrand(products: Product[], removedIds: string[], user_id: string) {
  products.forEach((p) => saveProduct(p, user_id));
  if (removedIds.length) deleteProducts(removedIds, user_id);
}

// Remove products. Anything already counted, moved or sold is hidden instead of
// erased, so past receipts and the movements ledger still add up.
export function deleteProducts(ids: string[], user_id: string): { deleted: number; hidden: number } {
  let deleted = 0;
  let hidden = 0;
  tx((d) => {
    ids.forEach((id) => {
      const p = d.products.find((x) => x.id === id);
      if (!p) return;
      // Anything that still names this product keeps it — hidden, not erased.
      // A delivery or a transfer that mentions a product nobody can look up is
      // a screen that cannot draw itself.
      const used =
        d.sale_items.some((x) => x.product_id === id) ||
        d.stock_movements.some((x) => x.product_id === id) ||
        d.delivery_items.some((x) => x.product_id === id) ||
        d.transfer_items.some((x) => x.product_id === id) ||
        d.online_orders.some((o) => o.items.some((it) => it.product_id === id)) ||
        d.inventory.some((x) => x.product_id === id && x.qty !== 0);
      if (used) {
        audit(d, user_id, "update", "product", id, p, { ...p, active: false });
        p.active = false;
        hidden++;
      } else {
        audit(d, user_id, "delete", "product", id, p, undefined);
        d.products = d.products.filter((x) => x.id !== id);
        d.inventory = d.inventory.filter((x) => x.product_id !== id);
        deleted++;
      }
    });
  });
  return { deleted, hidden };
}

// Remove a customer. One who has bought something, ordered, or left a cheque
// is hidden rather than erased, so past receipts and cheque records still make
// sense. Returns what actually happened so the screen can say so.
export function deleteCustomer(id: string, user_id: string): { deleted: boolean } {
  let deleted = false;
  tx((d) => {
    const c = d.customers.find((x) => x.id === id);
    if (!c) return;
    const used =
      d.sales.some((s) => s.customer_id === id) ||
      d.online_orders.some((o) => o.customer_id === id) ||
      d.pdc_checks.some((p) => p.customer_id === id);
    if (used) {
      audit(d, user_id, "update", "customer", id, c, { ...c, active: false });
      c.active = false;
    } else {
      audit(d, user_id, "delete", "customer", id, c, undefined);
      d.customers = d.customers.filter((x) => x.id !== id);
      deleted = true;
    }
  });
  return { deleted };
}

// ---------- Pull-down (the #1 fix) ----------
export function pullDown(product_id: string, branch_id: string, qty: number, performed_by: string) {
  tx((d) => {
    applyMovement(d, {
      product_id, branch_id, from_location: "stockroom", to_location: "storefront",
      qty, type: "pull_down", performed_by,
    });
  });
}

// Quick pull: staff fetches stock from ANOTHER branch in person and puts it
// on this branch's store floor. Recorded as an instant received transfer so
// both branches' ledgers show exactly where the stock moved.
export function quickPull(from_branch_id: string, to_branch_id: string, product_id: string, qty: number, performed_by: string) {
  tx((d) => {
    const from = d.branches.find((b) => b.id === from_branch_id);
    const to = d.branches.find((b) => b.id === to_branch_id);
    const now = new Date().toISOString();
    const id = uid();
    d.transfers.push({
      id, from_branch_id, to_branch_id, status: "received",
      requested_by: performed_by, sent_by: performed_by, received_by: performed_by,
      note: "Quick pull — stock fetched in person",
      created_at: now, sent_at: now, received_at: now,
    });
    d.transfer_items.push({ id: uid(), transfer_id: id, product_id, qty_requested: qty, qty_sent: qty, qty_received: qty });
    applyMovement(d, {
      product_id, branch_id: from_branch_id,
      from_location: receivingLoc(d, from_branch_id), to_location: null,
      qty, type: "transfer_out", reference_id: id, performed_by,
      note: `brought to ${to?.name ?? to_branch_id}`,
    });
    applyMovement(d, {
      product_id, branch_id: to_branch_id,
      from_location: null, to_location: "storefront",
      qty, type: "transfer_in", reference_id: id, performed_by,
      note: `from ${from?.name ?? from_branch_id}`,
    });
  });
}

// ---------- Deliveries ----------
export function createDelivery(args: {
  branch_id: string; supplier_name: string; supplier_contact: string; supplier_address: string;
  delivery_date: string; terms: DeliveryTerms; custom_days?: number; received_by: string; note: string;
}): string {
  const id = uid();
  const days = termsDays({ terms: args.terms, custom_days: args.custom_days });
  tx((d) => {
    d.deliveries.push({
      id, branch_id: args.branch_id,
      supplier_name: args.supplier_name,
      supplier_contact: args.supplier_contact,
      supplier_address: args.supplier_address,
      delivery_date: args.delivery_date,
      terms: args.terms,
      custom_days: Math.max(0, Math.round(args.custom_days ?? 0)),
      custom_total: null,
      due_date: days > 0 ? dueDateFrom(args.delivery_date, days) : null,
      received_by: args.received_by, status: "draft", note: args.note || null,
      created_at: new Date().toISOString(),
    });
  });
  return id;
}

// Update supplier details / terms on an existing draft (recomputes the due date).
export function updateDelivery(
  id: string,
  patch: Partial<Pick<Delivery,
    "supplier_name" | "supplier_contact" | "supplier_address" | "delivery_date" | "terms" |
    "custom_days" | "custom_total" | "note">>
) {
  tx((d) => {
    const del = d.deliveries.find((x) => x.id === id);
    if (!del) return;
    Object.assign(del, patch);
    const days = termsDays(del);
    del.due_date = days > 0 ? dueDateFrom(del.delivery_date, days) : null;
  });
}

export function addDeliveryItem(delivery_id: string, product_id: string, qty: number, unit_cost: number) {
  tx((d) => {
    const existing = d.delivery_items.find((i) => i.delivery_id === delivery_id && i.product_id === product_id);
    if (existing) {
      existing.qty += qty;
      existing.unit_cost = unit_cost;
    } else {
      d.delivery_items.push({ id: uid(), delivery_id, product_id, qty, unit_cost });
    }
  });
}

// Correcting a line, rather than deleting it and adding it back. Doing that on
// every keystroke gave the row a new id each time, so the number could never be
// typed over — 1 became 150 on the way to 50.
export function setDeliveryItem(item_id: string, patch: { qty?: number; unit_cost?: number }) {
  tx((d) => {
    const i = d.delivery_items.find((x) => x.id === item_id);
    if (!i) return;
    if (patch.qty !== undefined && patch.qty > 0) i.qty = patch.qty;
    if (patch.unit_cost !== undefined && patch.unit_cost > 0) i.unit_cost = patch.unit_cost;
  });
}

export function removeDeliveryItem(item_id: string) {
  tx((d) => {
    d.delivery_items = d.delivery_items.filter((i) => i.id !== item_id);
  });
}

// Posting increments STOCKROOM qty via delivery_in movements.
export function postDelivery(delivery_id: string, user_id: string) {
  tx((d) => {
    const del = d.deliveries.find((x) => x.id === delivery_id);
    if (!del || del.status === "posted") return;
    d.delivery_items
      .filter((i) => i.delivery_id === delivery_id)
      .forEach((i) => {
        applyMovement(d, {
          product_id: i.product_id, branch_id: del.branch_id,
          from_location: null, to_location: receivingLoc(d, del.branch_id),
          qty: i.qty, type: "delivery_in", reference_id: delivery_id, performed_by: user_id,
        });
      });
    del.status = "posted";
    audit(d, user_id, "post", "delivery", delivery_id, undefined, del);
  });
}

// Undo a posted delivery: take back off the shelf exactly what it put on, and
// leave it as a draft so the mistake can be corrected and posted again.
export function unpostDelivery(delivery_id: string, user_id: string) {
  tx((d) => {
    const del = d.deliveries.find((x) => x.id === delivery_id);
    if (!del || del.status !== "posted") return;
    d.delivery_items
      .filter((i) => i.delivery_id === delivery_id)
      .forEach((i) => {
        applyMovement(d, {
          product_id: i.product_id, branch_id: del.branch_id,
          from_location: receivingLoc(d, del.branch_id), to_location: null,
          qty: i.qty, type: "adjustment", reference_id: delivery_id, performed_by: user_id,
          note: "delivery undone",
        });
      });
    del.status = "draft";
    audit(d, user_id, "unpost", "delivery", delivery_id, { status: "posted" }, { status: "draft" });
  });
}

// Throw the whole delivery away. A posted one gives its stock back first, so
// the shelf figure never keeps something that was never really received.
export function deleteDelivery(delivery_id: string, user_id: string) {
  const del = getDB().deliveries.find((x) => x.id === delivery_id);
  if (del?.status === "posted") unpostDelivery(delivery_id, user_id);
  tx((d) => {
    const gone = d.deliveries.find((x) => x.id === delivery_id);
    d.delivery_items = d.delivery_items.filter((i) => i.delivery_id !== delivery_id);
    d.deliveries = d.deliveries.filter((x) => x.id !== delivery_id);
    if (gone) audit(d, user_id, "delete", "delivery", delivery_id, gone, undefined);
  });
}

// ---------- Adjustments (manager PIN + reason enforced by caller UI) ----------
export function adjustStock(
  product_id: string, branch_id: string, location: Location,
  delta: number, reason: string, performed_by: string, approved_by: string
) {
  tx((d) => {
    applyMovement(d, {
      product_id, branch_id,
      from_location: delta < 0 ? location : null,
      to_location: delta > 0 ? location : null,
      qty: Math.abs(delta), type: "adjustment",
      performed_by, approved_by, note: reason,
    });
    audit(d, performed_by, "adjustment", "inventory", `${branch_id}/${product_id}/${location}`, undefined, { delta, reason, approved_by });
  });
}

// ---------- POS ----------
export interface CartLine {
  product_id: string;
  // Kilos when by_kilo, otherwise packs/pieces.
  qty: number;
  unit_price: number;
  tier: CustomerType;
  by_kilo?: boolean;
  // What to take off the shelf. Only set for kilo sales, where it is the
  // fraction of a pack; null when the weight of a pack isn't known, and then
  // nothing is deducted and the stock count sorts it out.
  stock_qty?: number | null;
}

export function completeSale(args: {
  branch_id: string;
  channel: "onsite" | "online";
  customer_id: string | null;
  cashier_id: string;
  lines: CartLine[];
  discount: number;
  payment_method: PaymentMethod;
  reference_order_id?: string;
}): Sale {
  const id = uid();
  let sale!: Sale;
  tx((d) => {
    const subtotal = args.lines.reduce((s, l) => s + l.unit_price * l.qty, 0);
    d.receipt_counters[args.branch_id] = (d.receipt_counters[args.branch_id] ?? 0) + 1;
    sale = {
      id, branch_id: args.branch_id, channel: args.channel,
      customer_id: args.customer_id, cashier_id: args.cashier_id,
      subtotal, discount: args.discount, total: subtotal - args.discount,
      payment_method: args.payment_method, status: "completed",
      receipt_no: d.receipt_counters[args.branch_id],
      voided_by: null, void_reason: null,
      created_at: new Date().toISOString(),
    };
    d.sales.push(sale);
    args.lines.forEach((l) => {
      const byKilo = Boolean(l.by_kilo);
      const off = byKilo ? (l.stock_qty ?? 0) : l.qty;
      const si: SaleItem = {
        id: uid(), sale_id: id, product_id: l.product_id,
        qty: l.qty, unit_price: l.unit_price, price_tier_applied: l.tier,
        by_kilo: byKilo, stock_qty: byKilo ? l.stock_qty ?? null : null,
      };
      d.sale_items.push(si);
      applyMovement(d, {
        product_id: l.product_id, branch_id: args.branch_id,
        from_location: "storefront", to_location: null,
        qty: off, type: "sale", reference_id: id, performed_by: args.cashier_id,
        note: byKilo ? `${l.qty} kg sold loose` : null,
      });
    });
    audit(d, args.cashier_id, "sale", "sale", id, undefined, { total: sale.total, receipt_no: sale.receipt_no });
  });
  return sale;
}

// Void: soft — sale kept, stock returned via `return` movements.
export function voidSale(sale_id: string, approved_by: string, reason: string) {
  tx((d) => {
    const sale = d.sales.find((s) => s.id === sale_id);
    if (!sale || sale.status === "voided") return;
    sale.status = "voided";
    sale.voided_by = approved_by;
    sale.void_reason = reason;
    d.sale_items
      .filter((i) => i.sale_id === sale_id)
      .forEach((i) => {
        applyMovement(d, {
          product_id: i.product_id, branch_id: sale.branch_id,
          from_location: null, to_location: "storefront",
          // Put back what was taken off the shelf, which for a kilo sale is a
          // fraction of a sack rather than the kilos written on the receipt.
          qty: i.by_kilo ? i.stock_qty ?? 0 : i.qty, type: "return", reference_id: sale_id,
          performed_by: approved_by, note: `void: ${reason}`,
        });
      });
    audit(d, approved_by, "void", "sale", sale_id, { status: "completed" }, { status: "voided", reason });
  });
}

// ---------- Online orders ----------
export function createOnlineOrder(args: {
  branch_id: string; customer_id: string; source: OnlineOrder["source"];
  items: OnlineOrderItem[]; payment_method: PaymentMethod; courier_note: string; by: string;
}): string {
  const id = uid();
  tx((d) => {
    d.online_orders.push({
      id, branch_id: args.branch_id, customer_id: args.customer_id, source: args.source,
      status: "received", items: args.items,
      total: args.items.reduce((s, i) => s + i.unit_price * i.qty, 0),
      payment_method: args.payment_method,
      payment_proof_url: null, payment_verified_by: null, packed_photo_url: null,
      courier_note: args.courier_note, sale_id: null,
      status_history: [{ status: "received", at: new Date().toISOString(), by: args.by }],
      created_at: new Date().toISOString(),
    });
  });
  return id;
}

// Moving to `paid` decrements storefront stock + generates the sale (channel=online).
export function setOrderStatus(order_id: string, status: OrderStatus, by: string) {
  const d0 = getDB();
  const order = d0.online_orders.find((o) => o.id === order_id);
  if (!order) return;
  if (status === "paid" && !order.sale_id) {
    const cust = d0.customers.find((c) => c.id === order.customer_id);
    const tier: CustomerType = cust?.type ?? "retail";
    const sale = completeSale({
      branch_id: order.branch_id, channel: "online", customer_id: order.customer_id,
      cashier_id: by,
      lines: order.items.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price, tier })),
      discount: 0, payment_method: order.payment_method, reference_order_id: order.id,
    });
    tx((d) => {
      const o = d.online_orders.find((x) => x.id === order_id)!;
      o.sale_id = sale.id;
    });
  }
  tx((d) => {
    const o = d.online_orders.find((x) => x.id === order_id)!;
    o.status = status;
    o.status_history.push({ status, at: new Date().toISOString(), by });
    if (status === "paid") o.payment_verified_by = by;
    audit(d, by, "order_status", "online_order", order_id, undefined, { status });
  });
}

export function attachOrderPhoto(order_id: string, field: "payment_proof_url" | "packed_photo_url", dataUrl: string) {
  tx((d) => {
    const o = d.online_orders.find((x) => x.id === order_id);
    if (o) o[field] = dataUrl;
  });
}

// ---------- Transfers ----------
export function createTransfer(from_branch_id: string, to_branch_id: string, items: { product_id: string; qty: number }[], requested_by: string, note: string): string {
  const id = uid();
  tx((d) => {
    d.transfers.push({
      id, from_branch_id, to_branch_id, status: "requested",
      requested_by, sent_by: null, received_by: null, note: note || null,
      created_at: new Date().toISOString(), sent_at: null, received_at: null,
    });
    items.forEach((i) =>
      d.transfer_items.push({ id: uid(), transfer_id: id, product_id: i.product_id, qty_requested: i.qty, qty_sent: null, qty_received: null })
    );
  });
  return id;
}

// Sending decrements source stockroom (transfer_out).
export function sendTransfer(transfer_id: string, qtys: Record<string, number>, sent_by: string) {
  tx((d) => {
    const t = d.transfers.find((x) => x.id === transfer_id);
    if (!t || t.status !== "requested") return;
    d.transfer_items
      .filter((i) => i.transfer_id === transfer_id)
      .forEach((i) => {
        i.qty_sent = qtys[i.id] ?? i.qty_requested;
        if (i.qty_sent > 0)
          applyMovement(d, {
            product_id: i.product_id, branch_id: t.from_branch_id,
            from_location: receivingLoc(d, t.from_branch_id), to_location: null,
            qty: i.qty_sent, type: "transfer_out", reference_id: transfer_id, performed_by: sent_by,
          });
      });
    t.status = "in_transit";
    t.sent_by = sent_by;
    t.sent_at = new Date().toISOString();
  });
}

// Receiving increments destination stockroom (transfer_in); discrepancies flagged in note.
export function receiveTransfer(transfer_id: string, qtys: Record<string, number>, received_by: string) {
  tx((d) => {
    const t = d.transfers.find((x) => x.id === transfer_id);
    if (!t || t.status !== "in_transit") return;
    const discrepancies: string[] = [];
    d.transfer_items
      .filter((i) => i.transfer_id === transfer_id)
      .forEach((i) => {
        i.qty_received = qtys[i.id] ?? i.qty_sent ?? 0;
        if (i.qty_received > 0)
          applyMovement(d, {
            product_id: i.product_id, branch_id: t.to_branch_id,
            from_location: null, to_location: receivingLoc(d, t.to_branch_id),
            qty: i.qty_received, type: "transfer_in", reference_id: transfer_id, performed_by: received_by,
          });
        if (i.qty_received !== (i.qty_sent ?? 0)) {
          const p = d.products.find((pp) => pp.id === i.product_id);
          discrepancies.push(`${p?.name ?? i.product_id}: sent ${i.qty_sent}, received ${i.qty_received}`);
        }
      });
    t.status = "received";
    t.received_by = received_by;
    t.received_at = new Date().toISOString();
    if (discrepancies.length) {
      t.note = ((t.note ?? "") + "\n⚠ DISCREPANCY: " + discrepancies.join("; ")).trim();
      audit(d, received_by, "transfer_discrepancy", "transfer", transfer_id, undefined, discrepancies);
    }
  });
}

// ---------- Attendance ----------
export function clockPunch(args: {
  user_id: string; branch_id: string; type: "in" | "out";
  selfie_url: string | null; lat: number | null; lng: number | null;
  within_geofence: boolean; device_info: string;
}) {
  tx((d) => {
    d.attendance.push({
      id: uid(), ...args,
      flagged: !args.within_geofence || !args.selfie_url,
      reviewed_by: null,
      created_at: new Date().toISOString(),
    });
  });
}

// ---------- Expenses ----------
export function saveExpense(e: Expense) {
  tx((d) => {
    const i = d.expenses.findIndex((x) => x.id === e.id);
    if (i >= 0) d.expenses[i] = e;
    else d.expenses.push(e);
    audit(d, e.recorded_by, i >= 0 ? "update" : "create", "expense", e.id, undefined, { category: e.category, amount: e.amount });
  });
}

export function deleteExpense(id: string, by: string) {
  tx((d) => {
    const e = d.expenses.find((x) => x.id === id);
    d.expenses = d.expenses.filter((x) => x.id !== id);
    if (e) audit(d, by, "delete", "expense", id, e, undefined);
  });
}

// ---------- Post-dated cheques ----------
export function savePDC(c: PDCCheck, by: string) {
  tx((d) => {
    const i = d.pdc_checks.findIndex((x) => x.id === c.id);
    if (i >= 0) d.pdc_checks[i] = c;
    else d.pdc_checks.push(c);
    audit(d, by, i >= 0 ? "update" : "create", "pdc_check", c.id, undefined, { party: c.party_name, amount: c.amount, due: c.due_date });
  });
}

export function setPDCStatus(id: string, status: PDCStatus, by: string) {
  tx((d) => {
    const c = d.pdc_checks.find((x) => x.id === id);
    if (!c) return;
    const before = c.status;
    c.status = status;
    audit(d, by, "pdc_status", "pdc_check", id, { status: before }, { status });
  });
}

// Due date = delivery/issue date + terms days.
export function dueDateFrom(dateISO: string, days: number): string {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

// ---------- Payroll ----------
// Total = (daily rate × days worked) − late − SSS − PhilHealth − Pag-IBIG
//         − SSS loan − advance salary.
export function computePayroll(r: Omit<PayrollRecord, "total_pay">): number {
  const base = r.daily_rate * r.days_worked;
  const lateDeduction = Math.round((r.hourly_rate / 60) * r.late_minutes);
  const deductions =
    lateDeduction + r.sss_contribution + r.philhealth_contribution +
    r.pagibig_contribution + r.sss_loan + r.advance_salary;
  return Math.max(0, base - deductions);
}

export function savePayroll(r: PayrollRecord, by: string) {
  tx((d) => {
    const i = d.payroll.findIndex((x) => x.id === r.id);
    if (i >= 0) d.payroll[i] = r;
    else d.payroll.push(r);
    audit(d, by, i >= 0 ? "update" : "create", "payroll", r.id, undefined, { user: r.user_id, total: r.total_pay });
  });
}

export function deletePayroll(id: string, by: string) {
  tx((d) => {
    const r = d.payroll.find((x) => x.id === id);
    d.payroll = d.payroll.filter((x) => x.id !== id);
    if (r) audit(d, by, "delete", "payroll", id, r, undefined);
  });
}

// ---------- Price tier helper ----------
export function priceFor(p: Product, tier: CustomerType): number {
  if (tier === "wholesaler") return p.wholesale_price;
  if (tier === "suki") return p.suki_price ?? p.retail_price;
  return p.retail_price;
}
