const token = new URLSearchParams(location.search).get('token') || '';
const form = document.querySelector('#training-intake');
const status = document.querySelector('#intake-status');
const schema = window.TRAINING_QUESTIONNAIRE;
const taipeiToday = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
form.elements.birthDate.max=taipeiToday;
function updateExperience(){
  const none=form.elements.experience.value==='尚未有經驗';
  form.querySelectorAll('[data-experienced-only]').forEach(group=>{
    group.hidden=none;group.querySelectorAll('input,select').forEach(input=>{input.disabled=none;if(input.tagName==='SELECT')input.required=!none;});
  });
}
function readAnswers(){
  const data=new FormData(form);const result={version:2,dataConsent:data.get('dataConsent')==='on'};
  for(const field of schema)result[field.key]=field.type==='multi'?data.getAll(field.key):String(data.get(field.key)||'').trim();
  return result;
}
function validateAnswers(answers){
  for(const f of schema){
    if(f.experiencedOnly&&answers.experience==='尚未有經驗')continue;
    const v=answers[f.key];
    if(f.type==='multi'&&(!v.length||v.length>f.max))return {field:f.key,message:`「${f.label}」請選擇 1～${f.max} 項。`};
    if(f.type!=='multi'&&f.required&&!v)return {field:f.key,message:`請填寫「${f.label}」。`};
  }
  if(answers.birthDate){
    const date=new Date(answers.birthDate+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(answers.birthDate)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==answers.birthDate||answers.birthDate>taipeiToday)
      return {field:'birthDate',message:'請填寫有效的出生年月日，不能晚於今天。'};
  }
  if(!/^\+?\d{8,15}$/.test(answers.phone.replace(/[\s-]/g,'')))return {field:'phone',message:'請確認手機號碼格式。'};
  return null;
}
async function load(){
  if(!/^[a-f0-9]{64}$/.test(token)){status.textContent='請使用付款確認信中的完整專屬連結。';return;}
  try{
    const response=await fetch(`${window.BP_CONFIG.intakeEndpoint}?token=${encodeURIComponent(token)}`);const result=await response.json();
    if(!response.ok)throw new Error(result.message || '資料載入失敗');
    if(result.courseCode!=='TEACHER-TRAINING'){location.replace(`teacher-intake.html?token=${encodeURIComponent(token)}`);return;}
    document.querySelector('#student-name').textContent=`${result.student.name}，你好`;
    document.querySelector('#cohort-title').textContent=result.cohort;
    const formatter=new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Taipei'});
    result.sessions.forEach(s=>{const li=document.createElement('li');li.textContent=s.title;const span=document.createElement('span');span.textContent=`${formatter.format(new Date(s.starts_at))} ～ ${formatter.format(new Date(s.ends_at))}`;li.append(span);document.querySelector('#intake-schedule').append(li);});
    const answers=result.intake?.questionnaire || {fullName:result.student.name,email:result.student.email,phone:result.student.phone,organization:result.intake?.organization,learningExpectations:result.intake?.learning_expectations,additionalNotes:result.intake?.additional_notes};
    for(const f of schema){if(f.type==='multi'){form.querySelectorAll(`[name="${f.key}"]`).forEach(input=>input.checked=(answers[f.key]||[]).includes(input.value));}else form.elements[f.key].value=answers[f.key]||'';}
    form.elements.dataConsent.checked=answers.dataConsent===true;
    updateExperience();status.textContent=result.intake?'已載入先前資料；請確認內容並補齊尚未填寫的欄位。':'';document.querySelector('#intake-content').hidden=false;
  }catch(e){status.textContent=e.message;}
}
form.elements.experience.addEventListener('change',updateExperience);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const message=document.querySelector('#save-status');const intake=readAnswers();const error=validateAnswers(intake);
  if(error){message.textContent=error.message;form.querySelector(`[name="${error.field}"]`).focus();return;}
  const button=form.querySelector('button');button.disabled=true;message.textContent='正在儲存…';
  try{
    const response=await fetch(window.BP_CONFIG.intakeSubmitEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,intakeType:'training',intake})});const result=await response.json();
    if(!response.ok)throw new Error(result.message || '儲存失敗');message.textContent='課前資料已儲存完成，謝謝你的分享。';
  }catch(e){message.textContent=e.message;}finally{button.disabled=false;}
});
load();
