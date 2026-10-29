const time=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s));
export function reminderMessage(c:any,days:number){
 const dates=(c.sessions||[]).map((s:any)=>`${s.title}：${time(s.starts_at)} ～ ${time(s.ends_at)}`).join('\n');
 const text=`${c.name}您好，提醒您「${c.course_title}」將於 ${days} 天後開始！\n\n${dates}\n（以上皆為台灣時間）\n\n上課地點／連結：\n${c.location_text}${c.notes?'\n\n注意事項：\n'+c.notes:''}\n\n請從本官方 LINE 的「我的課程」查看最新安排與課前資料。如有問題，請直接回覆我們。`;
 if(text.length>4900)throw Error('MESSAGE_TOO_LONG');return text;
}
export function eligible(c:any,delivery:any,now=new Date()){
 if(!c||!c.enabled||!c.binding_valid||c.enrollment_status!=='paid'||!c.location_text.trim()||c.line_user_id!==delivery.line_user_id||Date.parse(c.first_start)!==Date.parse(delivery.first_start))return false;
 const taipei=(v:Date)=>new Date(v.getTime()+8*3600e3);
 const today=taipei(now),start=taipei(new Date(c.first_start));
 return today.getUTCHours()>=10&&today.getUTCHours()<20&&Date.parse(c.first_start)>now.getTime()&&Math.round((Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate())-Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()))/86400e3)===delivery.days_before;
}
export async function processReminders(db:any,accessToken:string,officialId:string,transport=fetch){
 // Verify the bot before claiming any messages, so configuration failure consumes no deliveries.
 const botResponse=await transport('https://api.line.me/v2/bot/info',{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(8000)});
 if(!botResponse.ok||(await botResponse.json()).basicId!==officialId)throw Error('BOT_IDENTITY_FAILED');
 const {data:jobs,error}=await db.rpc('claim_course_reminders');if(error)throw Error('CLAIM_FAILED');
 const result={claimed:jobs.length,accepted:0,failed:0};
 for(const job of jobs){
  let status='unknown',errorCode=null,requestId=null;
  try{
   const {data:c,error}=await db.from('course_reminder_candidates').select('*').eq('enrollment_id',job.enrollment_id).single();
   if(error)throw Error('ELIGIBILITY_READ_FAILED');
   if(!eligible(c,job)){status='skipped';errorCode='ELIGIBILITY_CHANGED';}
   else{
    const message=reminderMessage(c,job.days_before);
    const {error:writeError}=await db.from('course_reminder_deliveries').update({message}).eq('id',job.id).eq('status','sending');
    if(writeError)throw Error('MESSAGE_STORAGE_FAILED');
    const r=await transport('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json','X-Line-Retry-Key':job.id},body:JSON.stringify({to:job.line_user_id,messages:[{type:'text',text:message}]}),signal:AbortSignal.timeout(8000)});
    requestId=r.headers.get('x-line-request-id');status=r.ok||(r.status===409&&r.headers.has('x-line-accepted-request-id'))?'accepted':r.status>=500?'unknown':'failed';
    if(status!=='accepted')errorCode='LINE_HTTP_'+r.status;
   }
  }catch(e){errorCode=['MESSAGE_TOO_LONG','ELIGIBILITY_READ_FAILED','MESSAGE_STORAGE_FAILED'].includes(e.message)?e.message:'NETWORK_UNCERTAIN';}
  const {error:saveError}=await db.from('course_reminder_deliveries').update({status,error_code:errorCode,provider_request_id:requestId,updated_at:new Date().toISOString()}).eq('id',job.id);
  if(status==='accepted'&&!saveError)result.accepted++;else result.failed++;
 }
 return result;
}
export async function reminderAdmin(p:any,db:any,actor:string){
 if(p.action==='reminder_settings'){
  const {data:cohorts,error}=await db.from('cohorts').select('id,title,courses!inner(code,title),course_reminder_settings(*)').in('courses.code',['TEACHER-DIALOGUE','TEACHER-TRAINING']).order('starts_at',{ascending:false});
  if(error)throw error;
  const {data:runs,error:runError}=await db.from('course_reminder_runs').select('started_at,completed_at,status,claimed,accepted,failed,error_code').order('started_at',{ascending:false}).limit(1);if(runError)throw runError;
  return {cohorts,runs};
 }
 if(p.action==='save_reminder_settings'){
  if(typeof p.enabled!=='boolean'||typeof p.locationText!=='string'||typeof p.notes!=='string'||p.locationText.length>1500||p.notes.length>1500||p.enabled&&!p.locationText.trim())throw Error('請填寫上課地點或線上連結，確認內容後再啟用（各欄最多 1500 字）');
  const {data:cohort,error}=await db.from('cohorts').select('id,courses!inner(code)').eq('id',p.cohortId).single();if(error||!['TEACHER-DIALOGUE','TEACHER-TRAINING'].includes(cohort?.courses?.code))throw Error('找不到適用的梯次');
  const {error:writeError}=await db.from('course_reminder_settings').upsert({cohort_id:p.cohortId,enabled:p.enabled,location_text:p.locationText.trim(),notes:p.notes.trim(),actor,updated_at:new Date().toISOString()});if(writeError)throw writeError;
  return {saved:true};
 }
 if(p.action==='reminder_status'){
  const {data:c,error}=await db.from('course_reminder_candidates').select('*').eq('enrollment_id',p.enrollmentId).single();if(error)throw error;
  const {data:history,error:historyError}=await db.from('course_reminder_deliveries').select('days_before,first_start,status,created_at,error_code,message').eq('enrollment_id',p.enrollmentId).order('created_at',{ascending:false});if(historyError)throw historyError;
  const reason=c.enrollment_status!=='paid'?'尚未完款':!c.first_start?'尚未安排已確認課程':!c.enabled?'梯次提醒尚未啟用':!c.binding_valid?'學員尚未完成有效 LINE 綁定':!c.location_text?'尚未填寫地點或連結':'已具備自動發送條件';
  const schedules=c.first_start?[3,1].map(days=>{const local=new Date(Date.parse(c.first_start)+8*3600e3);local.setUTCDate(local.getUTCDate()-days);local.setUTCHours(2,0,0,0);return {days,at:local.toISOString()}}):[];
  return {reason,schedules,history,preview:c.first_start&&c.location_text?reminderMessage(c,3):null};
 }
 throw Error('不支援的提醒操作');
}
