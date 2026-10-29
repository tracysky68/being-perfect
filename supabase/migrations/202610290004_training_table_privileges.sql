-- Production default privileges include TRUNCATE, which RLS does not protect.
-- These service-only tables must never inherit public API privileges.
revoke all on public.training_cohort_settings,public.training_sessions,public.training_intake_responses,public.training_payment_links,public.payuni_uop_sources,public.payuni_uop_receipts from anon,authenticated;
grant all on public.training_cohort_settings,public.training_sessions,public.training_intake_responses,public.training_payment_links,public.payuni_uop_sources,public.payuni_uop_receipts to service_role;
