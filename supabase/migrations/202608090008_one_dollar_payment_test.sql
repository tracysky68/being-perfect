insert into public.pricing_plans (
  course_id, code, title, total_amount_twd,
  installment_count, installment_amount_twd, eligibility, active
)
select id, 'SYSTEM-TEST-1', '系統串接測試', 1, 1, 1, 'public', true
from public.courses
where code = 'TEACHER-DIALOGUE'
on conflict (code) do update set
  title = excluded.title,
  total_amount_twd = excluded.total_amount_twd,
  installment_count = excluded.installment_count,
  installment_amount_twd = excluded.installment_amount_twd,
  eligibility = excluded.eligibility,
  active = true;
