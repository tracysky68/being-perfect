import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {digest,calendarEvents,renderCalendar} from '../_shared/course-calendar-feed.ts';
const env=(key:string)=>Deno.env.get(key)||'';
Deno.serve(async(request:Request)=>{
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
 const reject=(status:number)=>new Response('Calendar unavailable',{status,headers});
 if(!['GET','HEAD'].includes(request.method))return reject(405);
 const token=new URL(request.url).searchParams.get('token')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return reject(404);
 try{
  const client=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default);
  const {data:sub,error}=await client.from('course_calendar_subscriptions').select('student_id').eq('token_hash',await digest(token)).maybeSingle();
  if(error)throw error;if(!sub)return reject(404);
  const {data:binding,error:bindingError}=await client.from('course_line_bindings').select('verified_email,students(email)').eq('student_id',sub.student_id).maybeSingle();
  if(bindingError)throw bindingError;
  const student=Array.isArray(binding?.students)?binding.students[0]:binding?.students;
  if(!binding||student?.email!==binding.verified_email)return reject(404);
  const body=renderCalendar(await calendarEvents(client,sub.student_id));
  return new Response(request.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="being-perfect-courses.ics"'}});
 }catch{return reject(503);}
});
