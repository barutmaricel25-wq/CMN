-- Selling loose by the kilo out of an opened sack.
--
-- Two things follow from it. A sale line has to be able to say "2.5 kg" rather
-- than "2.5 sacks", and the shelf has to come down by the fraction of a sack
-- that came out of it — so the quantity columns can no longer be whole numbers.
--
-- Run in the SQL Editor; safe to run twice.

alter table sale_items add column if not exists by_kilo boolean not null default false;
-- What came off the shelf, in packs. Null means "the same as qty", which is
-- every ordinary sale.
alter table sale_items add column if not exists stock_qty numeric;

-- Whole numbers cannot hold 0.125 of a sack. numeric keeps the existing counts
-- exactly as they are — nothing is rounded by this change.
alter table inventory        alter column qty type numeric;
alter table stock_movements  alter column qty type numeric;
alter table sale_items       alter column qty type numeric;
