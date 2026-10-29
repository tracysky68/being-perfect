-- User-confirmed course details. The three payment channels await merchant setup.
alter table public.training_cohort_settings add column payment_methods jsonb;

update public.courses set title='創感力師資培訓',description='2026 年 12 月 20～22 日，每天 10:00～17:00，課程費用 NT$39,800。'
where code='TEACHER-TRAINING';

do $$
declare cohort_value uuid;
begin
  cohort_value:=public.save_training_setup('{
    "title":"創感力師資培訓｜2026 年 12 月 20～22 日",
    "description":"三天完整培訓，每天 10:00～17:00。課程費用 NT$39,800；付款方式為無卡分期、統一金流信用卡分期或匯款。",
    "amountTwd":39800,"installmentCount":1,"active":false,
    "sessions":[
      {"title":"第一天","startsAt":"2026-12-20T10:00:00+08:00","endsAt":"2026-12-20T17:00:00+08:00"},
      {"title":"第二天","startsAt":"2026-12-21T10:00:00+08:00","endsAt":"2026-12-21T17:00:00+08:00"},
      {"title":"第三天","startsAt":"2026-12-22T10:00:00+08:00","endsAt":"2026-12-22T17:00:00+08:00"}
    ]
  }','local-configuration');
  update public.training_cohort_settings set payment_methods='[
    {"code":"cardless_installments","label":"無卡分期","status":"pending","note":"申請業者、期數及申請方式確認後公布。"},
    {"code":"payuni_credit_installments","label":"統一金流信用卡分期","status":"pending","note":"可用期數與付款連結確認後公布。"},
    {"code":"bank_transfer","label":"匯款","status":"pending","note":"銀行與收款帳號確認後公布。"}
  ]'::jsonb where cohort_id=cohort_value;
end $$;

-- Do not let the old equal-installment checkout charge a deposit for a bank
-- credit-card installment purchase. Keep this cohort closed until the distinct
-- provider flows are implemented and verified in a subsequent migration.
create function public.guard_training_payment_setup() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_table_name='cohorts' then
    if new.active and exists(select 1 from public.training_cohort_settings where cohort_id=new.id and payment_methods is not null) then
      raise exception 'PAYMENT_SETUP_REQUIRED';
    end if;
  elsif new.payment_source<>'manual' and exists(select 1 from public.training_cohort_settings where cohort_id=new.cohort_id and payment_methods is not null) then
    raise exception 'PAYMENT_SETUP_REQUIRED';
  end if;
  return new;
end $$;
create trigger training_payment_publication_guard before update of active on public.cohorts
for each row execute function public.guard_training_payment_setup();
create trigger training_payment_checkout_guard before insert on public.enrollments
for each row execute function public.guard_training_payment_setup();
