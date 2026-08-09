create type public.session_module as enum ('day_1', 'day_2');
create type public.session_schedule as enum ('weekday', 'weekend', 'makeup');
create type public.session_selection_status as enum ('confirmed', 'waitlisted', 'cancelled', 'admin_assigned');

create table public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  module public.session_module not null,
  schedule_type public.session_schedule not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (cohort_id, module, schedule_type)
);

create table public.enrollment_sessions (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  session_id uuid not null references public.course_sessions(id),
  module public.session_module not null,
  status public.session_selection_status not null default 'confirmed',
  selected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, module),
  unique (enrollment_id, session_id)
);

create index course_sessions_cohort_module_idx
  on public.course_sessions(cohort_id, module, active);

create index enrollment_sessions_session_status_idx
  on public.enrollment_sessions(session_id, status);

alter table public.course_sessions enable row level security;
alter table public.enrollment_sessions enable row level security;

comment on table public.course_sessions is
  'Actual class dates. Each monthly cohort normally has weekday/weekend choices for day 1 and day 2.';

comment on table public.enrollment_sessions is
  'One day_1 and one day_2 selection per enrollment; cross-month makeup is admin-assigned.';
