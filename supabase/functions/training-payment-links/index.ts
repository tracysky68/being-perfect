import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {corsHeaders,jsonResponse} from "../_shared/http.ts";
const allowedOrigin=Deno.env.get("ALLOWED_ORIGIN")??"";
Deno.serve(async request=>{
 const origin=request.headers.get("origin")??"";const cors=corsHeaders(allowedOrigin);
 if(request.method==="OPTIONS")return new Response(null,{headers:cors});
 if(request.method!=="GET"||!allowedOrigin||origin!==allowedOrigin)return jsonResponse({message:"Request not allowed"},403,cors);
 try{
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default;
  const db=createClient(Deno.env.get("SUPABASE_URL")!,key);
  const {data,error}=await db.from("training_payment_links").select("cohort_id,channel,payment_url,amount_twd,training_cohort_settings!inner(cohorts!inner(title,price_twd,courses!inner(code)))").eq("active",true);
  if(error)throw error;
  const links=(data??[]).filter((r:any)=>r.training_cohort_settings?.cohorts?.courses?.code==="TEACHER-TRAINING"&&r.amount_twd===r.training_cohort_settings.cohorts.price_twd).map((r:any)=>({cohortId:r.cohort_id,title:r.training_cohort_settings.cohorts.title,channel:r.channel,url:r.payment_url,amountTwd:r.amount_twd}));
  return jsonResponse({links},200,cors);
 }catch{return jsonResponse({message:"付款資訊載入失敗，請稍後再試。"},500,cors);}
});
