// Deterministic demo seed: 6 branches, users per role, the real CMN product
// catalog (imported from products-data.json), customers of each type, plus
// generated sales/movement history so the dashboards have content.
import {
  DB, Branch, User, Product, Customer, InventoryRow, StockMovement, Sale, SaleItem,
  OnlineOrder, CustomerType, Attendance,
} from "./types";
import PRODUCTS_RAW from "./products-data.json";

// Compact record shape from products-data.json (generated from the CMN Excel).
interface RawProduct {
  s: string; b: string; n: string; br: string; c: string;
  u: string; sz: string; r: number; w: number; k: number; co: number;
}

// Small seeded PRNG so every fresh demo looks the same.
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = (n: number) => Math.round(n * 100); // pesos -> centavos

// [name, address, lat, lng, has 2F stockroom]
const BRANCH_DEFS = [
  ["Main Branch", "", 14.5995, 120.9842, true],
  ["Unit 17", "", 14.6021, 120.9868, true],
  ["Unit 20", "", 14.5958, 120.9812, true],
  ["Unit 10-11", "", 14.6042, 120.9825, true],
  ["Unit 04-18", "", 14.5977, 120.9891, true],
  ["Unit 16", "", 14.6008, 120.9799, false],
] as const;

// Default low-stock threshold by unit type (bulky = lower, small = higher).
function thresholdFor(unit: string): number {
  const u = unit.toLowerCase();
  if (u.includes('sack') || u.includes('bag')) return 3;
  if (u.includes('can') || u.includes('pouch')) return 12;
  if (u.includes('piece') || u.includes('pc')) return 6;
  return 6;
}

const CUSTOMER_DEFS: [string, string, CustomerType, string, string][] = [
  ["Aling Nena Sari-Sari Store", "09171234501", "wholesaler", "Blk 4 Lot 2, Poblacion", "Orders weekly, sacks only"],
  ["Kuya Ben Pet Shop", "09181234502", "wholesaler", "Stall 12, Public Market", "Prefers Vitality & SmartHeart"],
  ["Mang Tomas Agrivet", "09191234503", "wholesaler", "National Highway", "COD via own driver"],
  ["Maria Santos", "09201234504", "suki", "Unit 3B, Plaza Rizal Apts", "3 cats — Me-O & Whiskas"],
  ["Jun dela Cruz", "09211234505", "suki", "9 Riverside Dr", "Aspin owner, buys Pedigree 3kg"],
  ["Grace Lim", "09221234506", "suki", "Terminal Ave", "Persian cat, Kit Cat litter monthly"],
  ["Robert Tan", "09231234507", "suki", "Mabini St", "2 shih tzus, Saint Roche shampoo"],
  ["Ana Reyes", "09241234508", "retail", "", "Walk-in"],
  ["Paolo Garcia", "09251234509", "retail", "", "Occasional buyer"],
  ["Liza Mercado", "09261234510", "suki", "Poblacion", "Kitten milk replacer regular"],
];

export function buildSeed(): DB {
  const rand = mulberry32(20260722);
  const now = Date.now();

  const branches: Branch[] = BRANCH_DEFS.map((b, i) => ({
    id: `b${i + 1}`,
    name: b[0],
    address: b[1],
    geofence_lat: b[2],
    geofence_lng: b[3],
    geofence_radius_m: 120,
    has_stockroom: b[4],
    active: true,
  }));

  const users: User[] = [
    { id: "u-owner", name: "Carmen M. Nolasco", role: "owner", branch_id: null, pin: "9999", active: true },
  ];
  const managerNames = ["Rosa Vergara", "Dante Cruz", "Fe Ramos", "Nilo Bautista", "Tess Aquino", "Marlon Diaz"];
  const staffNames = [
    ["Joy Salazar", "Rico Ferrer"], ["Mika Ocampo", "Aldo Reyes"], ["Bea Torres", "Caloy Uy"],
    ["Dina Flores", "Erwin Go"], ["Faye Mateo", "Gino Silang"], ["Hana Perez", "Ivan Cruz"],
  ];
  branches.forEach((b, i) => {
    users.push({ id: `u-mgr-${i + 1}`, name: managerNames[i], role: "manager", branch_id: b.id, pin: String(1111 * (i + 1)).padStart(4, "0").slice(0, 4), active: true });
    staffNames[i].forEach((n, j) => {
      users.push({ id: `u-stf-${i + 1}-${j + 1}`, name: n, role: "staff", branch_id: b.id, pin: `${i + 1}${j + 1}${i + 1}${j + 1}`, active: true });
    });
  });

  const products: Product[] = (PRODUCTS_RAW as RawProduct[]).map((r, i) => ({
    id: `p${i + 1}`,
    sku: r.s, barcode: r.b, name: r.n, brand: r.br, category: r.c as Product["category"],
    unit: r.u, size_variant: r.sz,
    retail_price: r.r, wholesale_price: r.w, suki_price: r.k, cost_price: r.co,
    low_stock_threshold: thresholdFor(r.u), image_url: null, active: true,
  }));

  const customers: Customer[] = CUSTOMER_DEFS.map((c, i) => ({
    id: `c${i + 1}`, name: c[0], phone: c[1], type: c[2], address: c[3], notes: c[4], active: true,
  }));

  // Inventory: stockroom + storefront rows per product per branch.
  const inventory: InventoryRow[] = [];
  const movements: StockMovement[] = [];
  branches.forEach((b) => {
    products.forEach((p) => {
      const base = p.low_stock_threshold;
      // A few items intentionally at/below threshold so low-stock screens have content.
      const lowItem = rand() < 0.12;
      const stockQty = lowItem ? Math.floor(rand() * base) : base * 2 + Math.floor(rand() * base * 3);
      const frontQty = lowItem ? Math.floor(rand() * 2) : Math.floor(base / 2) + Math.floor(rand() * base);
      if (b.has_stockroom) {
        inventory.push({ id: `inv-${b.id}-${p.id}-sr`, product_id: p.id, branch_id: b.id, location: "stockroom", qty: stockQty });
        inventory.push({ id: `inv-${b.id}-${p.id}-sf`, product_id: p.id, branch_id: b.id, location: "storefront", qty: frontQty });
      } else {
        // No 2F stockroom: everything lives on the store floor.
        inventory.push({ id: `inv-${b.id}-${p.id}-sf`, product_id: p.id, branch_id: b.id, location: "storefront", qty: stockQty + frontQty });
      }
    });
  });

  // 14 days of sales history per branch (writes sale + sale_items + sale movements).
  const sales: Sale[] = [];
  const sale_items: SaleItem[] = [];
  const receipt_counters: Record<string, number> = {};
  branches.forEach((b) => (receipt_counters[b.id] = 0));

  const payMethods = ["cash", "cash", "cash", "gcash", "bank_transfer"] as const;
  for (let day = 13; day >= 0; day--) {
    branches.forEach((b, bi) => {
      const nSales = 4 + Math.floor(rand() * 6);
      for (let s = 0; s < nSales; s++) {
        const ts = new Date(now - day * 86400000 - (9 - Math.floor(rand() * 9)) * 3600000 - Math.floor(rand() * 3600000));
        if (ts.getTime() > now) continue;
        const cust = rand() < 0.3 ? customers[Math.floor(rand() * customers.length)] : null;
        const tier: CustomerType = cust ? cust.type : "retail";
        const nItems = 1 + Math.floor(rand() * 3);
        let subtotal = 0;
        const saleId = `seed-sale-${b.id}-${day}-${s}`;
        const itemsForSale: SaleItem[] = [];
        for (let it = 0; it < nItems; it++) {
          const p = products[Math.floor(rand() * products.length)];
          const qty = p.retail_price > P(1000) ? 1 : 1 + Math.floor(rand() * 3);
          const price = tier === "wholesaler" ? p.wholesale_price : tier === "suki" ? (p.suki_price ?? p.retail_price) : p.retail_price;
          subtotal += price * qty;
          itemsForSale.push({ id: `${saleId}-i${it}`, sale_id: saleId, product_id: p.id, qty, unit_price: price, price_tier_applied: tier });
          movements.push({
            id: `${saleId}-m${it}`, product_id: p.id, branch_id: b.id,
            from_location: "storefront", to_location: null, qty,
            type: "sale", reference_id: saleId,
            performed_by: `u-stf-${bi + 1}-1`, approved_by: null, note: null,
            created_at: ts.toISOString(),
          });
        }
        receipt_counters[b.id]++;
        sales.push({
          id: saleId, branch_id: b.id, channel: rand() < 0.2 ? "online" : "onsite",
          customer_id: cust?.id ?? null, cashier_id: `u-stf-${bi + 1}-${1 + Math.floor(rand() * 2)}`,
          subtotal, discount: 0, total: subtotal,
          payment_method: payMethods[Math.floor(rand() * payMethods.length)],
          status: "completed", receipt_no: receipt_counters[b.id],
          voided_by: null, void_reason: null, created_at: ts.toISOString(),
        });
        sale_items.push(...itemsForSale);
      }
    });
  }

  // A few live online orders on the Main Branch board.
  const online_orders: OnlineOrder[] = [
    {
      id: "oo1", branch_id: "b1", customer_id: "c4", source: "messenger", status: "received",
      items: [{ product_id: "p11", qty: 2, unit_price: products[10].suki_price! }, { product_id: "p31", qty: 1, unit_price: products[30].suki_price! }],
      total: products[10].suki_price! * 2 + products[30].suki_price!,
      payment_method: "gcash", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "", sale_id: null,
      status_history: [{ status: "received", at: new Date(now - 3600000).toISOString(), by: "u-stf-1-1" }],
      created_at: new Date(now - 3600000).toISOString(),
    },
    {
      id: "oo2", branch_id: "b1", customer_id: "c1", source: "viber", status: "preparing",
      items: [{ product_id: "p4", qty: 5, unit_price: products[3].wholesale_price }],
      total: products[3].wholesale_price * 5,
      payment_method: "bank_transfer", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "Lalamove pickup 3pm", sale_id: null,
      status_history: [
        { status: "received", at: new Date(now - 7200000).toISOString(), by: "u-stf-1-1" },
        { status: "preparing", at: new Date(now - 5400000).toISOString(), by: "u-stf-1-2" },
      ],
      created_at: new Date(now - 7200000).toISOString(),
    },
    {
      id: "oo3", branch_id: "b1", customer_id: "c6", source: "call", status: "ready_awaiting_payment",
      items: [{ product_id: "p31", qty: 2, unit_price: products[30].suki_price! }],
      total: products[30].suki_price! * 2,
      payment_method: "gcash", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "", sale_id: null,
      status_history: [
        { status: "received", at: new Date(now - 10800000).toISOString(), by: "u-stf-1-1" },
        { status: "preparing", at: new Date(now - 9000000).toISOString(), by: "u-stf-1-1" },
        { status: "ready_awaiting_payment", at: new Date(now - 7200000).toISOString(), by: "u-stf-1-1" },
      ],
      created_at: new Date(now - 10800000).toISOString(),
    },
  ];

  // Today's attendance (clock-ins this morning at each branch).
  const attendance: Attendance[] = [];
  branches.forEach((b, bi) => {
    for (let j = 1; j <= 2; j++) {
      const inTime = new Date(now - (now % 86400000)); // approx midnight UTC; fine for demo
      attendance.push({
        id: `att-${b.id}-${j}`, user_id: `u-stf-${bi + 1}-${j}`, branch_id: b.id, type: "in",
        selfie_url: null, lat: b.geofence_lat + (rand() - 0.5) * 0.0008, lng: b.geofence_lng + (rand() - 0.5) * 0.0008,
        within_geofence: rand() > 0.15, flagged: false, reviewed_by: null,
        device_info: "Seeded demo record",
        created_at: new Date(now - 5 * 3600000 - Math.floor(rand() * 1800000)).toISOString(),
      });
    }
  });
  attendance.forEach((a) => { a.flagged = !a.within_geofence; });

  return {
    seeded_at: new Date(now).toISOString(),
    branches, users, products, customers, inventory,
    stock_movements: movements,
    deliveries: [], delivery_items: [],
    transfers: [], transfer_items: [],
    sales, sale_items, online_orders, attendance,
    audit_log: [],
    settings: {
      receipt_header: "CMN Trading Corporation",
      receipt_footer: "This serves as your official receipt.\nThank you! Balik po kayo!",
      paper_width: "58mm",
      tax_label: "VAT-inclusive",
      bank_details: "BDO 0012-3456-7890 (CMN Trading Corp)",
      gcash_details: "GCash 0917-123-4567 (C. Nolasco)",
      low_stock_default: 5,
      monthly_target: 50000000, // ₱500,000 per branch per month
    },
    receipt_counters,
  };
}
