-- CMN Trading Corporation — shared database for all six branches.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- The table and column names match the app's data model one-for-one, so rows
-- can be read and edited straight from the Supabase table editor.
-- Money is stored as whole centavos (₱1.00 = 100). Ids are text because the app
-- generates them on the device before a row ever reaches the server.

-- ============ Reference data ============
create table if not exists branches (
  id text primary key,
  name text not null,
  address text not null default '',
  geofence_lat double precision,
  geofence_lng double precision,
  geofence_radius_m integer not null default 120,
  has_stockroom boolean not null default true,
  active boolean not null default true
);

create table if not exists users (
  id text primary key,
  name text not null,
  role text not null default 'staff',
  branch_id text,
  pin text not null default '',
  active boolean not null default true,
  contact_number text not null default '',
  address text not null default '',
  sss_id text not null default '',
  philhealth_id text not null default '',
  pagibig_id text not null default '',
  birthday text not null default '',
  hired_date text not null default '',
  salary_rate integer not null default 0,
  daily_rate integer not null default 0,
  hourly_rate integer not null default 0
);

create table if not exists products (
  id text primary key,
  sku text not null default '',
  barcode text not null default '',
  name text not null,
  brand text not null default '',
  category text not null default 'other',
  unit text not null default 'pc',
  size_variant text not null default '',
  cost_price integer not null default 0,
  ord_ws_price integer,
  wholesale_price integer not null default 0,
  suki_price integer,
  retail_price integer not null default 0,
  per_kilo integer,
  low_stock_threshold integer not null default 5,
  image_url text,
  active boolean not null default true
);
create index if not exists products_brand_idx on products (brand);
create index if not exists products_category_idx on products (category);

create table if not exists customers (
  id text primary key,
  name text not null,
  phone text not null default '',
  type text not null default 'retail',
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  payment_terms text not null default 'cash'
);

-- ============ Stock ============
create table if not exists inventory (
  id text primary key,
  product_id text not null,
  branch_id text not null,
  location text not null,
  qty integer not null default 0
);
create unique index if not exists inventory_slot_idx on inventory (branch_id, product_id, location);

create table if not exists stock_movements (
  id text primary key,
  product_id text not null,
  branch_id text not null,
  from_location text,
  to_location text,
  qty integer not null,
  type text not null,
  reference_id text,
  performed_by text not null default '',
  approved_by text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists movements_branch_idx on stock_movements (branch_id, created_at desc);

create table if not exists deliveries (
  id text primary key,
  branch_id text not null,
  supplier_name text not null default '',
  supplier_contact text not null default '',
  supplier_address text not null default '',
  delivery_date text not null default '',
  terms text not null default 'cod',
  due_date text,
  received_by text not null default '',
  status text not null default 'draft',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists delivery_items (
  id text primary key,
  delivery_id text not null,
  product_id text not null,
  qty integer not null default 0,
  unit_cost integer not null default 0
);

create table if not exists transfers (
  id text primary key,
  from_branch_id text not null,
  to_branch_id text not null,
  status text not null default 'requested',
  requested_by text not null default '',
  sent_by text,
  received_by text,
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz
);

create table if not exists transfer_items (
  id text primary key,
  transfer_id text not null,
  product_id text not null,
  qty_requested integer not null default 0,
  qty_sent integer,
  qty_received integer
);

-- ============ Selling ============
create table if not exists sales (
  id text primary key,
  branch_id text not null,
  channel text not null default 'onsite',
  customer_id text,
  cashier_id text not null default '',
  subtotal integer not null default 0,
  discount integer not null default 0,
  total integer not null default 0,
  payment_method text not null default 'cash',
  status text not null default 'completed',
  receipt_no integer not null default 0,
  voided_by text,
  void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists sales_branch_idx on sales (branch_id, created_at desc);

create table if not exists sale_items (
  id text primary key,
  sale_id text not null,
  product_id text not null,
  qty integer not null default 0,
  unit_price integer not null default 0,
  price_tier_applied text not null default 'retail'
);

create table if not exists online_orders (
  id text primary key,
  branch_id text not null,
  customer_id text not null default '',
  source text not null default 'call',
  status text not null default 'received',
  items jsonb not null default '[]'::jsonb,
  total integer not null default 0,
  payment_method text not null default 'cash',
  payment_proof_url text,
  payment_verified_by text,
  packed_photo_url text,
  courier_note text not null default '',
  sale_id text,
  status_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ============ People & money ============
create table if not exists attendance (
  id text primary key,
  user_id text not null,
  branch_id text not null,
  type text not null,
  selfie_url text,
  lat double precision,
  lng double precision,
  within_geofence boolean not null default true,
  flagged boolean not null default false,
  reviewed_by text,
  device_info text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id text primary key,
  branch_id text not null,
  category text not null default 'other',
  amount integer not null default 0,
  note text not null default '',
  date text not null default '',
  recorded_by text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists pdc_checks (
  id text primary key,
  direction text not null default 'payable',
  party_name text not null default '',
  customer_id text,
  delivery_id text,
  branch_id text not null default '',
  check_number text not null default '',
  bank text not null default '',
  amount integer not null default 0,
  date_issued text not null default '',
  due_date text not null default '',
  status text not null default 'pending',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pdc_due_idx on pdc_checks (due_date);

create table if not exists payroll (
  id text primary key,
  user_id text not null,
  branch_id text not null default '',
  period_start text not null default '',
  period_end text not null default '',
  daily_rate integer not null default 0,
  hourly_rate integer not null default 0,
  days_worked integer not null default 0,
  days_absent integer not null default 0,
  days_late integer not null default 0,
  late_minutes integer not null default 0,
  days_off integer not null default 0,
  sss_contribution integer not null default 0,
  philhealth_contribution integer not null default 0,
  pagibig_contribution integer not null default 0,
  sss_loan integer not null default 0,
  advance_salary integer not null default 0,
  total_pay integer not null default 0,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id text primary key,
  user_id text not null default '',
  action text not null default '',
  entity text not null default '',
  entity_id text not null default '',
  before text,
  after text,
  created_at timestamptz not null default now()
);

-- Settings and the per-branch receipt counters are single documents, not lists.
create table if not exists app_state (
  key text primary key,
  value jsonb not null
);

-- ============ Live updates ============
-- Lets every branch see changes the moment they happen.
do $$
declare t text;
begin
  foreach t in array array[
    'branches','users','products','customers','inventory','stock_movements',
    'deliveries','delivery_items','transfers','transfer_items','sales','sale_items',
    'online_orders','attendance','expenses','pdc_checks','payroll','audit_log','app_state'
  ] loop
    execute format('alter table %I replica identity full', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============ Access ============
-- Staff sign in with a PIN inside the app rather than with a Supabase account,
-- so the app connects with the anon key and these policies grant it access.
-- Treat the anon key and the project URL as private: anyone who has both can
-- read and write this data. Do not put them in a public page or repository.
do $$
declare t text;
begin
  foreach t in array array[
    'branches','users','products','customers','inventory','stock_movements',
    'deliveries','delivery_items','transfers','transfer_items','sales','sale_items',
    'online_orders','attendance','expenses','pdc_checks','payroll','audit_log','app_state'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists cmn_app_access on %I', t);
    execute format(
      'create policy cmn_app_access on %I for all to anon, authenticated using (true) with check (true)', t
    );
  end loop;
end $$;
