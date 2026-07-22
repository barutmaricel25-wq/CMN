-- CMN Trading Corporation — Multi-Branch Pet Supply Management System
-- Full schema + RLS. Money stored as integers in centavos. Timezone: Asia/Manila.

create extension if not exists "pgcrypto";

-- ============ Enums ============
create type user_role as enum ('owner','manager','staff');
create type inv_location as enum ('stockroom','storefront');
create type movement_type as enum ('delivery_in','pull_down','transfer_out','transfer_in','sale','adjustment','return');
create type customer_type as enum ('retail','suki','wholesaler');
create type payment_method as enum ('cash','bank_transfer','gcash','other');
create type sale_channel as enum ('onsite','online');
create type sale_status as enum ('completed','voided');
create type delivery_status as enum ('draft','posted');
create type transfer_status as enum ('requested','in_transit','received');
create type order_status as enum ('received','preparing','ready_awaiting_payment','payment_review','paid','packed','picked_up','cancelled');
create type order_source as enum ('call','sms','messenger','viber','order_form');
create type punch_type as enum ('in','out');

-- ============ Tables ============
create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  geofence_lat double precision,
  geofence_lng double precision,
  geofence_radius_m integer not null default 120,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- app users; id matches auth.users.id for email/password accounts.
-- Staff share a branch device login; the PIN identifies the person per action.
create table users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  name text not null,
  role user_role not null default 'staff',
  branch_id uuid references branches(id),   -- null for owner
  pin_hash text not null,                   -- bcrypt/argon2 of the 4-digit PIN
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint owner_has_no_branch check (role <> 'owner' or branch_id is null)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text not null,
  name text not null,
  brand text not null default '',
  category text not null default 'other',
  unit text not null default 'pc',
  size_variant text not null default '',
  retail_price integer not null,            -- centavos
  wholesale_price integer not null,
  suki_price integer,
  cost_price integer not null default 0,
  low_stock_threshold integer not null default 5,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index products_barcode_idx on products(barcode);
create index products_category_idx on products(category);

-- Materialized qty per product/branch/location; source of truth is stock_movements.
create table inventory (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  branch_id uuid not null references branches(id),
  location inv_location not null,
  qty integer not null default 0,
  unique (product_id, branch_id, location)
);
create index inventory_branch_idx on inventory(branch_id);

-- EVERY quantity change writes a row here. No exceptions.
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  branch_id uuid not null references branches(id),
  from_location inv_location,
  to_location inv_location,
  qty integer not null check (qty > 0),
  type movement_type not null,
  reference_id uuid,
  performed_by uuid not null references users(id),
  approved_by uuid references users(id),
  note text,
  created_at timestamptz not null default now()
);
create index stock_movements_branch_created_idx on stock_movements(branch_id, created_at desc);
create index stock_movements_product_idx on stock_movements(product_id);

-- Trigger: keep materialized inventory in sync with the ledger.
create or replace function apply_stock_movement() returns trigger
language plpgsql security definer as $$
begin
  if new.from_location is not null then
    insert into inventory (product_id, branch_id, location, qty)
    values (new.product_id, new.branch_id, new.from_location, -new.qty)
    on conflict (product_id, branch_id, location)
    do update set qty = inventory.qty - new.qty;
  end if;
  if new.to_location is not null then
    insert into inventory (product_id, branch_id, location, qty)
    values (new.product_id, new.branch_id, new.to_location, new.qty)
    on conflict (product_id, branch_id, location)
    do update set qty = inventory.qty + new.qty;
  end if;
  return new;
end $$;
create trigger stock_movement_applies
  after insert on stock_movements
  for each row execute function apply_stock_movement();

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  supplier_name text not null,
  delivery_date timestamptz not null default now(),
  received_by uuid not null references users(id),
  status delivery_status not null default 'draft',
  note text,
  created_at timestamptz not null default now()
);

create table delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  product_id uuid not null references products(id),
  qty integer not null check (qty > 0),
  unit_cost integer not null default 0
);

create table transfers (
  id uuid primary key default gen_random_uuid(),
  from_branch_id uuid not null references branches(id),
  to_branch_id uuid not null references branches(id),
  status transfer_status not null default 'requested',
  requested_by uuid not null references users(id),
  sent_by uuid references users(id),
  received_by uuid references users(id),
  note text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  check (from_branch_id <> to_branch_id)
);

create table transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references transfers(id) on delete cascade,
  product_id uuid not null references products(id),
  qty_requested integer not null check (qty_requested > 0),
  qty_sent integer,
  qty_received integer
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  type customer_type not null default 'retail',
  price_tier customer_type generated always as (type) stored,
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-branch sequential receipt numbers.
create table receipt_counters (
  branch_id uuid primary key references branches(id),
  last_no integer not null default 0
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  channel sale_channel not null default 'onsite',
  customer_id uuid references customers(id),
  cashier_id uuid not null references users(id),
  subtotal integer not null,
  discount integer not null default 0,
  total integer not null,
  payment_method payment_method not null,
  status sale_status not null default 'completed',
  receipt_no integer not null,
  voided_by uuid references users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  unique (branch_id, receipt_no)
);
create index sales_branch_created_idx on sales(branch_id, created_at desc);

create or replace function next_receipt_no(p_branch uuid) returns integer
language plpgsql security definer as $$
declare n integer;
begin
  insert into receipt_counters (branch_id, last_no) values (p_branch, 1)
  on conflict (branch_id) do update set last_no = receipt_counters.last_no + 1
  returning last_no into n;
  return n;
end $$;

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  qty integer not null check (qty > 0),
  unit_price integer not null,
  price_tier_applied customer_type not null default 'retail'
);

create table online_orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  customer_id uuid not null references customers(id),
  source order_source not null default 'messenger',
  status order_status not null default 'received',
  items jsonb not null default '[]',  -- [{product_id, qty, unit_price}]
  total integer not null default 0,
  payment_method payment_method not null default 'gcash',
  payment_proof_url text,
  payment_verified_by uuid references users(id),
  packed_photo_url text,
  courier_note text not null default '',
  sale_id uuid references sales(id),
  status_history jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index online_orders_branch_status_idx on online_orders(branch_id, status);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  branch_id uuid not null references branches(id),
  type punch_type not null,
  selfie_url text,
  lat double precision,
  lng double precision,
  within_geofence boolean not null default false,
  flagged boolean not null default false,
  reviewed_by uuid references users(id),
  device_info text not null default '',
  created_at timestamptz not null default now()
);
create index attendance_branch_created_idx on attendance(branch_id, created_at desc);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log(created_at desc);

create table settings (
  id integer primary key default 1 check (id = 1),
  receipt_header text not null default 'CMN Trading Corporation',
  receipt_footer text not null default 'This serves as your official receipt.',
  paper_width text not null default '58mm',
  tax_label text not null default 'VAT-inclusive',
  bank_details text not null default '',
  gcash_details text not null default '',
  low_stock_default integer not null default 5
);
insert into settings (id) values (1);

-- ============ RLS ============
-- Helper functions read the caller's app-user row via auth.uid().
create or replace function current_app_user() returns users
language sql security definer stable as $$
  select u.* from users u where u.auth_user_id = auth.uid() limit 1;
$$;

create or replace function my_role() returns user_role
language sql security definer stable as $$
  select role from users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function my_branch() returns uuid
language sql security definer stable as $$
  select branch_id from users where auth_user_id = auth.uid() limit 1;
$$;

alter table branches enable row level security;
alter table users enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table stock_movements enable row level security;
alter table deliveries enable row level security;
alter table delivery_items enable row level security;
alter table transfers enable row level security;
alter table transfer_items enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table online_orders enable row level security;
alter table attendance enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;
alter table receipt_counters enable row level security;

-- Shared reference data: any authenticated user can read.
create policy branches_read on branches for select to authenticated using (true);
create policy products_read on products for select to authenticated using (true);
create policy customers_read on customers for select to authenticated using (true);
create policy settings_read on settings for select to authenticated using (true);
create policy users_read on users for select to authenticated using (true);

-- Owner-only management of reference data.
create policy branches_owner_write on branches for all to authenticated
  using (my_role() = 'owner') with check (my_role() = 'owner');
create policy users_owner_write on users for all to authenticated
  using (my_role() = 'owner') with check (my_role() = 'owner');
create policy settings_owner_write on settings for update to authenticated
  using (my_role() = 'owner') with check (my_role() = 'owner');
create policy products_mgr_write on products for all to authenticated
  using (my_role() in ('owner','manager')) with check (my_role() in ('owner','manager'));
create policy customers_write on customers for all to authenticated
  using (true) with check (true);  -- all staff can add/edit customers

-- Branch-scoped rows: staff/manager see their branch; owner sees all.
create policy inventory_branch on inventory for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy movements_branch_read on stock_movements for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy movements_branch_insert on stock_movements for insert to authenticated
  with check (my_role() = 'owner' or branch_id = my_branch());
create policy deliveries_branch on deliveries for all to authenticated
  using (my_role() = 'owner' or branch_id = my_branch())
  with check (my_role() = 'owner' or branch_id = my_branch());
create policy delivery_items_branch on delivery_items for all to authenticated
  using (exists (select 1 from deliveries d where d.id = delivery_id
                 and (my_role() = 'owner' or d.branch_id = my_branch())))
  with check (exists (select 1 from deliveries d where d.id = delivery_id
                 and (my_role() = 'owner' or d.branch_id = my_branch())));
create policy transfers_branch on transfers for all to authenticated
  using (my_role() = 'owner' or from_branch_id = my_branch() or to_branch_id = my_branch())
  with check (my_role() = 'owner' or from_branch_id = my_branch() or to_branch_id = my_branch());
create policy transfer_items_branch on transfer_items for all to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id
                 and (my_role() = 'owner' or t.from_branch_id = my_branch() or t.to_branch_id = my_branch())))
  with check (exists (select 1 from transfers t where t.id = transfer_id
                 and (my_role() = 'owner' or t.from_branch_id = my_branch() or t.to_branch_id = my_branch())));
create policy sales_branch_read on sales for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy sales_branch_insert on sales for insert to authenticated
  with check (branch_id = my_branch() or my_role() = 'owner');
create policy sales_void on sales for update to authenticated
  using (my_role() in ('owner','manager') and (my_role() = 'owner' or branch_id = my_branch()))
  with check (status in ('completed','voided'));  -- soft void only, never delete
create policy sale_items_branch on sale_items for all to authenticated
  using (exists (select 1 from sales s where s.id = sale_id
                 and (my_role() = 'owner' or s.branch_id = my_branch())))
  with check (exists (select 1 from sales s where s.id = sale_id
                 and (my_role() = 'owner' or s.branch_id = my_branch())));
create policy orders_branch on online_orders for all to authenticated
  using (my_role() = 'owner' or branch_id = my_branch())
  with check (my_role() = 'owner' or branch_id = my_branch());
create policy attendance_read on attendance for select to authenticated
  using (my_role() = 'owner' or branch_id = my_branch());
create policy attendance_insert on attendance for insert to authenticated
  with check (branch_id = my_branch() or my_role() = 'owner');
create policy attendance_review on attendance for update to authenticated
  using (my_role() in ('owner','manager') and (my_role() = 'owner' or branch_id = my_branch()));
create policy audit_read on audit_log for select to authenticated
  using (my_role() in ('owner','manager'));
create policy audit_insert on audit_log for insert to authenticated with check (true);
create policy receipt_counters_rw on receipt_counters for all to authenticated
  using (true) with check (true);

-- Storage buckets (run in dashboard or via API): selfies, payment-proofs,
-- packed-photos — all private, accessed with signed URLs.

-- Realtime: enable for online_orders so all tablets stay in sync.
-- alter publication supabase_realtime add table online_orders;
