const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async(value:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
export async function subscriptionToken(seed:string,secret:string){
 if(!secret)throw Error('Calendar secret unavailable');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('course-calendar:'+seed)));
}
const stamp=(value:string)=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const escapeText=(value:string)=>String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const fold=(value:string)=>{let result='',line='',bytes=0;for(const c of value){const size=new TextEncoder().encode(c).length;if(bytes+size>75){result+=line+'\r\n';line=' ';bytes=1;}line+=c;bytes+=size;}return result+line;};
export function renderCalendar(events:any[],now=new Date().toISOString()){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Being Perfect//Course Subscription//ZH-TW','CALSCALE:GREGORIAN','X-WR-CALNAME:玩美學｜我的課程','X-WR-TIMEZONE:Asia/Taipei','REFRESH-INTERVAL;VALUE=DURATION:PT6H','X-PUBLISHED-TTL:PT6H'];
 for(const e of events){
  if(!Number.isFinite(Date.parse(e.starts_at))||!Number.isFinite(Date.parse(e.ends_at))||Date.parse(e.ends_at)<=Date.parse(e.starts_at))continue;
  lines.push('BEGIN:VEVENT','UID:'+escapeText(e.uid)+'@beingperfect.com.tw','DTSTAMP:'+stamp(now),'DTSTART:'+stamp(e.starts_at),'DTEND:'+stamp(e.ends_at),'SUMMARY:'+escapeText(e.title),'STATUS:'+(e.cancelled?'CANCELLED':'CONFIRMED'),'DESCRIPTION:最新安排請回玩美學官方 LINE「我的課程」查看。訂閱同步可能延遲。','END:VEVENT');
 }
 return lines.concat('END:VCALENDAR').map(fold).join('\r\n')+'\r\n';
}
export async function calendarEvents(client:any,studentId:string){
 const {data:rows,error}=await client.from('enrollments').select('id,status,cohort_id,cohorts(courses(code,title)),enrollment_sessions(status,course_sessions(id,title,starts_at,ends_at))').eq('student_id',studentId);
 if(error)throw Error('Calendar query failed');
 const supported=(rows||[]).filter((r:any)=>['TEACHER-DIALOGUE','TEACHER-TRAINING'].includes(r.cohorts?.courses?.code));
 const ids=[...new Set(supported.filter((r:any)=>r.cohorts.courses.code==='TEACHER-TRAINING').map((r:any)=>r.cohort_id))];
 const {data:training,error:trainingError}=ids.length?await client.from('training_sessions').select('id,cohort_id,title,starts_at,ends_at').in('cohort_id',ids):{data:[],error:null};
 if(trainingError)throw Error('Calendar schedule query failed');
 const events:any[]=[];
 for(const r of supported){
  const cancelled=['cancelled','refunded','refunding','expired','payment_failed'].includes(r.status);
  const sessions=r.cohorts.courses.code==='TEACHER-TRAINING'?(training||[]).filter((s:any)=>s.cohort_id===r.cohort_id).map((s:any)=>({status:'confirmed',course_sessions:s})):(r.enrollment_sessions||[]);
  for(const selection of sessions){
   const s=selection.course_sessions;
   if(!s||!['confirmed','admin_assigned','cancelled'].includes(selection.status))continue;
   events.push({uid:r.id+'-'+s.id,title:r.cohorts.courses.title+'｜'+s.title,starts_at:s.starts_at,ends_at:s.ends_at,cancelled:cancelled||selection.status==='cancelled'});
  }
 }
 return events.sort((a,b)=>a.uid.localeCompare(b.uid));
}
