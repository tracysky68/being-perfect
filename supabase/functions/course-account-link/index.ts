import {subscriptionToken,digest as calendarDigest} from '../_shared/course-calendar-feed.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const env=(k:string)=>Deno.env.get(k)||'';
const site=()=>env('PUBLIC_SITE_URL')||'https://beingperfect.com.tw';
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const db=()=>createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default);
const fail=(message:string,status=400)=>{throw Object.assign(Error(message),{status});};
async function rpc(client:any,name:string,args:any){const {data,error}=await client.rpc(name,args);if(error)fail('服務暫時無法使用',503);return data;}
async function line(path:string,body?:any){const response=await fetch('https://api.line.me/v2/bot/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env('LINE_CHANNEL_ACCESS_TOKEN'),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!response.ok)fail('LINE 服務暫時無法使用',503);return response.json();}
async function sessionUrl(client:any,uid:string){const token=random();const {error}=await client.from('course_portal_sessions').insert({token_hash:await hash(token),line_user_id:uid,expires_at:new Date(Date.now()+30*60e3).toISOString()});if(error)fail('建立課程入口失敗',503);return site()+'/my-courses.html#session='+token;}
async function reply(event:any,text:string){if(event.replyToken)await line('message/reply',{replyToken:event.replyToken,messages:[{type:'text',text}]});}
async function webhook(request:Request){
 const raw=await request.text();if(raw.length>1048576)fail('Payload too large',413);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env('LINE_CHANNEL_SECRET')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 let sig:Uint8Array;try{sig=Uint8Array.from(atob(request.headers.get('x-line-signature')||''),c=>c.charCodeAt(0));}catch{fail('Invalid signature',401);}
 if(!env('LINE_CHANNEL_SECRET')||!await crypto.subtle.verify('HMAC',key,sig!,new TextEncoder().encode(raw)))fail('Invalid signature',401);
 const body=JSON.parse(raw);if(body.destination!==env('LINE_BOT_DESTINATION'))fail('Wrong destination',401);
 const client=db();
 for(const e of body.events||[]){
  const isLink=e.type==='accountLink'&&String(e.link?.nonce||'').startsWith('BP-course-');
  const isMenu=e.type==='message'&&e.message?.type==='text'&&['我的課程','綁定我的課程'].includes(e.message.text.trim());
  if(!isLink&&!isMenu)continue;
  const uid=e.source?.userId;
  if(isLink){
   const result=await rpc(client,'course_finish_link',{nonce_digest:await hash(e.link.nonce),line_uid:uid||'',link_ok:e.link.result==='ok'});
   const {error:linkClaim}=await client.from('course_line_events').insert({event_id:e.webhookEventId||('link:'+e.link.nonce)});if(linkClaim?.code==='23505')continue;if(linkClaim)fail('Event storage unavailable',503);
   if(result.linked)await reply(e,'綁定成功！點此查看課程、填寫課前資料與加入行事曆：\n'+await sessionUrl(client,uid));
   else await reply(e,'這次綁定未完成，請重新點「我的課程」。若已有其他帳號綁定，請聯絡行政協助。');
   continue;
  }
  if(e.source?.type!=='user'||!/^U[a-f0-9]{32}$/.test(uid||''))continue;
  const eventId=e.webhookEventId||e.message.id;
  const {error:claim}=await client.from('course_line_events').insert({event_id:eventId});if(claim?.code==='23505')continue;if(claim)fail('Event storage unavailable',503);
  const {data:binding,error:bindingError}=await client.from('course_line_bindings').select('student_id,verified_email,students(email)').eq('line_user_id',uid).maybeSingle();
  if(bindingError)fail('Binding unavailable',503);
  if(binding&&binding.students?.email===binding.verified_email){await reply(e,'您的課程已整理好，請點下方連結查看上課日期與課前資料：\n'+await sessionUrl(client,uid)+'\n\n連結 30 分鐘內有效，請勿轉傳。');continue;}
  const token=random();const issued=await line('user/'+uid+'/linkToken',{});
  const {error}=await client.from('course_link_entries').insert({token_hash:await hash(token),line_user_id:uid,link_token:issued.linkToken,expires_at:new Date(Date.now()+9*60e3).toISOString()});if(error)fail('Binding storage unavailable',503);
  await reply(e,'第一次使用「我的課程」，請驗證報名 Email 並完成 LINE 帳號確認：\n'+site()+'/my-courses.html#bind='+token+'\n\n連結 9 分鐘內有效，僅供本人使用。綁定後可在「我的課程」解除綁定。');
 }
 return {ok:true};
}
async function publicAction(p:any){
 const client=db();const token=String(p.token||'');if(!/^[a-f0-9]{64}$/.test(token))fail('連結已失效，請回官方 LINE 點「我的課程」',401);
 const digest=await hash(token);
 if(p.action==='request_code'){
  const email=String(p.email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail('請填寫報名 Email');
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
  const secret=env('COURSE_BINDING_SECRET');if(!secret)fail('綁定服務尚未啟用',503);
  const result=await rpc(client,'course_request_otp',{entry_hash:digest,email_value:email,code_hash:await hash(secret+token+code)});
  if(result.error)fail(result.error==='RATE_LIMIT'?'請稍後再申請驗證碼':'連結已失效，請回官方 LINE 重新點「我的課程」',429);
  if(result.known){
   const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({from:env('EMAIL_FROM')||'玩美學 <course@mail.beingperfect.com.tw>',to:[email],subject:'玩美學｜我的課程綁定驗證碼',text:`您的綁定驗證碼是：${code}\n\n請在 5 分鐘內於您自己開啟的「我的課程」頁面輸入。若不是您本人操作，請忽略此信，不要把驗證碼提供給他人。`}),signal:AbortSignal.timeout(10000)});
   if(!r.ok)fail('驗證信暫時無法寄送，請稍後重試',503);
  }
  return {message:'若 Email 與報名資料相符，您會收到 8 位數驗證碼。請檢查收件匣與垃圾郵件。'};
 }
 if(p.action==='verify_code'){
  if(!/^\d{8}$/.test(String(p.code||'')))fail('請輸入 8 位數驗證碼');
  const nonce='BP-course-'+random();const result=await rpc(client,'course_verify_otp',{entry_hash:digest,code_hash:await hash(env('COURSE_BINDING_SECRET')+token+p.code),nonce_digest:await hash(nonce)});
  if(result.error)fail('驗證碼錯誤或已過期，請重新申請',409);
  return {url:'https://access.line.me/dialog/bot/accountLink?'+new URLSearchParams({linkToken:result.linkToken,nonce})};
 }
 const {data:session,error:sessionError}=await client.from('course_portal_sessions').select('line_user_id,expires_at').eq('token_hash',digest).maybeSingle();
 if(sessionError||!session||new Date(session.expires_at).getTime()<=Date.now())fail('連結已過期，請回官方 LINE 點「我的課程」',401);
 const {data:binding}=await client.from('course_line_bindings').select('student_id,verified_email,students(email,full_name)').eq('line_user_id',session.line_user_id).maybeSingle();
 if(!binding||binding.students?.email!==binding.verified_email)fail('請回官方 LINE 重新驗證報名 Email',401);
 if(['calendar_status','calendar_create','calendar_revoke'].includes(p.action)){
  if(p.action==='calendar_revoke'){
   if(p.confirmed!==true)fail('請確認停用訂閱');
   const {error}=await client.from('course_calendar_subscriptions').delete().eq('student_id',binding.student_id);
   if(error)fail('停用訂閱失敗，請稍後再試',503);
   return {active:false};
  }
  let {data:subscription,error}=await client.from('course_calendar_subscriptions').select('seed,token_hash').eq('student_id',binding.student_id).maybeSingle();
  if(error)fail('讀取訂閱失敗',503);
  if(!subscription&&p.action==='calendar_create'){
   const seed=random();const token=await subscriptionToken(seed,env('COURSE_BINDING_SECRET'));
   const inserted=await client.from('course_calendar_subscriptions').insert({student_id:binding.student_id,seed,token_hash:await calendarDigest(token)});
   if(inserted.error&&inserted.error.code!=='23505')fail('建立訂閱失敗',503);
   const result=await client.from('course_calendar_subscriptions').select('seed,token_hash').eq('student_id',binding.student_id).single();
   if(result.error)fail('建立訂閱失敗',503);subscription=result.data;
  }
  if(!subscription)return {active:false};
  const calendarToken=await subscriptionToken(subscription.seed,env('COURSE_BINDING_SECRET'));
  if(await calendarDigest(calendarToken)!==subscription.token_hash)fail('訂閱設定已更新，請停用後重新建立',409);
  return {active:true,url:env('SUPABASE_URL')+'/functions/v1/course-calendar-feed?token='+calendarToken};
 }
 if(p.action==='unlink'){
  if(p.confirmed!==true)fail('請確認解除綁定');await rpc(client,'course_unlink',{line_uid:session.line_user_id});return {message:'已解除綁定，報名與付款紀錄仍會保留。'};
 }
 if(p.action!=='courses')fail('Unsupported action');
 const {data:rows,error}=await client.from('enrollments').select('id,order_number,status,cohort_id,cohorts(title,courses(code,title)),enrollment_sessions(status,course_sessions(id,title,starts_at,ends_at)),enrollment_portal_tokens(token),training_intake_responses(submitted_at),teacher_intake_responses(submitted_at)').eq('student_id',binding.student_id).order('created_at',{ascending:false});
 if(error)fail('課程暫時無法讀取',503);
 const cohortIds=(rows||[]).filter((r:any)=>r.cohorts?.courses?.code==='TEACHER-TRAINING').map((r:any)=>r.cohort_id);
 const {data:training,error:trainingError}=cohortIds.length?await client.from('training_sessions').select('id,cohort_id,title,starts_at,ends_at').in('cohort_id',cohortIds):{data:[],error:null};
 if(trainingError)fail('課表暫時無法讀取',503);
 return {name:binding.students.full_name,courses:(rows||[]).filter((r:any)=>['TEACHER-DIALOGUE','TEACHER-TRAINING'].includes(r.cohorts?.courses?.code)).map((r:any)=>{
  const isTraining=r.cohorts.courses.code==='TEACHER-TRAINING',paid=['paid','partially_paid'].includes(r.status);
  const sessions=isTraining?(training||[]).filter((s:any)=>s.cohort_id===r.cohort_id):(r.enrollment_sessions||[]).filter((s:any)=>['confirmed','admin_assigned'].includes(s.status)).map((s:any)=>s.course_sessions);
  const portal=Array.isArray(r.enrollment_portal_tokens)?r.enrollment_portal_tokens[0]:r.enrollment_portal_tokens;
  return {id:r.id,title:r.cohorts.courses.title,cohort:r.cohorts.title,status:r.status,sessions:sessions.filter(Boolean).sort((a:any,b:any)=>a.starts_at.localeCompare(b.starts_at)),intakeComplete:Boolean(Array.isArray(isTraining?r.training_intake_responses:r.teacher_intake_responses)?(isTraining?r.training_intake_responses:r.teacher_intake_responses)[0]?.submitted_at:(isTraining?r.training_intake_responses:r.teacher_intake_responses)?.submitted_at),intakeUrl:paid&&portal?.token?site()+'/'+(isTraining?'training-intake.html':'teacher-intake.html')+'?token='+encodeURIComponent(portal.token):null};
 })};
}
Deno.serve(async request=>{
 const origin=request.headers.get('origin')||'';const allowed=site();const headers={'Access-Control-Allow-Origin':origin===allowed?origin:allowed,'Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(request.method==='OPTIONS')return new Response('ok',{headers});
 if(request.method!=='POST')return json({message:'Method not allowed'},405);
 try{
  if(new URL(request.url).pathname.endsWith('/webhook'))return json(await webhook(request));
  if(origin!==allowed)return json({message:'Origin not allowed'},403);
  if(Number(request.headers.get('content-length')||0)>8192)fail('Payload too large',413);
  return json(await publicAction(await request.json()));
 }catch(e){return json({message:e.status?e.message:'服務暫時無法使用，請稍後再試'},e.status||503);}
});
