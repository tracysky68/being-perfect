const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM(fs.readFileSync('admin.html','utf8'),{url:'http://localhost/preview/admin.html',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.BP_CONFIG={};w.createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:'DEMO'}}}),onAuthStateChange:()=>{}}});
 w.fetch=async()=>({ok:true,status:200,json:async()=>require('../scripts/course-preview-data.cjs')});
 w.eval(fs.readFileSync('revenue.js','utf8'));
 w.eval(fs.readFileSync('admin-reminders.js','utf8').replace('export function','function')); 
 await w.eval('(async()=>{'+fs.readFileSync('admin.js','utf8').replace(/^import .*\n/gm,'')+'})()');
 await new Promise(r=>setTimeout(r,20));
 const check=(code,count,received,expected)=>{w.document.querySelector(`[data-course-scope="${code}"]`).click();assert.equal(w.document.querySelectorAll('#students-body tr').length,count);assert.equal(w.document.querySelector('#revenue-received').textContent,received);assert.equal(w.document.querySelector(`[data-course-scope="${code}"]`).getAttribute('aria-pressed'),'true');};
 check('TEACHER-DIALOGUE',1,'NT$13,800','NT$13,800');check('TEACHER-TRAINING',2,'NT$49,800','NT$79,600');check('',3,'NT$63,600','NT$93,400');

 w.document.querySelector('#status-filter').value='missing';w.document.querySelector('#search-input').value='不存在';check('TEACHER-DIALOGUE',1,'NT$13,800','NT$13,800');
 w.document.querySelector('#revenue-history-button').click();assert.equal(w.document.querySelector('#revenue-history-dialog').open,true);assert.equal(w.document.querySelectorAll('#revenue-months tr').length,Number(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei',month:'2-digit'})));w.document.querySelector('#revenue-course').value='TEACHER-TRAINING';w.document.querySelector('#revenue-course').dispatchEvent(new w.Event('change'));assert.match(w.document.querySelector('#revenue-statistics').textContent,/NT\$49,800/);let csv='';w.Blob=function(parts){csv=parts.join('')};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};w.document.querySelector('#revenue-export').click();assert.match(csv,/月份,已確認收款TWD/);assert.match(csv,/49800,2,2/);w.document.querySelector('#revenue-history-close').click();assert.equal(w.document.querySelector('#revenue-history-dialog').open,false);
 console.log('PASS shared admin entry: distinct rosters, monthly totals and history dialog, combined totals, filter reset');dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});
