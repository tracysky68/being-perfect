insert into public.cohorts (course_id, title, capacity, price_twd, active)
select id, '待學員選擇月份', null, 13800, false
from public.courses where code = 'TEACHER-DIALOGUE'
and not exists (select 1 from public.cohorts where title = '待學員選擇月份');

create or replace function public.submit_teacher_intake(
  access_token text,
  selected_cohort_id uuid,
  day_1_session_id uuid,
  day_2_session_id uuid,
  intake jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  selected_enrollment public.enrollments%rowtype;
  chosen_cohort public.cohorts%rowtype;
  selected_session public.course_sessions%rowtype;
  selected_session_id uuid;
  expected_module public.session_module;
  occupied integer;
begin
  select e.* into selected_enrollment from public.enrollment_portal_tokens t join public.enrollments e on e.id=t.enrollment_id where t.token=access_token and t.active=true;
  if not found then raise exception 'INVALID_TOKEN'; end if;
  if selected_enrollment.status not in ('paid','partially_paid') then raise exception 'PAYMENT_REQUIRED'; end if;

  if exists (select 1 from public.cohorts where id=selected_enrollment.cohort_id and title='待學員選擇月份') then
    select * into chosen_cohort from public.cohorts where id=selected_cohort_id and active=true and course_id=(select course_id from public.cohorts where id=selected_enrollment.cohort_id);
    if not found then raise exception 'INVALID_COHORT'; end if;
    update public.enrollments set cohort_id=chosen_cohort.id,updated_at=now() where id=selected_enrollment.id;
    selected_enrollment.cohort_id:=chosen_cohort.id;
  elsif selected_cohort_id is not null and selected_cohort_id<>selected_enrollment.cohort_id then
    raise exception 'INVALID_COHORT';
  end if;

  foreach selected_session_id in array array[day_1_session_id,day_2_session_id] loop
    expected_module:=case when selected_session_id=day_1_session_id then 'day_1'::public.session_module else 'day_2'::public.session_module end;
    select * into selected_session from public.course_sessions where id=selected_session_id for update;
    if not found or not selected_session.active or selected_session.cohort_id<>selected_enrollment.cohort_id or selected_session.module<>expected_module then raise exception 'INVALID_SESSION'; end if;
    select count(*) into occupied from public.enrollment_sessions where session_id=selected_session.id and status in ('confirmed','admin_assigned') and enrollment_id<>selected_enrollment.id;
    if occupied>=selected_session.capacity then raise exception 'SESSION_FULL'; end if;
  end loop;

  insert into public.enrollment_sessions(enrollment_id,session_id,module) values(selected_enrollment.id,day_1_session_id,'day_1'),(selected_enrollment.id,day_2_session_id,'day_2') on conflict(enrollment_id,module) do update set session_id=excluded.session_id,status='confirmed',selected_at=now(),updated_at=now();
  insert into public.teacher_intake_responses(enrollment_id,role_title,organization,teaching_years,student_age_groups,art_background,education_background,main_challenges,focus_questions,learning_expectations,case_description,artwork_permission,additional_notes)
  values(selected_enrollment.id,trim(coalesce(intake->>'currentRole','')),nullif(trim(coalesce(intake->>'organization','')),''),trim(coalesce(intake->>'teachingYears','')),coalesce(array(select jsonb_array_elements_text(coalesce(intake->'studentAgeGroups','[]'::jsonb))),'{}'),trim(coalesce(intake->>'artBackground','')),trim(coalesce(intake->>'educationBackground','')),coalesce(array(select jsonb_array_elements_text(coalesce(intake->'mainChallenges','[]'::jsonb))),'{}'),trim(coalesce(intake->>'focusQuestions','')),trim(coalesce(intake->>'learningExpectations','')),nullif(trim(coalesce(intake->>'caseDescription','')),''),coalesce((intake->>'artworkPermission')::boolean,false),nullif(trim(coalesce(intake->>'additionalNotes','')),''))
  on conflict(enrollment_id) do update set role_title=excluded.role_title,organization=excluded.organization,teaching_years=excluded.teaching_years,student_age_groups=excluded.student_age_groups,art_background=excluded.art_background,education_background=excluded.education_background,main_challenges=excluded.main_challenges,focus_questions=excluded.focus_questions,learning_expectations=excluded.learning_expectations,case_description=excluded.case_description,artwork_permission=excluded.artwork_permission,additional_notes=excluded.additional_notes,submitted_at=now(),updated_at=now();
  update public.enrollment_portal_tokens set last_used_at=now() where token=access_token;
end; $$;

revoke all on function public.submit_teacher_intake(text,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_teacher_intake(text,uuid,uuid,uuid,jsonb) to service_role;

