-- Suki and wholesaler accounts belong to the branch that deals with them, so
-- each branch's customer list is its own. Run in the SQL Editor; safe to run
-- twice.

alter table customers add column if not exists branch_id text not null default '';

create index if not exists customers_branch_idx on customers (branch_id);

-- Everyone already on file was added at Unit 17, so that is where they go.
-- Found by name rather than by a fixed id, since the ids differ per install.
update customers
   set branch_id = coalesce(
         (select id from branches where lower(name) = 'unit 17' limit 1),
         (select id from branches order by sort_order, name limit 1)
       )
 where branch_id = '';
