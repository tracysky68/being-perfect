import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const corsHeaders = (origin: string) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" });
const json = (body: unknown, status: number, headers: HeadersInit) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
function serverKey() { const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if(legacy)return legacy; return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default as string; }

Deno.serve(async (request) => {
  const origin=request.headers.get("origin")??""; const cors=corsHeaders(origin===allowedOrigin?origin:allowedOrigin);
  if(request.method==="OPTIONS")return new Response(null,{headers:cors});
  if(request.method!=="GET"||!allowedOrigin||origin!==allowedOrigin)return json({message:"Request not allowed"},403,cors);
  const token=(request.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");
  if(!token)return json({message:"請先登入"},401,cors);
  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,serverKey());
  const {data:{user},error:userError}=await supabase.auth.getUser(token);
  const allowedEmails=(Deno.env.get("ADMIN_EMAILS")??"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(userError||!user?.email||!allowedEmails.includes(user.email.toLowerCase()))return json({message:"沒有管理權限"},403,cors);

  const {data:enrollments,error}=await supabase.from("enrollments").select("id,order_number,status,amount_twd,payment_option,paid_at,created_at,students!inner(full_name,email,phone),cohorts!inner(title),pricing_plans(title),payment_transactions(status,provider_trade_number,verified_at),email_deliveries(template,status,attempts,last_error,sent_at),teacher_intake_responses(role_title,organization,teaching_years,student_age_groups,art_background,education_background,main_challenges,focus_questions,learning_expectations,case_description,artwork_permission,additional_notes,submitted_at),enrollment_sessions(module,status,course_sessions(title,starts_at,ends_at,schedule_type))").order("created_at",{ascending:false}).limit(500);
  if(error){console.error(error);return json({message:"無法讀取學員資料"},500,cors);}
  const records=(enrollments??[]).map((row:any)=>{
    const student=row.students; const intake=Array.isArray(row.teacher_intake_responses)?row.teacher_intake_responses[0]:row.teacher_intake_responses;
    const delivery=(row.email_deliveries??[]).find((item:any)=>item.template==="payment_confirmed_teacher_intake");
    return {id:row.id,orderNumber:row.order_number,status:row.status,amountTwd:row.amount_twd,paymentOption:row.payment_option,paymentOptionLabel:row.payment_option==="installments"?"三期":"一次付清",paidAt:row.paid_at,createdAt:row.created_at,name:student.full_name,email:student.email,phone:student.phone,cohort:row.cohorts.title,planTitle:row.pricing_plans?.title??"",paymentTransactions:row.payment_transactions??[],emailStatus:delivery?.status??"none",emailStatusLabel:delivery?.status==="sent"?"已寄送":delivery?.status==="failed"?"寄送失敗":"尚未寄送",emailError:delivery?.last_error??null,sessions:(row.enrollment_sessions??[]).filter((s:any)=>["confirmed","admin_assigned"].includes(s.status)).map((s:any)=>({module:s.module,title:s.course_sessions?.title??"",startsAt:s.course_sessions?.starts_at,endsAt:s.course_sessions?.ends_at,scheduleType:s.course_sessions?.schedule_type})),intake:intake?{currentRole:intake.role_title,organization:intake.organization??"",teachingYears:intake.teaching_years,studentAgeGroups:intake.student_age_groups??[],artBackground:intake.art_background,educationBackground:intake.education_background,mainChallenges:intake.main_challenges??[],focusQuestions:intake.focus_questions,learningExpectations:intake.learning_expectations,caseDescription:intake.case_description??"",artworkPermission:intake.artwork_permission,additionalNotes:intake.additional_notes??"",submittedAt:intake.submitted_at}:null};
  });
  return json({records},200,cors);
});

