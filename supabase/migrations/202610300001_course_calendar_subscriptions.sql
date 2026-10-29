-- A subscription belongs to a verified binding and disappears when that binding is removed.
create table public.course_calendar_subscriptions (
 student_id uuid primary key references public.course_line_bindings(student_id) on delete cascade,
 seed text not null,
 token_hash text not null unique,
 created_at timestamptz not null default now()
);
alter table public.course_calendar_subscriptions enable row level security;
revoke all on public.course_calendar_subscriptions from public,anon,authenticated;
grant all on public.course_calendar_subscriptions to service_role;
