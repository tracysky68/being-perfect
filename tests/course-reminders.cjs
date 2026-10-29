const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('/tmp/bp-training-test-tools/node_modules/typescript');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-30T02:00:00Z']))}static now(){return new Date('2026-10-30T02:00:00Z').getTime()}}
const ctx={exports:{},Intl,Date:FixedDate,AbortSignal,fetch};vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/_shared/course-reminders.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);const {eligible,reminderMessage,processReminders,reminderAdmin}=ctx.exports;
const candidate={enabled:true,binding_valid:true,enrollment_status:'paid',line_user_id:'owner',first_start:'2026-11-02T02:00:00Z',name:'Test',course_title:'Course',location_text:'Venue',notes:'Bring pen',sessions:[{title:'Day1',starts_at:'2026-11-02T02:00:00Z',ends_at:'2026-11-02T09:00:00Z'}]};const job={id:'fixed-retry-key',enrollment_id:'one',line_user_id:'owner',first_start:candidate.first_start,days_before:3};
let current={...candidate},saved=[],pushes=0,claimed=false,networkError=false,httpStatus=200;
const db={rpc:async()=>({data:claimed?[]:(claimed=true,[job])}),from(table){const q={select(){return q},eq(){return q},single:async()=>({data:current}),update(v){saved.push(v);return q},then(resolve){resolve({error:null})}};return q}};
const transport=async(url,opts)=>{if(url.endsWith('/info'))return Response.json({basicId:'@test'});pushes++;assert.equal(opts.headers['X-Line-Retry-Key'],job.id);const payload=JSON.parse(opts.body);assert.equal(payload.to,'owner');assert.match(payload.messages[0].text,/10:00/);if(networkError)throw Error('network');return new Response('{}',{status:httpStatus})};
(async()=>{
 assert.equal(eligible(candidate,job),true);assert.equal(eligible(candidate,job,new Date('2026-10-30T01:59Z')),false);assert.equal(eligible(candidate,job,new Date('2026-10-30T12:00Z')),false);assert.equal(eligible({...candidate,enrollment_status:'cancelled'},job),false);assert.equal(eligible({...candidate,line_user_id:'other'},job),false);assert.equal(eligible({...candidate,first_start:'2026-11-03T02:00Z'},job),false);assert.match(reminderMessage(candidate,3),/Bring pen/);
 let r=await processReminders(db,'token','@test',transport);assert.equal(r.accepted,1);assert.equal(pushes,1);await processReminders(db,'token','@test',transport);assert.equal(pushes,1);
 claimed=false;current.enabled=false;await processReminders(db,'token','@test',transport);assert.equal(pushes,1);assert.equal(saved.at(-1).status,'skipped');
 current.enabled=true;claimed=false;networkError=true;await processReminders(db,'token','@test',transport);assert.equal(saved.at(-1).status,'unknown');networkError=false;
 claimed=false;httpStatus=429;await processReminders(db,'token','@test',transport);assert.equal(saved.at(-1).status,'failed');
 await assert.rejects(processReminders(db,'token','@wrong',transport),/BOT_IDENTITY_FAILED/);
 await assert.rejects(reminderAdmin({action:'save_reminder_settings',enabled:true,locationText:'',notes:''},db,'admin'));
 console.log('PASS reminder eligibility, Taipei hours, schedule changes, cancellation/rebinding, claim dedup, disabled-after-claim, LINE retry key, uncertain/failed sends, bot identity, draft enable validation');
})().catch(e=>{console.error(e);process.exitCode=1});
