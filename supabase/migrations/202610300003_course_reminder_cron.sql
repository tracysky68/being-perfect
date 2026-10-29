create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create function public.dispatch_course_reminders() returns bigint
language plpgsql security definer set search_path=public as $$
declare token text; request_id bigint;
begin
 -- The UTC cron ticks every five minutes; the send window is always evaluated in Taipei.
 if (now() at time zone 'Asia/Taipei')::time<'10:00'::time or (now() at time zone 'Asia/Taipei')::time>='20:00'::time then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='course_reminder_cron_secret';
 if token is null then raise exception 'Reminder scheduler secret is missing';end if;
 select net.http_post(
 url:='https://arsqrdesdvfpgsiduvzs.supabase.co/functions/v1/course-reminders',
 headers:=jsonb_build_object('Content-Type','application/json','x-reminder-secret',token),
 body:='{"run":true}'::jsonb,timeout_milliseconds:=120000
 ) into request_id;
 return request_id;
end $$;
revoke all on function dispatch_course_reminders() from public,anon,authenticated;
select cron.schedule('course-reminders-every-five-minutes','*/5 * * * *','select public.dispatch_course_reminders();');
