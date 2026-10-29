import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPayuni, payuniHash, secureEqual } from '../_shared/payuni.ts';
import { validateUop } from '../_shared/payuni-uop.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

async function notifyStudent(db:ReturnType<typeof createClient>, id:string) {
 const template='payment_confirmed_teacher_intake';
 const {data:row,error}=await db.from('enrollments').select('status,contact_snapshot,cohorts(title),enrollment_portal_tokens(token,active)').eq('id',id).single();
 if(error||!row)throw new Error('EMAIL_RECORD_UNAVAILABLE');
 if(row.status!=='paid')return;
 const token=row.enrollment_portal_tokens as unknown as {token:string;active:boolean};
 if(!token?.active)return;
 const {error:insertError}=await db.from('email_deliveries').upsert({enrollment_id:id,template,recipient:row.contact_snapshot.email},{onConflict:'enrollment_id,template',ignoreDuplicates:true});
 if(insertError)throw new Error('EMAIL_QUEUE_FAILED');
 const {data:delivery,error:readError}=await db.from('email_deliveries').select('id,status,attempts').eq('enrollment_id',id).eq('template',template).single();
 if(readError||!delivery)throw new Error('EMAIL_QUEUE_UNAVAILABLE');
 if(delivery.status==='sent')return;
 const key=Deno.env.get('RESEND_API_KEY');const site=Deno.env.get('PUBLIC_SITE_URL');const from=Deno.env.get('EMAIL_FROM');
 if(!key||!site||!from)throw new Error('EMAIL_CONFIG_REQUIRED');
 const link=`${site.replace(/\/$/,'')}/training-intake.html?token=${encodeURIComponent(token.token)}`;
 const cohort=row.cohorts as unknown as {title:string};
 const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`uop-confirmed-${id}`},body:JSON.stringify({from,to:[row.contact_snapshot.email],subject:'創感力師資培訓｜付款確認與課前問卷',html:`<p>${esc(row.contact_snapshot.name)} 您好：</p><p>已確認您的 ${esc(cohort.title)} 課程款項 NT$39,800。</p><p><a href="${esc(link)}">填寫課前問卷</a></p><p>這是您的專屬連結，請勿轉傳。若您為他人代付，請聯絡課程行政確認參訓學員資料。</p>`})});
 const result=await response.json();
 const {error:saveError}=await db.from('email_deliveries').update({status:response.ok?'sent':'failed',attempts:delivery.attempts+1,provider_message_id:response.ok?result.id:null,sent_at:response.ok?new Date().toISOString():null,last_error:response.ok?null:`Email HTTP ${response.status}`,updated_at:new Date().toISOString()}).eq('id',delivery.id);
 if(!response.ok||saveError)throw new Error('EMAIL_DELIVERY_FAILED');
}

export async function handleUop(request:Request) {
 if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
 if(Deno.env.get('PAYUNI_UOP_ENABLED')!=='true')return new Response('Not configured',{status:503});
 const key=Deno.env.get('PAYUNI_UOP_HASH_KEY'),iv=Deno.env.get('PAYUNI_UOP_HASH_IV'),merchant=Deno.env.get('PAYUNI_UOP_MERCHANT_ID'),linkName=Deno.env.get('PAYUNI_UOP_LINK_NAME');
 if(!key||!iv||!merchant||!linkName)return new Response('Configuration required',{status:503});
 let input:Record<string,unknown>,details:Record<string,string>;
 try {
  const text=await request.text();if(text.length>65536)return new Response('Too large',{status:413});
  input=request.headers.get('content-type')?.includes('application/json')?JSON.parse(text):Object.fromEntries(new URLSearchParams(text));
  if(String(input.MerID)!==merchant||String(input.Version)!=='1.0')return new Response('Source mismatch',{status:400});
  const encrypted=String(input.EncryptInfo??''),hash=String(input.HashInfo??'');
  if(!/^[A-Fa-f0-9]{64}$/.test(hash)||!secureEqual(hash.toUpperCase(),await payuniHash(encrypted,key,iv)))return new Response('Hash mismatch',{status:400});
  details=await decryptPayuni(encrypted,key,iv);
 }catch{return new Response('Invalid notification',{status:400});}
 try {
  const paid=validateUop(details,merchant,linkName);
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')??'{}').default;
  const db=createClient(Deno.env.get('SUPABASE_URL')!,service);
  if(!paid){
   // Late failure notifications never downgrade a verified payment. Refunds need review.
   if(details.TradeStatus==='5'){
    const {data:receipt,error}=await db.from('payuni_uop_receipts').select('enrollment_id').eq('merchant_id',merchant).eq('trade_no',details.No).maybeSingle();
    if(error)throw new Error('REFUND_LOOKUP_FAILED');
    if(receipt?.enrollment_id){
     const {error:updateError}=await db.from('enrollments').update({status:'refunding',updated_at:new Date().toISOString()}).eq('id',receipt.enrollment_id).eq('status','paid');
     if(updateError)throw new Error('REFUND_REVIEW_FAILED');
    }
   }
   return new Response('SUCCESS');
  }
  const {data:id,error}=await db.rpc('import_payuni_uop_paid',{payment:{...paid,tradeStatus:'1'}});
  if(error||!id)throw new Error('IMPORT_FAILED');
  await notifyStudent(db,id);
  return new Response('SUCCESS');
 }catch(error){
  // Do not log decrypted payloads, student identifiers, or merchant keys.
  const code=error instanceof Error?error.message:'PROCESSING_FAILED';
  console.error('payuni-uop-notify',/^[A-Z_]+$/.test(code)?code:'PROCESSING_FAILED');
  return new Response('Notification requires retry or review',{status:503});
 }
}
Deno.serve(handleUop);
