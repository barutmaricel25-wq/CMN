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
  active: boolean;
}

export interface User {
  id: string;
  name: string;
  role: Role;
  branch_id: string | null; // null for owner
  pin: string; // demo mode: plain 4-digit PIN. Real schema stores pin_hash.
  active: boolean;
}

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
export type Category = (typeof CATEGORIES)[number];

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  brand: string;
  category: Category;
  unit: string;
  size_variant: string;
  retail_price: number;
  wholesale_price: number;
  suki_price: number | null;
  cost_price: number;
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

export interface Delivery {
  id: string;
  branch_id: string;
  supplier_name: string;
  delivery_date: string;
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
  name: string;
  phone: string;
  type: CustomerType;
  address: string;
  notes: string;
  active: boolean;
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
  bank_details: string;
  gcash_details: string;
  low_stock_default: number;
  monthly_target: number; // centavos, per-branch monthly sales goal
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
  audit_log: AuditLog[];
  settings: Settings;
  receipt_counters: Record<string, number>; // branch_id -> last receipt no
}
