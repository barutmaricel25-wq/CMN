// Core data model — mirrors supabase/migrations/0001_schema.sql exactly.
// All money values are integers in centavos (₱1.00 = 100).

export type Role = "owner" | "manager" | "staff";
export type Location = "stockroom" | "storefront";
export type MovementType =
  | "delivery_in"
  | "pull_down"
  | "transfer_out"
  | "transfer_in"
  | "sale"
  | "adjustment"
  | "return";
export type CustomerType = "retail" | "suki" | "wholesaler";

// Display labels — "retail" tier is shown to users as "Online Reseller".
export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  retail: "Online Reseller",
  suki: "Suki",
  wholesaler: "Wholesaler",
};

export type PaymentTerms = "cash" | "pdc";

// How long a customer's post-dated cheque runs for. Wholesalers are usually on
// one of these; "none" means the due date is agreed cheque by cheque.
export type CustomerPDCTerms = "none" | "pdc7" | "pdc15" | "pdc30";
export const CUSTOMER_PDC_TERMS: CustomerPDCTerms[] = ["none", "pdc7", "pdc15", "pdc30"];
export const CUSTOMER_PDC_DAYS: Record<CustomerPDCTerms, number> = { none: 0, pdc7: 7, pdc15: 15, pdc30: 30 };
export const CUSTOMER_PDC_LABEL: Record<CustomerPDCTerms, string> = {
  none: "Per cheque",
  pdc7: "7 days",
  pdc15: "15 days",
  pdc30: "30 days",
};
export type PaymentMethod = "cash" | "bank_transfer" | "gcash" | "other";
export type SaleChannel = "onsite" | "online";
export type OrderStatus =
  | "received"
  | "preparing"
  | "ready_awaiting_payment"
  | "payment_review"
  | "paid"
  | "packed"
  | "picked_up"
  | "cancelled";
export type OrderSource = "call" | "sms" | "messenger" | "viber" | "order_form";

export interface Branch {
  id: string;
  name: string;
  address: string;
  geofence_lat: number;
  geofence_lng: number;
  geofence_radius_m: number;
  // false = no 2F stockroom: deliveries/transfers go straight to the store floor.
  has_stockroom: boolean;
  // The order the branches are listed in, everywhere in the app.
  sort_order: number;
  active: boolean;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  branch_id: string | null; // null for owner
  pin: string; // demo mode: plain 4-digit PIN. Real schema stores pin_hash.
  active: boolean;
  // HR / employee record
  contact_number: string;
  address: string;
  sss_id: string;
  philhealth_id: string;
  pagibig_id: string;
  birthday: string;    // YYYY-MM-DD
  hired_date: string;  // YYYY-MM-DD
  salary_rate: number; // monthly, centavos
  daily_rate: number;  // centavos
  hourly_rate: number; // centavos
}

// Categories are free text: importing a price list creates one category per
// worksheet, named exactly as the sheet is named ("Cat Food Per Bag"). These
// are only the starting set and the fallback for anything uncategorised.
export const CATEGORIES = [
  "dry food",
  "wet food",
  "treats",
  "litter & accessories",
  "grooming/cleaning",
  "health",
  "carriers & cages",
  "collars/leash/harness",
  "toys & scratchers",
  "bowls & feeding",
  "cologne",
  "other",
] as const;
export type Category = string;

// Branches in the order the shop lists them. Anything without an order set
// sorts after the rest rather than jumping to the front.
export function inBranchOrder<T extends { sort_order?: number; name: string }>(branches: T[]): T[] {
  return [...branches].sort(
    (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)
  );
}

// Every category actually in use, in the order a person would look for them.
export function categoriesOf(products: { category: string }[]): string[] {
  return Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: Category;
  unit: string;
  size_variant: string;
  // Price columns mirroring the CMN price list, in centavos:
  cost_price: number;          // UNIT PRICE (owner-only)
  ord_ws_price: number | null; // ORD W/S
  wholesale_price: number;     // WHOLE SALE
  suki_price: number | null;   // LAST PRICE (the suki tier)
  retail_price: number;        // SELLING PRICE
  per_kilo: number | null;     // KILO (price per kilo reference)
  low_stock_threshold: number;
  image_url: string | null;
  active: boolean;
}

export interface InventoryRow {
  id: string;
  product_id: string;
  branch_id: string;
  location: Location;
  qty: number;
}

export interface StockMovement {
  id: string;
  product_id: string;
  branch_id: string;
  from_location: Location | null;
  to_location: Location | null;
  qty: number;
  type: MovementType;
  reference_id: string | null;
  performed_by: string;
  approved_by: string | null;
  note: string | null;
  created_at: string;
}

// COD or post-dated cheque terms counted from the delivery date.
export type DeliveryTerms = "cod" | "pdc30" | "pdc45" | "pdc60";
export const TERMS_DAYS: Record<DeliveryTerms, number> = { cod: 0, pdc30: 30, pdc45: 45, pdc60: 60 };
export const TERMS_LABEL: Record<DeliveryTerms, string> = {
  cod: "COD (Cash on Delivery)",
  pdc30: "PDC 30 days",
  pdc45: "PDC 45 days",
  pdc60: "PDC 60 days",
};

export interface Delivery {
  id: string;
  branch_id: string;
  supplier_name: string;      // company name
  supplier_contact: string;   // phone / contact number
  supplier_address: string;
  delivery_date: string;      // YYYY-MM-DD
  terms: DeliveryTerms;
  due_date: string | null;    // PDC due date (delivery date + terms days)
  received_by: string;
  status: "draft" | "posted";
  note: string | null;
  created_at: string;
}

export interface DeliveryItem {
  id: string;
  delivery_id: string;
  product_id: string;
  qty: number;
  unit_cost: number;
}

export interface Transfer {
  id: string;
  from_branch_id: string;
  to_branch_id: string;
  status: "requested" | "in_transit" | "received";
  requested_by: string;
  sent_by: string | null;
  received_by: string | null;
  note: string | null;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
}

export interface TransferItem {
  id: string;
  transfer_id: string;
  product_id: string;
  qty_requested: number;
  qty_sent: number | null;
  qty_received: number | null;
}

export interface Customer {
  id: string;
  // Suki and wholesaler accounts belong to the branch that deals with them.
  branch_id: string;
  name: string;
  phone: string;
  cp_number: string; // mobile number
  type: CustomerType;
  address: string;
  notes: string;
  active: boolean;
  payment_terms: PaymentTerms;  // suki/wholesaler may pay by PDC
  pdc_terms: CustomerPDCTerms;  // how many days their cheques run
}

export interface Sale {
  id: string;
  branch_id: string;
  channel: SaleChannel;
  customer_id: string | null;
  cashier_id: string;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  status: "completed" | "voided";
  receipt_no: number; // per-branch sequential
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  price_tier_applied: CustomerType;
}

export interface OnlineOrderItem {
  product_id: string;
  qty: number;
  unit_price: number;
}

export interface OnlineOrder {
  id: string;
  branch_id: string;
  customer_id: string;
  source: OrderSource;
  status: OrderStatus;
  items: OnlineOrderItem[];
  total: number;
  payment_method: PaymentMethod;
  payment_proof_url: string | null; // demo: data URL
  payment_verified_by: string | null;
  packed_photo_url: string | null;
  courier_note: string;
  sale_id: string | null;
  status_history: { status: OrderStatus; at: string; by: string }[];
  created_at: string;
}

export interface Attendance {
  id: string;
  user_id: string;
  branch_id: string;
  type: "in" | "out";
  selfie_url: string | null; // demo: data URL
  lat: number | null;
  lng: number | null;
  within_geofence: boolean;
  flagged: boolean;
  reviewed_by: string | null;
  device_info: string;
  created_at: string;
}

// ---------- Expenses ----------
export const EXPENSE_CATEGORIES = [
  "store rental",
  "electricity",
  "water",
  "telephone bills",
  "plastic bags",
  "daily expenses",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  branch_id: string;
  category: ExpenseCategory;
  amount: number; // centavos
  note: string;
  date: string;   // YYYY-MM-DD
  recorded_by: string;
  created_at: string;
}

// ---------- Post-dated cheques ----------
// Issued BY us to a supplier (payable) or received FROM a suki/wholesaler (receivable).
export type PDCDirection = "payable" | "receivable";
export type PDCStatus = "pending" | "cleared" | "bounced" | "cancelled";

export interface PDCCheck {
  id: string;
  direction: PDCDirection;
  party_name: string;            // company / customer name
  customer_id: string | null;
  delivery_id: string | null;
  branch_id: string;
  check_number: string;
  bank: string;
  amount: number;                // centavos
  date_issued: string;           // date of payment / when cheque was handed over
  due_date: string;              // encashment date
  status: PDCStatus;
  note: string;
  created_at: string;
}

// ---------- Payroll ----------
export interface PayrollRecord {
  id: string;
  user_id: string;
  branch_id: string;
  period_start: string;
  period_end: string;
  daily_rate: number;       // snapshot at time of run, centavos
  hourly_rate: number;      // centavos (used for late deductions)
  days_worked: number;
  days_absent: number;
  days_late: number;
  late_minutes: number;
  days_off: number;
  // Statutory deductions (centavos) — defaults come from Settings.
  sss_contribution: number;
  philhealth_contribution: number;
  pagibig_contribution: number;
  sss_loan: number;
  advance_salary: number;   // centavos, deducted
  total_pay: number;        // centavos, computed
  note: string;
  created_by: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  entity: string;
  entity_id: string;
  before: string | null;
  after: string | null;
  created_at: string;
}

export interface Settings {
  receipt_header: string;
  receipt_footer: string;
  paper_width: "58mm" | "80mm";
  tax_label: string; // configurable, no hardcoded BIR compliance
  low_stock_default: number;
  monthly_target: number; // centavos, per-branch monthly sales goal
  // Payroll defaults (centavos) — prefilled on every new payslip.
  default_daily_rate: number;
  sss_rate: number;
  philhealth_rate: number;
  pagibig_rate: number;
  // The shop password, as a salted derivation — never the password itself.
  // Empty means no password is set and the app opens straight to sign-in.
  shop_password: string;
  // When it was last set, so the owner can see the door is actually locked.
  shop_password_set_at: string;
}

export interface DB {
  seeded_at: string;
  branches: Branch[];
  users: User[];
  products: Product[];
  inventory: InventoryRow[];
  stock_movements: StockMovement[];
  deliveries: Delivery[];
  delivery_items: DeliveryItem[];
  transfers: Transfer[];
  transfer_items: TransferItem[];
  customers: Customer[];
  sales: Sale[];
  sale_items: SaleItem[];
  online_orders: OnlineOrder[];
  attendance: Attendance[];
  expenses: Expense[];
  pdc_checks: PDCCheck[];
  payroll: PayrollRecord[];
  audit_log: AuditLog[];
  settings: Settings;
  receipt_counters: Record<string, number>; // branch_id -> last receipt no
}
