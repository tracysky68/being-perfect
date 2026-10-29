begin;
insert into course_line_bindings(student_id) values('aaaaaaaa-1111-1111-1111-111111111111');
insert into course_calendar_subscriptions(student_id,seed,token_hash) values('aaaaaaaa-1111-1111-1111-111111111111','test','hash');
do $$ begin
 if has_table_privilege('anon','course_calendar_subscriptions','SELECT') or has_table_privilege('authenticated','course_calendar_subscriptions','SELECT') then raise exception 'Public access to subscription secrets'; end if;
 if not (select relrowsecurity from pg_class where oid='course_calendar_subscriptions'::regclass) then raise exception 'RLS missing'; end if;
 if not has_table_privilege('service_role','course_calendar_subscriptions','SELECT,INSERT,DELETE') then raise exception 'Backend permissions missing'; end if;
end $$;
delete from course_line_bindings where student_id='aaaaaaaa-1111-1111-1111-111111111111';
do $$ begin if exists(select 1 from course_calendar_subscriptions) then raise exception 'Unlink did not revoke subscription'; end if;end $$;
rollback;
