-- Optional birth date; legacy questionnaires remain valid.
create or replace function public.submit_training_intake(access_token text,intake jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid; payment_state public.enrollment_status; spec jsonb; answer_value jsonb; k text; answer text; birth_date date; clean jsonb:='{}';
begin
 select e.id,e.status into target,payment_state from enrollments e join enrollment_portal_tokens t on t.enrollment_id=e.id join cohorts c on c.id=e.cohort_id join courses co on co.id=c.course_id
 where t.token=access_token and t.active and co.code='TEACHER-TRAINING' for update of e;
 if not found then raise exception 'INVALID_TOKEN'; end if;
 if payment_state not in ('paid','partially_paid') then raise exception 'PAYMENT_REQUIRED'; end if;
 if intake->>'version' is distinct from '2' or intake->'dataConsent' is distinct from 'true'::jsonb then raise exception 'INVALID_INTAKE'; end if;
 for spec in select value from jsonb_array_elements($schema$[{"key": "fullName", "label": "姓名", "type": "text", "required": true, "options": [], "max": 0, "maxLength": 120}, {"key": "preferredName", "label": "希望老師如何稱呼你？", "type": "text", "required": false, "options": [], "max": 0, "maxLength": 120}, {"key": "birthDate", "label": "出生年月日", "type": "date", "required": false, "options": [], "max": 0, "maxLength": 10}, {"key": "phone", "label": "手機號碼", "type": "tel", "required": true, "options": [], "max": 0, "maxLength": 120}, {"key": "email", "label": "Email", "type": "email", "required": true, "options": [], "max": 0, "maxLength": 254}, {"key": "lineName", "label": "LINE 顯示名稱", "type": "text", "required": true, "options": [], "max": 0, "maxLength": 120}, {"key": "city", "label": "目前居住縣市", "type": "select", "required": true, "options": ["臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市", "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣", "海外／其他"], "max": 23, "maxLength": 120}, {"key": "roles", "label": "你目前的身分是什麼？", "type": "multi", "required": true, "options": ["美術／才藝教師", "幼教人員", "國小教師", "安親／課後照顧人員", "其他教育工作者", "工作室／教室經營者", "其他領域工作者", "學生", "目前以家庭照顧為主", "其他"], "max": 10, "maxLength": 120}, {"key": "organization", "label": "目前任職單位或工作室名稱", "type": "text", "required": false, "options": [], "max": 0, "maxLength": 120}, {"key": "experience", "label": "你目前有帶領課程或活動的經驗嗎？", "type": "select", "required": true, "options": ["尚未有經驗", "曾協助但未獨立帶領", "偶爾帶領", "目前固定帶課"], "max": 4, "maxLength": 120}, {"key": "years", "label": "累積帶領經驗約多久？", "type": "select", "required": true, "options": ["未滿 1 年", "1～3 年", "4～7 年", "8 年以上"], "max": 4, "maxLength": 120, "experiencedOnly": true}, {"key": "pastAudiences", "label": "曾帶領哪些對象？", "type": "multi", "required": true, "options": ["3 歲以下", "幼兒", "國小", "青少年", "成人", "熟齡／長者", "親子團體", "其他"], "max": 8, "maxLength": 120, "experiencedOnly": true}, {"key": "backgrounds", "label": "曾接觸哪些相關學習？", "type": "multi", "required": true, "options": ["美術／設計", "幼兒／兒童教育", "創作活動帶領", "情緒教育", "相關助人專業培訓", "主要透過自學", "尚未接觸", "其他"], "max": 8, "maxLength": 120}, {"key": "motivations", "label": "你為什麼想參加創感力師資培訓？", "type": "multi", "required": true, "options": ["想開始學習帶領課程", "想提升目前的教學能力", "想增加課程設計與活動引導的方法", "想更理解學員的創作與表達", "想將所學加入現有課程", "想轉職或發展第二專長", "想規劃自己的工作室或課程", "想先探索這個領域是否適合自己", "其他"], "max": 3, "maxLength": 120}, {"key": "learningExpectations", "label": "培訓結束後，你最希望自己能做到哪一件事？", "type": "textarea", "required": true, "options": [], "max": 0, "maxLength": 2000}, {"key": "skills", "label": "以下哪些部分，是你最想加強的？", "type": "multi", "required": true, "options": ["設計一堂完整的課", "安排主題、媒材與活動流程", "清楚說明活動，讓學員願意開始", "引導學員發展自己的想法", "回應「我不會」「我不敢」等狀況", "觀察創作過程並適當提問", "掌握團體秩序與課堂節奏", "因應不同年齡、能力與需求", "給予具體回饋，與家長或學員溝通", "尚不確定，希望透過培訓找到方向", "其他"], "max": 3, "maxLength": 120}, {"key": "challenges", "label": "你目前最擔心、或最常卡住的事情是什麼？", "type": "textarea", "required": false, "options": [], "max": 0, "maxLength": 2000}, {"key": "intendedUses", "label": "你希望把所學用在哪裡？", "type": "multi", "required": true, "options": ["目前任職單位", "自己的工作室／教室", "社區或機構活動", "親子活動", "未來求職或轉職", "尚在探索", "其他"], "max": 7, "maxLength": 120}, {"key": "targetGroups", "label": "你最希望帶領哪些對象？", "type": "multi", "required": true, "options": ["幼兒", "國小", "青少年", "成人", "熟齡／長者", "親子團體", "尚未確定"], "max": 7, "maxLength": 120}, {"key": "practicePlan", "label": "你目前的實踐計畫比較接近哪一種？", "type": "select", "required": true, "options": ["已有課程，想立即加入新方法", "已有帶課機會，正在準備", "想在培訓後 3 個月內嘗試", "有想法但尚無明確時間", "先學習，再決定方向"], "max": 5, "maxLength": 120}, {"key": "supportNeeds", "label": "上課時，有沒有希望我們事先協助或留意的安排？", "type": "textarea", "required": false, "options": [], "max": 0, "maxLength": 2000}, {"key": "additionalNotes", "label": "還有什麼想讓講師知道，或想在課程中詢問的問題？", "type": "textarea", "required": false, "options": [], "max": 0, "maxLength": 2000}]$schema$::jsonb) loop
  k:=spec->>'key'; answer_value:=intake->k;
  if coalesce((spec->>'experiencedOnly')::boolean,false) and intake->>'experience'='尚未有經驗' then
    clean:=clean||jsonb_build_object(k,case when spec->>'type'='multi' then '[]'::jsonb else '""'::jsonb end); continue;
  end if;
  if spec->>'type'='multi' then
    if jsonb_typeof(answer_value) is distinct from 'array' then raise exception 'INVALID_INTAKE'; end if;
    if jsonb_array_length(answer_value)<1 or jsonb_array_length(answer_value)>(spec->>'max')::integer then raise exception 'INVALID_INTAKE'; end if;
    if exists(select 1 from jsonb_array_elements(answer_value) a where jsonb_typeof(a)<>'string' or not (spec->'options' @> jsonb_build_array(a)))
      or (select count(distinct a) from jsonb_array_elements_text(answer_value) a)<>jsonb_array_length(answer_value) then raise exception 'INVALID_INTAKE'; end if;
    clean:=clean||jsonb_build_object(k,answer_value);
  else
    if answer_value is not null and jsonb_typeof(answer_value)<>'string' then raise exception 'INVALID_INTAKE'; end if;
    answer:=trim(coalesce(intake->>k,''));
    if ((spec->>'required')::boolean and answer='') or length(answer)>(spec->>'maxLength')::integer then raise exception 'INVALID_INTAKE'; end if;
    if spec->>'type'='select' and not(spec->'options' @> jsonb_build_array(answer)) then raise exception 'INVALID_INTAKE'; end if;
    clean:=clean||jsonb_build_object(k,answer);
  end if;
 end loop;
 if coalesce(clean->>'birthDate','')<>'' then
  if clean->>'birthDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_INTAKE'; end if;
  begin birth_date:=(clean->>'birthDate')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'INVALID_INTAKE'; end;
  if to_char(birth_date,'YYYY-MM-DD')<>clean->>'birthDate' or birth_date>(now() at time zone 'Asia/Taipei')::date then raise exception 'INVALID_INTAKE'; end if;
 end if;
 if clean->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or regexp_replace(clean->>'phone','[ -]','','g') !~ '^\+?[0-9]{8,15}$' then raise exception 'INVALID_INTAKE'; end if;
 perform public.submit_training_intake_v1(access_token,jsonb_build_object(
 'currentRole',(select string_agg(a,'、') from jsonb_array_elements_text(clean->'roles') a),
 'organization',clean->>'organization','teachingExperience',clean->>'experience'||' '||coalesce(clean->>'years',''),
 'motivation',(select string_agg(a,'、') from jsonb_array_elements_text(clean->'motivations') a),
 'intendedUse',(select string_agg(a,'、') from jsonb_array_elements_text(clean->'intendedUses') a),
 'learningExpectations',clean->>'learningExpectations','additionalNotes',clean->>'additionalNotes'));
 update training_intake_responses set questionnaire=clean||'{"version":2,"dataConsent":true}'::jsonb,consent_at=coalesce(consent_at,now()) where enrollment_id=target;
end $$;
revoke all on function public.submit_training_intake(text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_training_intake(text,jsonb) to service_role;
