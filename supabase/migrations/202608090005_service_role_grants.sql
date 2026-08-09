grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.students,
  public.courses,
  public.cohorts,
  public.enrollments,
  public.payment_transactions,
  public.audit_logs,
  public.course_sessions,
  public.enrollment_sessions,
  public.pricing_plans,
  public.payment_installments,
  public.eligibility_records
to service_role;

grant usage, select on all sequences in schema public to service_role;

comment on schema public is
  'RLS remains enabled. Only Edge Functions using the server-side service role receive direct table privileges.';
