import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
});
const json = (body: unknown, status: number, headers: HeadersInit) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
});
function serverKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default as string;
}
const safe = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function authenticate(request: Request, supabase: ReturnType<typeof createClient>) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  const allowed = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return !error && user?.email && allowed.includes(user.email.toLowerCase()) ? user : null;
}

async function createManualEnrollment(request: Request, supabase: ReturnType<typeof createClient>, userEmail: string, cors: HeadersInit) {
  const payload = await request.json();
  if (payload.action === "resend_intake_email") return await resendIntakeEmail(payload, supabase, userEmail, cors);
  if (payload.action !== "create_manual_paid") return json({ message: "不支援的操作" }, 400, cors);
  const name = String(payload.name ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const phone = String(payload.phone ?? "").replace(/[\s-]/g, "");
  const cohortId = String(payload.cohortId ?? "");
  const amount = Number(payload.amountTwd);
  const paidDate = String(payload.paidDate ?? "");
  const method = String(payload.manualMethod ?? "");
  const notes = String(payload.adminNotes ?? "").trim();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?\d{8,15}$/.test(phone) || !Number.isInteger(amount) || amount < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || !["bank_transfer", "payuni_link", "cash", "other"].includes(method)) {
    return json({ message: "請確認所有必填資料" }, 422, cors);
  }
  const { data: cohort } = cohortId
    ? await supabase.from("cohorts").select("id,title,active").eq("id", cohortId).single()
    : await supabase.from("cohorts").select("id,title,active").eq("title", "待學員選擇月份").single();
  if (!cohort || (cohortId && !cohort.active)) return json({ message: "此梯次目前無法使用" }, 409, cors);
  const { data: existingStudent } = await supabase.from("students").select("id").eq("email", email).maybeSingle();
  if (existingStudent) {
    const { data: duplicate } = await supabase.from("enrollments").select("id").eq("student_id", existingStudent.id).eq("cohort_id", cohort.id).in("status", ["paid", "partially_paid"]).maybeSingle();
    if (duplicate) return json({ message: "這位學員在同一梯次已有已付款紀錄" }, 409, cors);
  }
  const { data: student, error: studentError } = await supabase.from("students").upsert({ email, full_name: name, phone, updated_at: new Date().toISOString() }, { onConflict: "email" }).select("id").single();
  if (studentError) throw studentError;
  const paidAt = new Date(`${paidDate}T12:00:00+08:00`).toISOString();
  const orderNumber = `MAN${Date.now()}${crypto.randomUUID().slice(0, 4)}`.replaceAll("-", "").toUpperCase();
  const { data: enrollment, error: enrollmentError } = await supabase.from("enrollments").insert({
    order_number: orderNumber, student_id: student.id, cohort_id: cohort.id, status: "paid", amount_twd: amount,
    payment_option: "full", payment_source: "manual", admin_notes: notes || null,
    privacy_consent_at: paidAt, terms_consent_at: paidAt, paid_at: paidAt,
  }).select("id").single();
  if (enrollmentError) throw enrollmentError;
  const { data: portal, error: portalError } = await supabase.from("enrollment_portal_tokens").insert({ enrollment_id: enrollment.id }).select("token").single();
  if (portalError) throw portalError;
  const { data: installment, error: installmentError } = await supabase.from("payment_installments").insert({ enrollment_id: enrollment.id, installment_number: 1, amount_twd: amount, status: "paid", paid_at: paidAt }).select("id").single();
  if (installmentError) throw installmentError;
  await supabase.from("payment_transactions").insert({ enrollment_id: enrollment.id, payment_installment_id: installment.id, provider: "manual", merchant_order_number: orderNumber, status: "verified", amount_twd: amount, payment_method: method, hash_verified: false, notified_at: paidAt, verified_at: paidAt, raw_notification: { entered_by: userEmail } });
  await supabase.from("audit_logs").insert({ entity_type: "enrollment", entity_id: enrollment.id, action: "manual_payment_confirmed", actor: userEmail, details: { method, amount } });

  let emailSent = false;
  let emailError: string | null = null;
  const emailRequested = payload.sendEmail === "on";
  if (emailRequested) {
    const intakeUrl = `${(Deno.env.get("PUBLIC_SITE_URL") ?? "https://beingperfect.com.tw").replace(/\/$/, "")}/teacher-intake.html?token=${encodeURIComponent(portal.token)}`;
    const html = `<!doctype html><html lang="zh-Hant"><body style="margin:0;background:#f8f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#171717"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:2px solid #171717;border-radius:20px;padding:32px"><p style="color:#eb5656;font-weight:700">玩美學 Being Perfect</p><h1 style="font-size:28px">付款已確認，歡迎加入教師專班</h1><p>${safe(name)} 您好：</p><p style="line-height:1.8">我們已確認您的付款。請點選下方按鈕，完成兩天上課日期與課前背景資料。</p><p><strong>梯次：</strong>${safe(cohort.title)}<br><strong>訂單編號：</strong>${orderNumber}</p><p style="margin:28px 0"><a href="${intakeUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:10px">填寫上課日期與課前資料</a></p><p style="font-size:13px;color:#666">此連結為您的專屬連結，請勿轉傳。</p></div></div></body></html>`;
    const { data: delivery } = await supabase.from("email_deliveries").insert({ enrollment_id: enrollment.id, template: "payment_confirmed_teacher_intake", recipient: email, status: "pending", attempts: 1 }).select("id").single();
    try {
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "玩美學 <course@mail.beingperfect.com.tw>", to: [email], subject: "付款確認｜請完成上課日期與課前資料", html }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.message ?? `HTTP ${response.status}`);
      emailSent = true;
      await supabase.from("email_deliveries").update({ status: "sent", provider_message_id: result.id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    } catch (error) {
      emailError = String(error);
      await supabase.from("email_deliveries").update({ status: "failed", last_error: emailError.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    }
  }
  return json({ id: enrollment.id, orderNumber, emailRequested, emailSent, emailError }, 201, cors);
}

async function resendIntakeEmail(payload: any, supabase: ReturnType<typeof createClient>, userEmail: string, cors: HeadersInit) {
  const enrollmentId = String(payload.enrollmentId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId)) return json({ message: "學員資料不正確" }, 422, cors);
  const { data: enrollment, error } = await supabase.from("enrollments")
    .select("id,order_number,status,students!inner(full_name,email),cohorts!inner(title),enrollment_portal_tokens!inner(token)")
    .eq("id", enrollmentId).single();
  if (error || !enrollment || !["paid", "partially_paid"].includes(enrollment.status)) return json({ message: "找不到可寄送的已付款學員" }, 404, cors);
  const student = Array.isArray(enrollment.students) ? enrollment.students[0] : enrollment.students;
  const cohort = Array.isArray(enrollment.cohorts) ? enrollment.cohorts[0] : enrollment.cohorts;
  const portal = Array.isArray(enrollment.enrollment_portal_tokens) ? enrollment.enrollment_portal_tokens[0] : enrollment.enrollment_portal_tokens;
  const intakeUrl = `${(Deno.env.get("PUBLIC_SITE_URL") ?? "https://beingperfect.com.tw").replace(/\/$/, "")}/teacher-intake.html?token=${encodeURIComponent(portal.token)}`;
  const html = `<!doctype html><html lang="zh-Hant"><body style="margin:0;background:#f8f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#171717"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:2px solid #171717;border-radius:20px;padding:32px"><p style="color:#eb5656;font-weight:700">玩美學 Being Perfect</p><h1 style="font-size:28px">付款已確認，歡迎加入教師專班</h1><p>${safe(student.full_name)} 您好：</p><p style="line-height:1.8">我們已確認您的付款。請點選下方按鈕，選擇上課月份、兩天上課日期，並完成課前背景資料。</p><p><strong>梯次：</strong>${safe(cohort.title)}<br><strong>訂單編號：</strong>${safe(enrollment.order_number)}</p><p style="margin:28px 0"><a href="${intakeUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:10px">填寫上課日期與課前資料</a></p><p style="font-size:13px;color:#666">此連結為您的專屬連結，請勿轉傳。</p></div></div></body></html>`;
  const { data: delivery } = await supabase.from("email_deliveries").upsert({ enrollment_id: enrollment.id, template: "payment_confirmed_teacher_intake", recipient: student.email, status: "pending", attempts: 1, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "enrollment_id,template" }).select("id").single();
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "玩美學 <course@mail.beingperfect.com.tw>", to: [student.email], subject: "付款確認｜請選擇上課月份並完成課前資料", html }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.message ?? `HTTP ${response.status}`);
    await supabase.from("email_deliveries").update({ status: "sent", provider_message_id: result.id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    await supabase.from("audit_logs").insert({ entity_type: "enrollment", entity_id: enrollment.id, action: "intake_email_resent", actor: userEmail, details: { recipient: student.email } });
    return json({ emailSent: true }, 200, cors);
  } catch (sendError) {
    await supabase.from("email_deliveries").update({ status: "failed", last_error: String(sendError).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    return json({ message: "信件寄送失敗" }, 502, cors);
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin === allowedOrigin ? origin : allowedOrigin);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!["GET", "POST"].includes(request.method) || !allowedOrigin || origin !== allowedOrigin) return json({ message: "Request not allowed" }, 403, cors);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
  const user = await authenticate(request, supabase);
  if (!user?.email) return json({ message: "沒有管理權限" }, 403, cors);
  try {
    if (request.method === "POST") return await createManualEnrollment(request, supabase, user.email, cors);
    const [{ data: enrollments, error }, { data: cohorts }] = await Promise.all([
      supabase.from("enrollments").select("id,order_number,status,amount_twd,payment_option,payment_source,admin_notes,paid_at,created_at,students!inner(full_name,email,phone),cohorts!inner(title),pricing_plans(title),payment_transactions(status,provider_trade_number,verified_at),email_deliveries(template,status,attempts,last_error,sent_at),teacher_intake_responses(role_title,organization,teaching_years,student_age_groups,art_background,education_background,main_challenges,focus_questions,learning_expectations,case_description,artwork_permission,additional_notes,submitted_at),enrollment_sessions(module,status,course_sessions(title,starts_at,ends_at,schedule_type))").order("created_at", { ascending: false }).limit(500),
      supabase.from("cohorts").select("id,title").eq("active", true).order("starts_at"),
    ]);
    if (error) return json({ message: "無法讀取學員資料" }, 500, cors);
    const records = (enrollments ?? []).map((row: any) => {
      const intake = Array.isArray(row.teacher_intake_responses) ? row.teacher_intake_responses[0] : row.teacher_intake_responses;
      const delivery = (row.email_deliveries ?? []).find((item: any) => item.template === "payment_confirmed_teacher_intake");
      return { id: row.id, orderNumber: row.order_number, status: row.status, amountTwd: row.amount_twd, paymentOption: row.payment_option, paymentOptionLabel: row.payment_option === "installments" ? "三期" : "一次付清", paymentSource: row.payment_source, adminNotes: row.admin_notes, paidAt: row.paid_at, createdAt: row.created_at, name: row.students.full_name, email: row.students.email, phone: row.students.phone, cohort: row.cohorts.title, planTitle: row.pricing_plans?.title ?? "", paymentTransactions: row.payment_transactions ?? [], emailStatus: delivery?.status ?? "none", emailStatusLabel: delivery?.status === "sent" ? "已寄送" : delivery?.status === "failed" ? "寄送失敗" : "尚未寄送", emailError: delivery?.last_error ?? null, sessions: (row.enrollment_sessions ?? []).filter((session: any) => ["confirmed", "admin_assigned"].includes(session.status)).map((session: any) => ({ module: session.module, title: session.course_sessions?.title ?? "", startsAt: session.course_sessions?.starts_at, endsAt: session.course_sessions?.ends_at, scheduleType: session.course_sessions?.schedule_type })), intake: intake ? { currentRole: intake.role_title, organization: intake.organization ?? "", teachingYears: intake.teaching_years, studentAgeGroups: intake.student_age_groups ?? [], artBackground: intake.art_background, educationBackground: intake.education_background, mainChallenges: intake.main_challenges ?? [], focusQuestions: intake.focus_questions, learningExpectations: intake.learning_expectations, caseDescription: intake.case_description ?? "", artworkPermission: intake.artwork_permission, additionalNotes: intake.additional_notes ?? "", submittedAt: intake.submitted_at } : null };
    });
    return json({ records, cohorts: cohorts ?? [] }, 200, cors);
  } catch (error) {
    console.error("admin-dashboard", error);
    return json({ message: "操作失敗，請稍後再試" }, 500, cors);
  }
});
