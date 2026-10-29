create table public.course_reminder_settings (
 cohort_id uuid primary key references cohorts(id) on delete cascade,
 enabled boolean not null default false,
 location_text text not null default '' check(length(location_text)<=1500),
 notes text not null default '' check(length(notes)<=1500),
 updated_at timestamptz not null default now(), actor text not null
);
create table public.course_reminder_deliveries (
 id uuid primary key default gen_random_uuid(),
 enrollment_id uuid not null references enrollments(id) on delete cascade,
 first_start timestamptz not null,
 days_before integer not null check(days_before in (1,3)),
 line_user_id text not null,
 status text not null check(status in ('sending','accepted','failed','unknown','skipped')),
 message text, error_code text, provider_request_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(enrollment_id,first_start,days_before)
);
create table public.course_reminder_runs (
 id uuid primary key default gen_random_uuid(),started_at timestamptz not null default now(),
 completed_at timestamptz,claimed integer not null default 0,accepted integer not null default 0,
 failed integer not null default 0,status text not null default 'running',error_code text
);
do $$ declare t text;begin foreach t in array array['course_reminder_settings','course_reminder_deliveries','course_reminder_runs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end $$;
create view public.course_reminder_candidates with (security_invoker=true) as
 select e.id as enrollment_id,e.cohort_id,e.status as enrollment_status,
 coalesce(nullif(e.contact_snapshot->>'name',''),s.full_name) as name,
 c.title as course_title,h.title as cohort_title,b.line_user_id,
 coalesce(b.verified_email=s.email,false) as binding_valid,
 coalesce(cfg.enabled,false) as enabled,coalesce(cfg.location_text,'') as location_text,
 coalesce(cfg.notes,'') as notes,dates.first_start,dates.sessions
 from enrollments e join students s on s.id=e.student_id
 join cohorts h on h.id=e.cohort_id join courses c on c.id=h.course_id
 left join course_line_bindings b on b.student_id=s.id
 left join course_reminder_settings cfg on cfg.cohort_id=h.id
 left join lateral (
 select min(x.starts_at) as first_start,jsonb_agg(jsonb_build_object('title',x.title,'starts_at',x.starts_at,'ends_at',x.ends_at) order by x.starts_at) as sessions
 from (
 select cs.title,cs.starts_at,cs.ends_at from enrollment_sessions es join course_sessions cs on cs.id=es.session_id
 where es.enrollment_id=e.id and es.status in ('confirmed','admin_assigned') and c.code='TEACHER-DIALOGUE'
 union all
 select ts.title,ts.starts_at,ts.ends_at from training_sessions ts where ts.cohort_id=e.cohort_id and c.code='TEACHER-TRAINING'
 ) x
 ) dates on true
 where c.code in ('TEACHER-DIALOGUE','TEACHER-TRAINING');
revoke all on course_reminder_candidates from public,anon,authenticated;
grant select on course_reminder_candidates to service_role;
create function public.claim_course_reminders() returns setof public.course_reminder_deliveries
 language plpgsql security definer set search_path=public as $$
begin
 update course_reminder_deliveries set status='unknown',error_code='WORKER_INTERRUPTED',updated_at=now()
 where status='sending' and created_at<now()-interval '10 minutes';
 return query
 insert into course_reminder_deliveries(enrollment_id,first_start,days_before,line_user_id,status)
 select c.enrollment_id,c.first_start,d.n,c.line_user_id,'sending'
 from course_reminder_candidates c cross join (values(3),(1)) d(n)
 where c.enabled and c.binding_valid and c.enrollment_status='paid' and c.first_start>now()
 and length(trim(c.location_text))>0
 and (c.first_start at time zone 'Asia/Taipei')::date=(now() at time zone 'Asia/Taipei')::date+d.n
 and (now() at time zone 'Asia/Taipei')::time>='10:00'::time and (now() at time zone 'Asia/Taipei')::time<'20:00'::time
 and not exists(select 1 from course_reminder_deliveries l where l.enrollment_id=c.enrollment_id and l.first_start=c.first_start and l.days_before=d.n)
 order by c.first_start,c.enrollment_id,d.n desc limit 10
 on conflict(enrollment_id,first_start,days_before) do nothing returning *;
end $$;
revoke all on function claim_course_reminders() from public,anon,authenticated;
grant execute on function claim_course_reminders() to service_role;
