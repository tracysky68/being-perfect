import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {processReminders} from '../_shared/course-reminders.ts';
const env=(key:string)=>Deno.env.get(key)||'';
async function authorized(value:string){
 const secret=env('COURSE_REMINDER_CRON_SECRET');if(!secret||!value)return false;
 const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));
 const a=await digest(value),b=await digest(secret);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}
Deno.serve(async request=>{
 const json=(data:any,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method!=='POST'||!await authorized(request.headers.get('x-reminder-secret')||''))return json({error:'Unauthorized'},401);
 const client=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}').default);
 let runId:string|undefined;
 try{
  const body=await request.json();
  const {data:settings,error}=await client.from('course_reminder_settings').select('cohort_id').eq('enabled',true);if(error)throw Error('SETTINGS_READ_FAILED');
  if(body.dryRun===true)return json({dryRun:true,enabledCohorts:settings.length});
  if(body.run!==true)return json({error:'Explicit run required'},400);
  const {data:run,error:runError}=await client.from('course_reminder_runs').insert({}).select('id').single();if(runError)throw Error('RUN_STORAGE_FAILED');runId=run.id;
  const result=settings.length?await processReminders(client,env('LINE_CHANNEL_ACCESS_TOKEN'),env('LINE_OFFICIAL_BASIC_ID')):{claimed:0,accepted:0,failed:0};
  const {error:saveError}=await client.from('course_reminder_runs').update({...result,status:result.failed?'needs_review':'complete',completed_at:new Date().toISOString()}).eq('id',runId);if(saveError)throw Error('RUN_UPDATE_FAILED');
  await client.from('course_reminder_runs').delete().lt('started_at',new Date(Date.now()-30*86400e3).toISOString());
  return json(result);
 }catch(e){
  const code=['SETTINGS_READ_FAILED','RUN_STORAGE_FAILED','BOT_IDENTITY_FAILED','CLAIM_FAILED','RUN_UPDATE_FAILED'].includes(e.message)?e.message:'REMINDER_RUN_FAILED';
  if(runId)await client.from('course_reminder_runs').update({status:'failed',error_code:code,completed_at:new Date().toISOString()}).eq('id',runId);
  return json({error:code},503);
 }
});
