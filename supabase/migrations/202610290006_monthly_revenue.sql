-- Revenue is gross verified receipts, grouped by confirmation month in Taipei.
-- Aggregate in Postgres so historical totals are not limited by the 500-row roster.
create function public.teacher_monthly_revenue()
returns table(month text,course_code text,received bigint,transaction_count bigint,enrollment_count bigint,estimated_dates bigint)
language sql stable security definer set search_path=public as $$
 select to_char(coalesce(p.verified_at,p.notified_at,p.created_at) at time zone 'Asia/Taipei','YYYY-MM'),
 c.code,sum(p.amount_twd)::bigint,count(*)::bigint,count(distinct e.id)::bigint,
 count(*) filter(where p.verified_at is null)::bigint
 from payment_transactions p join enrollments e on e.id=p.enrollment_id
 join cohorts h on h.id=e.cohort_id join courses c on c.id=h.course_id
 where p.status='verified' and c.code in ('TEACHER-DIALOGUE','TEACHER-TRAINING')
 group by 1,2 order by 1 desc,2;
$$;
revoke all on function public.teacher_monthly_revenue() from public,anon,authenticated;
grant execute on function public.teacher_monthly_revenue() to service_role;
