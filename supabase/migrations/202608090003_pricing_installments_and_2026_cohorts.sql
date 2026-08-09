create type public.installment_status as enum ('pending', 'paid', 'overdue', 'waived', 'cancelled');

create table public.pricing_plans (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  code text not null unique,
  title text not null,
  total_amount_twd integer not null check (total_amount_twd > 0),
  installment_count integer not null default 1 check (installment_count > 0),
  installment_amount_twd integer not null check (installment_amount_twd > 0),
  eligibility text not null default 'public',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (total_amount_twd = installment_count * installment_amount_twd)
);

alter table public.enrollments
  add column pricing_plan_id uuid references public.pricing_plans(id),
  add column payment_option text not null default 'full' check (payment_option in ('full', 'installments'));

create table public.payment_installments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  amount_twd integer not null check (amount_twd > 0),
  status public.installment_status not null default 'pending',
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, installment_number)
);

alter table public.course_sessions add column schedule_note text not null default '09:00–12:00｜13:00–16:00';

create index pricing_plans_course_active_idx on public.pricing_plans(course_id, active);
create index payment_installments_enrollment_status_idx on public.payment_installments(enrollment_id, status);
alter table public.pricing_plans enable row level security;
alter table public.payment_installments enable row level security;

insert into public.pricing_plans (course_id, code, title, total_amount_twd, installment_count, installment_amount_twd, eligibility)
select id, 'GENERAL-2026', '一般學員', 13800, 3, 4600, 'public' from public.courses where code = 'TEACHER-DIALOGUE';

insert into public.pricing_plans (course_id, code, title, total_amount_twd, installment_count, installment_amount_twd, eligibility)
select id, 'PARENT-ALUMNI-2026', '家長班舊生', 10800, 3, 3600, 'parent_workshop_alumni' from public.courses where code = 'TEACHER-DIALOGUE';

with course as (select id from public.courses where code = 'TEACHER-DIALOGUE')
insert into public.cohorts (course_id, title, starts_at, capacity, price_twd, active)
select id, '2026 年 9 月班', timestamptz '2026-09-20 09:00:00+08', 32, 13800, true from course
union all select id, '2026 年 10 月班', timestamptz '2026-10-18 09:00:00+08', 32, 13800, true from course
union all select id, '2026 年 11 月班', timestamptz '2026-11-22 09:00:00+08', 32, 13800, true from course;

with month_data as (
  select id, title from public.cohorts where title in ('2026 年 9 月班', '2026 年 10 月班', '2026 年 11 月班')
), session_data(cohort_title, module, schedule_type, title, starts_at, ends_at) as (
  values
    ('2026 年 9 月班', 'day_1'::public.session_module, 'weekend'::public.session_schedule, '第一天｜假日場', timestamptz '2026-09-20 09:00:00+08', timestamptz '2026-09-20 16:00:00+08'),
    ('2026 年 9 月班', 'day_1'::public.session_module, 'weekday'::public.session_schedule, '第一天｜平日場', timestamptz '2026-09-21 09:00:00+08', timestamptz '2026-09-21 16:00:00+08'),
    ('2026 年 9 月班', 'day_2'::public.session_module, 'weekend'::public.session_schedule, '第二天｜假日場', timestamptz '2026-09-27 09:00:00+08', timestamptz '2026-09-27 16:00:00+08'),
    ('2026 年 9 月班', 'day_2'::public.session_module, 'weekday'::public.session_schedule, '第二天｜平日場', timestamptz '2026-09-28 09:00:00+08', timestamptz '2026-09-28 16:00:00+08'),
    ('2026 年 10 月班', 'day_1'::public.session_module, 'weekend'::public.session_schedule, '第一天｜假日場', timestamptz '2026-10-18 09:00:00+08', timestamptz '2026-10-18 16:00:00+08'),
    ('2026 年 10 月班', 'day_1'::public.session_module, 'weekday'::public.session_schedule, '第一天｜平日場', timestamptz '2026-10-21 09:00:00+08', timestamptz '2026-10-21 16:00:00+08'),
    ('2026 年 10 月班', 'day_2'::public.session_module, 'weekend'::public.session_schedule, '第二天｜假日場', timestamptz '2026-10-25 09:00:00+08', timestamptz '2026-10-25 16:00:00+08'),
    ('2026 年 10 月班', 'day_2'::public.session_module, 'weekday'::public.session_schedule, '第二天｜平日場', timestamptz '2026-10-28 09:00:00+08', timestamptz '2026-10-28 16:00:00+08'),
    ('2026 年 11 月班', 'day_1'::public.session_module, 'weekend'::public.session_schedule, '第一天｜假日場', timestamptz '2026-11-22 09:00:00+08', timestamptz '2026-11-22 16:00:00+08'),
    ('2026 年 11 月班', 'day_1'::public.session_module, 'weekday'::public.session_schedule, '第一天｜平日場', timestamptz '2026-11-23 09:00:00+08', timestamptz '2026-11-23 16:00:00+08'),
    ('2026 年 11 月班', 'day_2'::public.session_module, 'weekend'::public.session_schedule, '第二天｜假日場', timestamptz '2026-11-29 09:00:00+08', timestamptz '2026-11-29 16:00:00+08'),
    ('2026 年 11 月班', 'day_2'::public.session_module, 'weekday'::public.session_schedule, '第二天｜平日場', timestamptz '2026-11-30 09:00:00+08', timestamptz '2026-11-30 16:00:00+08')
)
insert into public.course_sessions (cohort_id, module, schedule_type, title, starts_at, ends_at, capacity)
select m.id, s.module, s.schedule_type, s.title, s.starts_at, s.ends_at, 16
from session_data s join month_data m on m.title = s.cohort_title;

comment on table public.pricing_plans is 'Public and eligibility-restricted total prices with equal interest-free installments.';
comment on table public.payment_installments is 'Three equal interest-free receivables belong to one enrollment, not three enrollments.';
