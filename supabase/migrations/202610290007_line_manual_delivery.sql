-- Admin-only manual sends. One operation per enrollment/template prevents double clicks.
create table public.line_intake_deliveries (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
 channel_basic_id text not null,
 line_user_id text,
 display_name text,
 message_hash text,
 status text not null check(status in ('sending','accepted','failed','unknown','external_scheduled')),
 actor text not null,
 provider_request_id text,
 error_code text,
 note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.line_intake_deliveries enable row level security;
revoke all on public.line_intake_deliveries from anon,authenticated;
grant all on public.line_intake_deliveries to service_role;
