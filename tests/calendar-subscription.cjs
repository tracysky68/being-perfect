const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('/tmp/bp-training-test-tools/node_modules/typescript');
const {webcrypto}=require('node:crypto');
function compile(path){const result=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(result.diagnostics.length,0);return result.outputText;}
const context={exports:{},crypto:webcrypto,TextEncoder,Date};vm.runInNewContext(compile('supabase/functions/_shared/course-calendar-feed.ts'),context);const helper=context.exports;
const sample={id:'one',status:'paid',cohort_id:'training',cohorts:{courses:{code:'TEACHER-TRAINING',title:'創感力'}},enrollment_sessions:[]};
let registrations=[sample],sessions=[{id:'session1',cohort_id:'training',title:'第一天',starts_at:'2026-12-20T10:00:00+08:00',ends_at:'2026-12-20T17:00:00+08:00'}],bound=true,sub=true,queryError=false;
const client={from(table){let filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},in(k,v){filters[k]=v;return q},maybeSingle(){return q},then(resolve){if(queryError)return resolve({error:Error('db down')});let data;if(table==='course_calendar_subscriptions'){assert.equal(filters.token_hash,validHash);data=sub?{student_id:'owner'}:null}else if(table==='course_line_bindings'){assert.equal(filters.student_id,'owner');data=bound?{verified_email:'owner@example.test',students:{email:'owner@example.test'}}:null}else if(table==='enrollments'){assert.equal(filters.student_id,'owner');data=registrations}else if(table==='training_sessions'){assert.deepEqual(Array.from(filters.cohort_id),['training']);data=sessions}else throw Error(table);return resolve({data,error:null})}};return q}};
let validHash,handler;
(async()=>{
 const token=await helper.subscriptionToken('seed','secret');validHash=await helper.digest(token);
 assert.equal(token.length,64);assert.equal(token,await helper.subscriptionToken('seed','secret'));assert.notEqual(token,await helper.subscriptionToken('new-seed','secret'));
 const events=await helper.calendarEvents(client,'owner');const first=helper.renderCalendar(events,'2026-10-30T00:00:00Z');assert.match(first,/DTSTART:20261220T020000Z/);assert.match(first,/DTEND:20261220T090000Z/);
 sessions[0].starts_at='2026-12-21T10:00:00+08:00';sessions[0].ends_at='2026-12-21T17:00:00+08:00';const changed=helper.renderCalendar(await helper.calendarEvents(client,'owner'));assert.match(changed,/DTSTART:20261221T020000Z/);assert.equal(first.match(/UID:.+/)[0],changed.match(/UID:.+/)[0]);
 sample.status='cancelled';assert.match(helper.renderCalendar(await helper.calendarEvents(client,'owner')),/STATUS:CANCELLED/);sample.status='paid';
 const teacher={id:'two',status:'paid',cohort_id:'teacher',cohorts:{courses:{code:'TEACHER-DIALOGUE',title:'教師專班'}},enrollment_sessions:[{status:'waitlisted',course_sessions:sessions[0]},{status:'confirmed',course_sessions:{...sessions[0],id:'confirmed'}}]};registrations.push(teacher);assert.equal((await helper.calendarEvents(client,'owner')).length,2);
 const escaped=helper.renderCalendar([{uid:'x',title:'中文'.repeat(100)+'\r\nATTENDEE:hacker',starts_at:sessions[0].starts_at,ends_at:sessions[0].ends_at}]);for(const line of escaped.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);assert.ok(!escaped.includes('\r\nATTENDEE:'));assert.ok(!first.includes('owner@example'));
 const ctx={exports:{},require:p=>p.includes('supabase-js')?{createClient:()=>client}:helper,Deno:{env:{get:()=>''},serve:h=>handler=h},Request,Response,URL};vm.runInNewContext(compile('supabase/functions/course-calendar-feed/index.ts'),ctx);
 const request=t=>new Request('https://example.test/feed?token='+t);
 assert.equal((await handler(request('bad'))).status,404);
 let response=await handler(request(token));assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/calendar/);assert.match(await response.text(),/BEGIN:VCALENDAR/);
 sub=false;assert.equal((await handler(request(token))).status,404);sub=true;bound=false;assert.equal((await handler(request(token))).status,404);bound=true;queryError=true;assert.equal((await handler(request(token))).status,503);queryError=false;
 assert.equal((await handler(new Request('https://example.test/feed?token='+token,{method:'POST'}))).status,405);
 console.log('PASS: private ownership scope, deterministic secret tokens, rotation, revoked/unlinked denial, rescheduling stable UID, cancellation, waitlist exclusion, Taipei times, ICS injection/folding, DB failure response');
})().catch(e=>{console.error(e);process.exitCode=1});
