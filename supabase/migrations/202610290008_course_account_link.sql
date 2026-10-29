create table public.course_line_bindings (
 line_user_id text primary key, student_id uuid not null unique references students(id) on delete cascade,
 verified_email text not null, linked_at timestamptz not null default now()
);
create table public.course_link_entries (
 token_hash text primary key, line_user_id text not null, link_token text not null,
 expires_at timestamptz not null, created_at timestamptz not null default now(),
 student_id uuid references students(id) on delete cascade, verified_email text,
 otp_hash text, otp_expires_at timestamptz, attempts int not null default 0,
 send_count int not null default 0, sent_at timestamptz,
 nonce_hash text unique, status text not null default 'issued'
);
create table public.course_portal_sessions (
 token_hash text primary key,line_user_id text not null,expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table public.course_line_events (event_id text primary key,created_at timestamptz not null default now());
create index course_link_user_time on course_link_entries(line_user_id,created_at);
create index course_link_email_time on course_link_entries(verified_email,sent_at);
create function public.course_request_otp(entry_hash text,email_value text,code_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e course_link_entries; sid uuid;
begin
 select * into e from course_link_entries where token_hash=entry_hash for update;
 if not found or e.expires_at<=now() or e.status<>'issued' then return '{"error":"LINK_EXPIRED"}'; end if;
 perform pg_advisory_xact_lock(hashtextextended(e.line_user_id,14));
 perform pg_advisory_xact_lock(hashtextextended(email_value,15));
 if e.sent_at>now()-interval '60 seconds' or e.send_count>=3 or (select coalesce(sum(send_count),0) from course_link_entries where line_user_id=e.line_user_id and created_at>now()-interval '1 hour')>=5 or (select count(*) from course_link_entries where verified_email=email_value and sent_at>now()-interval '1 hour')>=5 then return '{"error":"RATE_LIMIT"}'; end if;
 select id into sid from students where email=email_value;
 update course_link_entries set student_id=sid,verified_email=email_value,otp_hash=code_hash,otp_expires_at=least(expires_at,now()+interval '5 minutes'),attempts=0,send_count=send_count+1,sent_at=now() where token_hash=entry_hash;
 return jsonb_build_object('known',sid is not null);
end $$;
create function public.course_verify_otp(entry_hash text,code_hash text,nonce_digest text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e course_link_entries;
begin
 select * into e from course_link_entries where token_hash=entry_hash for update;
 if not found or e.status<>'issued' or e.expires_at<=now() or e.otp_expires_at is null or e.otp_expires_at<=now() or e.attempts>=5 then return '{"error":"CODE_INVALID"}'; end if;
 update course_link_entries set attempts=attempts+1 where token_hash=entry_hash;
 if e.otp_hash is distinct from code_hash or e.student_id is null or not exists(select 1 from students where id=e.student_id and email=e.verified_email) then return '{"error":"CODE_INVALID"}'; end if;
 update course_link_entries set status='pending_line',nonce_hash=nonce_digest,otp_hash=null where token_hash=entry_hash;
 return jsonb_build_object('linkToken',e.link_token);
end $$;
create function public.course_finish_link(nonce_digest text,line_uid text,link_ok boolean) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e course_link_entries;
begin
 select * into e from course_link_entries where nonce_hash=nonce_digest for update;
 if not found then return '{"error":"INVALID_LINK"}'; end if;
 if e.status='linked' and e.line_user_id=line_uid and link_ok then return '{"linked":true}'; end if;
 if e.status<>'pending_line' or e.expires_at<=now() then return '{"error":"LINK_EXPIRED"}'; end if;
 if not link_ok or e.line_user_id is distinct from line_uid then update course_link_entries set status='failed' where token_hash=e.token_hash;return '{"error":"LINE_MISMATCH"}'; end if;
 if not exists(select 1 from students where id=e.student_id and email=e.verified_email) then return '{"error":"EMAIL_CHANGED"}'; end if;
 begin
 insert into course_line_bindings(line_user_id,student_id,verified_email) values(e.line_user_id,e.student_id,e.verified_email);
 exception when unique_violation then
 if not exists(select 1 from course_line_bindings where line_user_id=e.line_user_id and student_id=e.student_id and verified_email=e.verified_email) then return '{"error":"BINDING_CONFLICT"}'; end if;
 end;
 update course_link_entries set status='linked',link_token='' where token_hash=e.token_hash;
 return '{"linked":true}';
end $$;
create function public.course_unlink(line_uid text) returns void language plpgsql security definer set search_path=public as $$
begin
 delete from course_line_bindings where line_user_id=line_uid;
 delete from course_portal_sessions where line_user_id=line_uid;
 update course_link_entries set status='revoked',otp_hash=null,link_token='' where line_user_id=line_uid;
end $$;
do $$ declare t text; begin
 foreach t in array array['course_line_bindings','course_link_entries','course_portal_sessions','course_line_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function course_request_otp(text,text,text),course_verify_otp(text,text,text),course_finish_link(text,text,boolean),course_unlink(text) from public,anon,authenticated;
grant execute on function course_request_otp(text,text,text),course_verify_otp(text,text,text),course_finish_link(text,text,boolean),course_unlink(text) to service_role;
