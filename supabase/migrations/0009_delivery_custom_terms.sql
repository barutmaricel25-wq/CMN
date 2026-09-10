-- Receiving a delivery on terms the app didn't offer.
--
--   · custom payment terms — a supplier who agrees to something that is not
--     30, 45 or 60 days, with the days kept on the delivery itself;
--   · a total agreed with the supplier that isn't the sum of the lines — a
--     discount, freight, or an invoice that simply says something else;
--   · the name written on the cheque, which is often not the company it is
--     being handed to.
--
-- Run in the SQL Editor; safe to run twice.

alter table deliveries  add column if not exists custom_days  integer not null default 0;
alter table deliveries  add column if not exists custom_total numeric;
alter table pdc_checks  add column if not exists check_name   text not null default '';
