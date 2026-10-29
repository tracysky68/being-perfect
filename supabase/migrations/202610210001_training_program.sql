-- Additive: teacher dialogue sessions and intake remain unchanged.
insert into public.courses(code,title,description,active)
values ('TEACHER-TRAINING','師資培訓班','完整一期的師資培訓課程',false)
on conflict(code) do nothing;

create table public.training_cohort_settings (
  cohort_id uuid primary key references public.cohorts(id) on delete cascade,
  pricing_plan_id uuid not null unique references public.pricing_plans(id),
  description text not null default '',
  updated_at timestamptz not null default now()
);
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.training_cohort_settings(cohort_id) on delete cascade,
  title text not null check(length(trim(title))>0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>starts_at)
);
create index training_sessions_cohort_idx on public.training_sessions(cohort_id,starts_at);
create table public.training_intake_responses (
  enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
  role_title text not null,
  organization text not null default '',
  teaching_experience text not null,
  motivation text not null,
  intended_use text not null,
  learning_expectations text not null,
  additional_notes text not null default '',
  submitted_at timestamptz not null default now()
);
alter table public.training_cohort_settings enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_intake_responses enable row level security;
grant all on public.training_cohort_settings,public.training_sessions,public.training_intake_responses to service_role;

-- An administrator can edit an unused cohort, or create a new one. Prices and
-- timetables of cohorts with any registrations are kept stable.
create function public.save_training_setup(settings jsonb, actor_email text)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  course_id_value uuid; cohort_id_value uuid; plan_id_value uuid;
  total integer; parts integer; publish boolean; item jsonb;
begin
  select id into course_id_value from courses where code='TEACHER-TRAINING' for update;
  total := (settings->>'amountTwd')::integer;
  parts := (settings->>'installmentCount')::integer;
  publish := coalesce((settings->>'active')::boolean,false);
  if total is null or total<1 or parts is null or parts<1 or parts>24 or total%parts<>0
    or length(trim(coalesce(settings->>'title','')))=0
    or length(coalesce(settings->>'title',''))>120
    or jsonb_typeof(settings->'sessions') is distinct from 'array'
    or jsonb_array_length(settings->'sessions')>100 then raise exception 'INVALID_SETTINGS'; end if;
  if publish and jsonb_array_length(settings->'sessions')=0 then raise exception 'SCHEDULE_REQUIRED'; end if;
  cohort_id_value := nullif(settings->>'cohortId','')::uuid;
  if cohort_id_value is not null then
    perform 1 from cohorts where id=cohort_id_value and course_id=course_id_value for update;
    if not found then raise exception 'INVALID_COHORT'; end if;
    if exists(select 1 from enrollments where cohort_id=cohort_id_value) then raise exception 'COHORT_HAS_ENROLLMENTS'; end if;
    select pricing_plan_id into plan_id_value from training_cohort_settings where cohort_id=cohort_id_value;
    if plan_id_value is null then raise exception 'INVALID_COHORT'; end if;
    update cohorts set title=trim(settings->>'title'),price_twd=total,active=publish where id=cohort_id_value;
    update pricing_plans set total_amount_twd=total,installment_count=parts,installment_amount_twd=total/parts,active=publish where id=plan_id_value;
    update training_cohort_settings set description=left(coalesce(settings->>'description',''),5000),updated_at=now() where cohort_id=cohort_id_value;
    delete from training_sessions where cohort_id=cohort_id_value;
  else
    insert into pricing_plans(course_id,code,title,total_amount_twd,installment_count,installment_amount_twd,active)
    values(course_id_value,'TRAINING-'||gen_random_uuid(),'師資培訓班課程費用',total,parts,total/parts,publish) returning id into plan_id_value;
    insert into cohorts(course_id,title,price_twd,active) values(course_id_value,trim(settings->>'title'),total,publish) returning id into cohort_id_value;
    insert into training_cohort_settings(cohort_id,pricing_plan_id,description) values(cohort_id_value,plan_id_value,left(coalesce(settings->>'description',''),5000));
  end if;
  for item in select value from jsonb_array_elements(settings->'sessions') loop
    insert into training_sessions(cohort_id,title,starts_at,ends_at)
    values(cohort_id_value,left(trim(item->>'title'),120),(item->>'startsAt')::timestamptz,(item->>'endsAt')::timestamptz);
  end loop;
  update cohorts set starts_at=(select min(starts_at) from training_sessions where cohort_id=cohort_id_value) where id=cohort_id_value;
  update courses set active=exists(select 1 from cohorts where course_id=course_id_value and active) where id=course_id_value;
  insert into audit_logs(entity_type,entity_id,action,actor,details) values('cohort',cohort_id_value,'training_setup_saved',actor_email,jsonb_build_object('active',publish));
  return cohort_id_value;
end; $$;
revoke all on function public.save_training_setup(jsonb,text) from public,anon,authenticated;
grant execute on function public.save_training_setup(jsonb,text) to service_role;

create function public.submit_training_intake(access_token text, intake jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare target public.enrollments;
begin
  select e.* into target from enrollments e join enrollment_portal_tokens p on p.enrollment_id=e.id
  join cohorts c on c.id=e.cohort_id join courses co on co.id=c.course_id
  where p.token=access_token and p.active and co.code='TEACHER-TRAINING' for update of e;
  if not found then raise exception 'INVALID_TOKEN'; end if;
  if target.status not in ('paid','partially_paid') then raise exception 'PAYMENT_REQUIRED'; end if;
  if exists(select 1 from unnest(array['currentRole','teachingExperience','motivation','intendedUse','learningExpectations']) k
    where length(trim(coalesce(intake->>k,'')))=0 or length(intake->>k)>2000) then raise exception 'INVALID_INTAKE'; end if;
  insert into training_intake_responses(enrollment_id,role_title,organization,teaching_experience,motivation,intended_use,learning_expectations,additional_notes)
  values(target.id,trim(intake->>'currentRole'),left(coalesce(intake->>'organization',''),120),trim(intake->>'teachingExperience'),trim(intake->>'motivation'),trim(intake->>'intendedUse'),trim(intake->>'learningExpectations'),left(coalesce(intake->>'additionalNotes',''),2000))
  on conflict(enrollment_id) do update set role_title=excluded.role_title,organization=excluded.organization,teaching_experience=excluded.teaching_experience,motivation=excluded.motivation,intended_use=excluded.intended_use,learning_expectations=excluded.learning_expectations,additional_notes=excluded.additional_notes,submitted_at=now();
  update enrollment_portal_tokens set last_used_at=now() where token=access_token;
end; $$;
revoke all on function public.submit_training_intake(text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_training_intake(text,jsonb) to service_role;

-- Keep each signup's contact details without letting a public registration
-- overwrite the profile used by the student's earlier courses.
alter table public.enrollments add column contact_snapshot jsonb;
create function public.create_training_checkout(details jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  c public.cohorts; p public.pricing_plans; student_id_value uuid;
  enrollment_id_value uuid; installment_id_value uuid; first_installment uuid;
  order_value text; amount_value integer; parts integer; i integer;
  email_value text := lower(trim(details->>'email'));
  option_value text := details->>'paymentOption';
begin
  -- Same course/cohort lock order as setup editing.
  perform 1 from courses where code='TEACHER-TRAINING' and active for share;
  if not found then raise exception 'COURSE_UNAVAILABLE'; end if;
  select co.* into c from cohorts co join courses cr on cr.id=co.course_id
    where co.id=(details->>'cohortId')::uuid and co.active and cr.code='TEACHER-TRAINING' for share of co;
  if not found then raise exception 'COURSE_UNAVAILABLE'; end if;
  select pp.* into p from training_cohort_settings t join pricing_plans pp on pp.id=t.pricing_plan_id
    where t.cohort_id=c.id and pp.course_id=c.course_id and pp.code=details->>'pricingCode' and pp.active and pp.eligibility='public' for share of pp;
  if not found or not exists(select 1 from training_sessions where cohort_id=c.id) then raise exception 'PLAN_UNAVAILABLE'; end if;
  if option_value is null or option_value not in ('full','installments') or (option_value='installments' and p.installment_count<2)
    or coalesce(details->>'privacyConsent','')<>'on' or coalesce(details->>'termsConsent','')<>'on'
    or length(trim(coalesce(details->>'name','')))=0 or length(details->>'name')>80
    or coalesce(email_value,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or coalesce(details->>'phone','') !~ '^\+?[0-9]{8,15}$' then raise exception 'INVALID_CHECKOUT'; end if;
  insert into students(email,full_name,phone) values(email_value,trim(details->>'name'),details->>'phone') on conflict(email) do nothing;
  select id into student_id_value from students where email=email_value;
  order_value := 'BP'||to_char(clock_timestamp(),'YYYYMMDDHH24MISS')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  insert into enrollments(order_number,student_id,cohort_id,amount_twd,pricing_plan_id,payment_option,privacy_consent_at,terms_consent_at,contact_snapshot)
  values(order_value,student_id_value,c.id,p.total_amount_twd,p.id,option_value,now(),now(),jsonb_build_object('name',trim(details->>'name'),'email',email_value,'phone',details->>'phone')) returning id into enrollment_id_value;
  insert into enrollment_portal_tokens(enrollment_id) values(enrollment_id_value);
  parts := case when option_value='installments' then p.installment_count else 1 end;
  amount_value := p.total_amount_twd/parts;
  for i in 1..parts loop
    insert into payment_installments(enrollment_id,installment_number,amount_twd) values(enrollment_id_value,i,amount_value) returning id into installment_id_value;
    if i=1 then first_installment:=installment_id_value; end if;
  end loop;
  insert into payment_transactions(enrollment_id,payment_installment_id,merchant_order_number,amount_twd)
  values(enrollment_id_value,first_installment,order_value,amount_value);
  return jsonb_build_object('orderNumber',order_value,'chargeAmount',amount_value);
end; $$;
revoke all on function public.create_training_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.create_training_checkout(jsonb) to service_role;

-- Close/reopen registration without changing an enrolled cohort's price/timetable.
create function public.set_training_registration(target_cohort uuid, accepting boolean, actor_email text)
returns void language plpgsql security definer set search_path=public as $$
declare course_id_value uuid; plan_id_value uuid;
begin
  if accepting is null then raise exception 'INVALID_SETTINGS'; end if;
  select id into course_id_value from courses where code='TEACHER-TRAINING' for update;
  perform 1 from cohorts where id=target_cohort and course_id=course_id_value for update;
  if not found then raise exception 'INVALID_COHORT'; end if;
  select pricing_plan_id into plan_id_value from training_cohort_settings where cohort_id=target_cohort;
  if plan_id_value is null then raise exception 'INVALID_COHORT'; end if;
  if accepting and not exists(select 1 from training_sessions where cohort_id=target_cohort) then raise exception 'SCHEDULE_REQUIRED'; end if;
  update cohorts set active=accepting where id=target_cohort;
  update pricing_plans set active=accepting where id=plan_id_value;
  update courses set active=exists(select 1 from cohorts where course_id=course_id_value and active) where id=course_id_value;
  insert into audit_logs(entity_type,entity_id,action,actor,details) values('cohort',target_cohort,'training_registration_changed',actor_email,jsonb_build_object('active',accepting));
end; $$;
revoke all on function public.set_training_registration(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_training_registration(uuid,boolean,text) to service_role;
