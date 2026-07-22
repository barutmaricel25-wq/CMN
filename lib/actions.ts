"use client";
// Domain actions. RULE: every quantity change writes a stock_movements row —
// inventory qty is always adjusted through applyMovement(), no exceptions.
import { tx, getDB } from "./store";
import { uid } from "./util";
import {
  DB, Location, MovementType, Product, Sale, SaleItem, CustomerType,
  PaymentMethod, OnlineOrder, OrderStatus, OnlineOrderItem, Delivery, Transfer,
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

// ---------- Pull-down (the #1 fix) ----------
export function pullDown(product_id: string, branch_id: string, qty: number, performed_by: string) {
  tx((d) => {
    applyMovement(d, {
      product_id, branch_id, from_location: "stockroom", to_location: "storefront",
      qty, type: "pull_down", performed_by,
    });
  });
}

// ---------- Deliveries ----------
export function createDelivery(branch_id: string, supplier_name: string, received_by: string, note: string): string {
  const id = uid();
  tx((d) => {
    d.deliveries.push({
      id, branch_id, supplier_name,
      delivery_date: new Date().toISOString(),
      received_by, status: "draft", note: note || null,
      created_at: new Date().toISOString(),
    });
  });
  return id;
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
  qty: number;
  unit_price: number;
  tier: CustomerType;
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
      const si: SaleItem = {
        id: uid(), sale_id: id, product_id: l.product_id,
        qty: l.qty, unit_price: l.unit_price, price_tier_applied: l.tier,
      };
      d.sale_items.push(si);
      applyMovement(d, {
        product_id: l.product_id, branch_id: args.branch_id,
        from_location: "storefront", to_location: null,
        qty: l.qty, type: "sale", reference_id: id, performed_by: args.cashier_id,
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
          qty: i.qty, type: "return", reference_id: sale_id,
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

// ---------- Price tier helper ----------
export function priceFor(p: Product, tier: CustomerType): number {
  if (tier === "wholesaler") return p.wholesale_price;
  if (tier === "suki") return p.suki_price ?? p.retail_price;
  return p.retail_price;
}
