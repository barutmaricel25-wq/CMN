-- Faster syncing: let a device ask "what changed since I last looked?" instead
-- of downloading every row every time.
--
-- Two pieces are needed for that. Every row gets an updated_at that the
-- database maintains itself, and deletions get written to their own small table
-- — a row that has gone can't be noticed by asking for recent changes.
--
-- Run in the SQL Editor. Safe to run more than once.

-- ============ updated_at on every table ============
create or replace function cmn_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'branches','users','products','customers','inventory','stock_movements',
    'deliveries','delivery_items','transfers','transfer_items','sales','sale_items',
    'online_orders','attendance','expenses','pdc_checks','payroll','audit_log','app_state'
  ] loop
    execute format('alter table %I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('create index if not exists %I on %I (updated_at)', t || '_updated_at_idx', t);
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format(
      'create trigger %I before insert or update on %I for each row execute function cmn_touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;

-- ============ deletions ============
-- What was removed, and when, so other devices can drop it too.
create table if not exists deletions (
  table_name text not null,
  row_id     text not null,
  deleted_at timestamptz not null default now(),
  primary key (table_name, row_id)
);
create index if not exists deletions_deleted_at_idx on deletions (deleted_at);

alter table deletions enable row level security;
drop policy if exists cmn_app_access on deletions;
create policy cmn_app_access on deletions for all to anon, authenticated using (true) with check (true);

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table deletions';
  exception when duplicate_object then null;
  end;
end $$;

-- ============ Tidy up ============
-- Stock rows sitting at zero say nothing the app doesn't already assume, and
-- there are tens of thousands of them. Clearing them shortens a first load.
delete from inventory where qty = 0;
