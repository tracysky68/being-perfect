alter type public.enrollment_status add value if not exists 'partially_paid' after 'pending_payment';

create table public.eligibility_records (
  id uuid primary key default gen_random_uuid(),
  eligibility text not null,
  email text,
  phone text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (email is not null or phone is not null),
  check (email is null or email = lower(email))
);

create unique index eligibility_email_unique on public.eligibility_records(eligibility, email) where email is not null;
create unique index eligibility_phone_unique on public.eligibility_records(eligibility, phone) where phone is not null;
alter table public.eligibility_records enable row level security;

alter table public.payment_transactions
  add column merchant_order_number text,
  add column payment_installment_id uuid references public.payment_installments(id);

update public.payment_transactions pt
set merchant_order_number = e.order_number
from public.enrollments e
where e.id = pt.enrollment_id and pt.merchant_order_number is null;

alter table public.payment_transactions alter column merchant_order_number set not null;
drop index if exists public.payment_one_initial_transaction_per_enrollment;
create unique index payment_merchant_order_unique on public.payment_transactions(merchant_order_number);
create unique index payment_installment_provider_unique on public.payment_transactions(payment_installment_id, provider) where payment_installment_id is not null;

comment on table public.eligibility_records is 'Server-only eligibility list used to verify restricted prices such as parent workshop alumni.';
