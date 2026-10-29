const fail=(message:string,status=400)=>{throw Object.assign(new Error(message),{status});};
export function parseLineRecipient(value:string){
 let id=value.trim();
 if(id.startsWith('https://')){
  const u=new URL(id);const m=u.pathname.match(/^\/U[a-f0-9]{32}\/chat\/(U[a-f0-9]{32})$/);
  if(u.origin!=='https://chat.line.biz'||!m||u.search||u.hash)fail('請貼上官方 LINE 的單一學員聊天室網址');
  id=m[1];
 }
 if(!/^U[a-f0-9]{32}$/.test(id))fail('請使用學員的 LINE 聊天室網址或 Messaging API user ID');
 return id;
}
export async function intakeMessage(db:any,id:string){
 const {data:e,error}=await db.from('enrollments').select('status,contact_snapshot,students!inner(full_name),cohorts!inner(courses!inner(code,title)),enrollment_portal_tokens(token)').eq('id',id).single();
 if(error||!e)fail('找不到報名資料',404);
 if(e.status!=='paid')fail('此訊息僅適用已完款學員',409);
 const portal=Array.isArray(e.enrollment_portal_tokens)?e.enrollment_portal_tokens[0]:e.enrollment_portal_tokens;
 if(!portal?.token)fail('尚無專屬課前連結',409);
 const course=e.cohorts.courses,name=e.contact_snapshot?.name||e.students.full_name;
 const title=course.code==='TEACHER-TRAINING'?'創感力師資培訓':course.title;
 const page=course.code==='TEACHER-TRAINING'?'training-intake.html':'teacher-intake.html';
 const url=`${(Deno.env.get('PUBLIC_SITE_URL')||'https://beingperfect.com.tw').replace(/\/$/,'')}/${page}?token=${encodeURIComponent(portal.token)}`;
 const message=`${name}您好，已確認您完成「${title}」報名與付款！\n\n為了讓老師提前了解您的背景與學習期待，請協助填寫課前資料：\n\n${url}\n\n此為您的專屬連結，請勿轉傳。有任何問題，歡迎直接回覆我們，謝謝！`;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(message)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 return {name,message,hash};
}
async function lineIdentity(userId:string){
 const token=Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN'),basicId=Deno.env.get('LINE_OFFICIAL_BASIC_ID');
 if(!token||!basicId)fail('官方 LINE 尚未完成串接設定',503);
 const headers={Authorization:`Bearer ${token}`};
 const botResponse=await fetch('https://api.line.me/v2/bot/info',{headers,signal:AbortSignal.timeout(10000)});
 if(!botResponse.ok)fail('官方 LINE 授權無法使用，請通知管理員',503);
 const bot=await botResponse.json();if(bot.basicId!==basicId)fail('官方 LINE 帳號不符，已停止發送',409);
 const response=await fetch(`https://api.line.me/v2/bot/profile/${userId}`,{headers,signal:AbortSignal.timeout(10000)});
 if(!response.ok)fail('找不到此官方帳號的 LINE 聯絡人；請確認聊天室與好友狀態',409);
 const profile=await response.json();if(profile.userId!==userId)fail('LINE 聯絡人不符',409);
 return {token,basicId,displayName:profile.displayName,officialName:bot.displayName};
}
export async function handleLineIntake(payload:any,db:any,actor:string){
 const id=String(payload.enrollmentId||'');
 if(!/^[0-9a-f-]{36}$/.test(id))fail('報名編號格式不正確');
 const content=await intakeMessage(db,id);
 const {data:existing,error:readError}=await db.from('line_intake_deliveries').select('status,display_name,created_at,note,error_code').eq('enrollment_id',id).maybeSingle();
 if(readError)fail('無法讀取 LINE 發送紀錄',503);
 if(payload.action==='line_intake_status')return {configured:Boolean(Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')),delivery:existing};
 if(existing) return {blocked:true,delivery:existing,message:'此學員已有發送或預約紀錄，請先核對，系統不會重複發送。'};
 const userId=parseLineRecipient(String(payload.recipient||''));
 const identity=await lineIdentity(userId);
 if(payload.action==='preview_line_intake')return {...content,userId,displayName:identity.displayName,officialName:identity.officialName};
 if(payload.action!=='send_line_intake'||payload.confirmed!==true)fail('請先預覽並確認收件人');
 if(payload.messageHash!==content.hash||payload.displayName!==identity.displayName)fail('資料已變動，請重新預覽確認',409);
 const operationId=crypto.randomUUID();
 const {error:claimError}=await db.from('line_intake_deliveries').insert({id:operationId,enrollment_id:id,channel_basic_id:identity.basicId,line_user_id:userId,display_name:identity.displayName,message_hash:content.hash,status:'sending',actor});
 if(claimError){if(claimError.code==='23505')return {blocked:true,message:'此學員已有發送紀錄，請重新載入查看。'};fail('無法建立發送紀錄，訊息未送出',503);}
 let status='unknown',errorCode:string|null=null,requestId:string|null=null;
 try{
  const response=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:`Bearer ${identity.token}`,'Content-Type':'application/json','X-Line-Retry-Key':operationId},body:JSON.stringify({to:userId,messages:[{type:'text',text:content.message}]}),signal:AbortSignal.timeout(15000)});
  requestId=response.headers.get('x-line-request-id');
  status=response.ok||(response.status===409&&response.headers.has('x-line-accepted-request-id'))?'accepted':response.status>=500?'unknown':'failed';
  if(status!=='accepted')errorCode=`LINE_HTTP_${response.status}`;
 }catch{errorCode='LINE_NETWORK_UNCERTAIN';}
 const {error:updateError}=await db.from('line_intake_deliveries').update({status,error_code:errorCode,provider_request_id:requestId,updated_at:new Date().toISOString()}).eq('id',operationId);
 if(updateError)return {status:'unknown',message:'發送結果待核對，請勿重複發送。'};
 return {status,message:status==='accepted'?'LINE 已受理訊息（不代表學員已讀）。':status==='failed'?'LINE 未接受訊息，請由管理員查核後再處理。':'發送結果尚不確定，請先到官方 LINE 核對，勿重複發送。'};
}
