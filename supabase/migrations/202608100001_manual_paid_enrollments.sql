alter table public.enrollments
  add column if not exists payment_source text not null default 'payuni'
    check (payment_source in ('payuni', 'manual')),
  add column if not exists admin_notes text;

