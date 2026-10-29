-- Isolated hosted-payment imports; do not open the old checkout.
alter table public.enrollments drop constraint enrollments_payment_source_check;
alter table public.enrollments add constraint enrollments_payment_source_check check(payment_source in ('payuni','manual','payuni_uop'));
-- Hosted form consent is not evidence of acceptance of our local registration form.
alter table public.enrollments alter column privacy_consent_at drop not null;
alter table public.enrollments alter column terms_consent_at drop not null;
alter table public.enrollments add constraint local_enrollment_consent check(payment_source='payuni_uop' or (privacy_consent_at is not null and terms_consent_at is not null));
create table public.payuni_uop_sources (
 merchant_id text not null, link_name text not null, cohort_id uuid not null references public.training_cohort_settings(cohort_id),
 amount_twd integer not null check(amount_twd=39800), active boolean not null default false,
 primary key(merchant_id,link_name)
);
create table public.payuni_uop_receipts (
 merchant_id text not null, trade_no text not null, order_no text not null, link_name text not null,
 amount_twd integer not null, enrollment_id uuid references public.enrollments(id), received_at timestamptz not null default now(),
 primary key(merchant_id,trade_no), unique(merchant_id,order_no)
);
alter table public.payuni_uop_sources enable row level security;
alter table public.payuni_uop_receipts enable row level security;
grant all on public.payuni_uop_sources,public.payuni_uop_receipts to service_role;
create or replace function public.guard_training_payment_setup() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='cohorts' then
  if new.active and exists(select 1 from public.training_cohort_settings where cohort_id=new.id and payment_methods is not null) then raise exception 'PAYMENT_SETUP_REQUIRED'; end if;
 elsif new.payment_source not in ('manual','payuni_uop') and exists(select 1 from public.training_cohort_settings where cohort_id=new.cohort_id and payment_methods is not null) then raise exception 'PAYMENT_SETUP_REQUIRED';
 elsif new.payment_source='payuni_uop' and not exists(select 1 from public.payuni_uop_sources where cohort_id=new.cohort_id and active and amount_twd=new.amount_twd) then raise exception 'UOP_SOURCE_REQUIRED';
 end if; return new;
end $$;
create function public.import_payuni_uop_paid(payment jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare source_row public.payuni_uop_sources; receipt public.payuni_uop_receipts; student_value uuid; enrollment_value uuid; installment_value uuid; plan_value uuid;
begin
 if payment->>'tradeStatus' is distinct from '1' then raise exception 'PAYMENT_NOT_COMPLETE'; end if;
 select * into source_row from public.payuni_uop_sources where merchant_id=payment->>'merchant' and link_name=payment->>'linkName' and active for share;
 if not found or (payment->>'amount')::integer is distinct from source_row.amount_twd then raise exception 'SOURCE_OR_AMOUNT_MISMATCH'; end if;
 if coalesce(payment->>'tradeNo','')='' or length(payment->>'tradeNo')>100 or coalesce(payment->>'orderNo','')='' or length(payment->>'orderNo')>100 then raise exception 'INVALID_TRANSACTION'; end if;
 if coalesce(trim(payment->>'name'),'')='' or length(payment->>'name')>120 or coalesce(payment->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(payment->>'email')>254 or coalesce(payment->>'phone','') !~ '^[+0-9() -]{8,30}$' then raise exception 'CONTACT_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended((payment->>'merchant')||':'||(payment->>'tradeNo'),0));
 select * into receipt from public.payuni_uop_receipts where merchant_id=payment->>'merchant' and trade_no=payment->>'tradeNo';
 if found then
  if receipt.order_no<>payment->>'orderNo' or receipt.link_name<>payment->>'linkName' or receipt.amount_twd<>(payment->>'amount')::integer then raise exception 'REPLAY_MISMATCH'; end if;
  return receipt.enrollment_id;
 end if;
 -- Reserve the provider order too: two trade identifiers cannot import one order twice.
 insert into public.payuni_uop_receipts(merchant_id,trade_no,order_no,link_name,amount_twd) values(payment->>'merchant',payment->>'tradeNo',payment->>'orderNo',payment->>'linkName',source_row.amount_twd);
 select pricing_plan_id into plan_value from public.training_cohort_settings where cohort_id=source_row.cohort_id;
 insert into public.students(email,full_name,phone) values(lower(payment->>'email'),payment->>'name',payment->>'phone') on conflict(email) do nothing;
 select id into student_value from public.students where email=lower(payment->>'email');
 insert into public.enrollments(order_number,student_id,cohort_id,status,amount_twd,payment_source,pricing_plan_id,paid_at,contact_snapshot,admin_notes)
 values('UOP-'||replace(gen_random_uuid()::text,'-',''),student_value,source_row.cohort_id,'paid',source_row.amount_twd,'payuni_uop',plan_value,now(),jsonb_build_object('name',payment->>'name','email',lower(payment->>'email'),'phone',payment->>'phone'),'PAYUNi 一頁收款驗證入帳；聯絡資料來自付款人，代付請由行政確認參訓者。') returning id into enrollment_value;
 insert into public.payment_installments(enrollment_id,installment_number,amount_twd,status,paid_at) values(enrollment_value,1,source_row.amount_twd,'paid',now()) returning id into installment_value;
 insert into public.payment_transactions(enrollment_id,provider,provider_trade_number,status,amount_twd,payment_method,hash_verified,notified_at,verified_at,payment_installment_id,merchant_order_number)
 values(enrollment_value,'payuni_uop',payment->>'tradeNo','verified',source_row.amount_twd,payment->>'paymentType',true,now(),now(),installment_value,'UOP-'||enrollment_value::text);
 insert into public.enrollment_portal_tokens(enrollment_id) values(enrollment_value);
 update public.payuni_uop_receipts set enrollment_id=enrollment_value where merchant_id=payment->>'merchant' and trade_no=payment->>'tradeNo';
 insert into public.audit_logs(entity_type,entity_id,action,details) values('enrollment',enrollment_value,'uop_payment_verified',jsonb_build_object('tradeNo',payment->>'tradeNo','cardInst',payment->>'cardInst','consentSource','external_payuni_not_attested'));
 return enrollment_value;
end $$;
revoke all on function public.import_payuni_uop_paid(jsonb) from public,anon,authenticated;
grant execute on function public.import_payuni_uop_paid(jsonb) to service_role;
