create table public.training_payment_links (
 cohort_id uuid not null references public.training_cohort_settings(cohort_id) on delete cascade,
 channel text not null check(channel in ('payuni_hosted','payuni_credit_installments','cardless_installments')),
 payment_url text not null check(payment_url ~ '^https://([a-zA-Z0-9-]+\.)*payuni\.com\.tw/[^[:space:]]*$'),
 amount_twd integer not null check(amount_twd>0),
 active boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(cohort_id,channel)
);
alter table public.training_payment_links enable row level security;
grant all on public.training_payment_links to service_role;
comment on table public.training_payment_links is 'Admin-confirmed external PAYUNi hosted payment links. Navigation is not proof of payment or enrollment.';

-- Link supplied by owner; page verified read-only on 2026-10-29: creative training,
-- NT$39,800, credit (full/3/6 installments) and ATM. No payment was submitted.
insert into public.training_payment_links(cohort_id,channel,payment_url,amount_twd,active)
select s.cohort_id,'payuni_hosted','https://api.payuni.com.tw/api/uop/receive_info/2/1/CCAT834065530001/N3nTlHVQGl3QY4CxQ7ftS',39800,true
from public.training_cohort_settings s join public.cohorts c on c.id=s.cohort_id
where s.payment_methods is not null and c.title='創感力師資培訓｜2026 年 12 月 20～22 日' and c.price_twd=39800
on conflict(cohort_id,channel) do nothing;
