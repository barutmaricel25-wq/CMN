-- The branches are listed in the shop's own order, not alphabetically and not
-- in whatever order Postgres happens to return. Run this in the SQL Editor.

alter table branches add column if not exists sort_order integer not null default 999;

-- The order CMN lists them in.
update branches set sort_order = 1 where name = 'Main Branch';
update branches set sort_order = 2 where name = 'Unit 20';
update branches set sort_order = 3 where name = 'Unit 17';
update branches set sort_order = 4 where name = 'Unit 16';
update branches set sort_order = 5 where name = 'Unit 10-11';
update branches set sort_order = 6 where name = 'Unit 04-18';
