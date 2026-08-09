create extension if not exists pgcrypto;

create type public.enrollment_status as enum ('pending_payment','paid','payment_failed','expired','cancelled','refunding','refunded');
create type public.payment_status as enum ('created','notified','verified','failed','refunded','needs_review');

create table public.students (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id),
  title text not null,
  starts_at timestamptz,
  capacity integer check (capacity is null or capacity > 0),
  price_twd integer not null check (price_twd > 0),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  student_id uuid not null references public.students(id),
  cohort_id uuid not null references public.cohorts(id),
  status public.enrollment_status not null default 'pending_payment',
  amount_twd integer not null check (amount_twd > 0),
  invoice_type text not null default 'personal' check (invoice_type in ('personal','company')),
  tax_id text,
  invoice_title text,
  privacy_consent_at timestamptz not null,
  terms_consent_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id),
  provider text not null default 'payuni',
  provider_trade_number text,
  status public.payment_status not null default 'created',
  amount_twd integer not null,
  payment_method text,
  raw_notification jsonb,
  hash_verified boolean not null default false,
  notified_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor text not null default 'system',
  details jsonb,
  created_at timestamptz not null default now()
);

create index enrollments_student_idx on public.enrollments(student_id);
create index enrollments_cohort_status_idx on public.enrollments(cohort_id, status);
create index payment_enrollment_idx on public.payment_transactions(enrollment_id);
create unique index payment_one_initial_transaction_per_enrollment on public.payment_transactions(enrollment_id, provider);

alter table public.students enable row level security;
alter table public.courses enable row level security;
alter table public.cohorts enable row level security;
alter table public.enrollments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.audit_logs enable row level security;

insert into public.courses (code, title, description)
values ('TEACHER-DIALOGUE', '看懂孩子，說對話｜教師專班', '玩美學教師線上互動專班');

comment on schema public is 'Public API access is denied by RLS; payment Edge Functions use the service role.';
