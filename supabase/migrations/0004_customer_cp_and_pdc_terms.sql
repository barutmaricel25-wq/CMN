-- Customers gain a mobile number and, for those paying by post-dated cheque,
-- the term their cheques run for. Run in the SQL Editor; safe to run twice.

alter table customers add column if not exists cp_number text not null default '';
alter table customers add column if not exists pdc_terms text not null default 'none';

-- Wholesalers on cheque with no term recorded default to 30 days.
update customers
   set pdc_terms = 'pdc30'
 where type = 'wholesaler' and payment_terms = 'pdc' and pdc_terms = 'none';
