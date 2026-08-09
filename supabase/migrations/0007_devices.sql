-- The list of phones and computers that have been let in with the shop
-- password, so the owner can see them all and cut one off without changing the
-- password for everybody.
--
-- Run in the SQL Editor; safe to run twice.

create table if not exists devices (
  id           text primary key,
  name         text not null default '',
  detected     text not null default '',
  branch_id    text not null default '',
  last_user_id text not null default '',
  first_seen   text not null default '',
  last_seen    text not null default '',
  -- Access taken away. The row stays, because the device only finds out it is
  -- out the next time it reaches this database.
  revoked      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create index if not exists devices_updated_at_idx on devices (updated_at);

alter table devices enable row level security;
drop policy if exists cmn_app_access on devices;
create policy cmn_app_access on devices for all to anon, authenticated using (true) with check (true);

-- Same as every other table: the database stamps updated_at, and the app asks
-- "what changed since" rather than reading everything.
drop trigger if exists devices_touch on devices;
create trigger devices_touch before insert or update on devices
  for each row execute function cmn_touch_updated_at();

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table devices';
  exception when duplicate_object then null;
  end;
end $$;
