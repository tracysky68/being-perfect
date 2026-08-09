import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import { encryptPayuni, payuniHash } from "../_shared/payuni.ts";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";

function supabaseServerKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const current = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return current.default as string;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin === allowedOrigin ? origin : allowedOrigin);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST" || !allowedOrigin || origin !== allowedOrigin) return jsonResponse({ message: "Request not allowed" }, 403, cors);

  try {
    const payload = await request.json();
    const name = String(payload.name ?? "").trim();
    const email = String(payload.email ?? "").trim().toLowerCase();
    const phone = String(payload.phone ?? "").replace(/[\s-]/g, "");
    const courseCode = String(payload.courseCode ?? "").trim();
    const cohortId = String(payload.cohortId ?? "").trim();
    const pricingCode = String(payload.pricingCode ?? "").trim();
    const paymentOption = payload.paymentOption === "installments" ? "installments" : "full";
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || !/^\+?\d{8,15}$/.test(phone) || !courseCode || !cohortId || !pricingCode || payload.privacyConsent !== "on" || payload.termsConsent !== "on") {
      return jsonResponse({ message: "請確認必填資料與同意選項" }, 422, cors);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServerKey());
    const { data: cohort, error: cohortError } = await supabase.from("cohorts").select("id,title,course_id,active,courses!inner(code,active)").eq("id", cohortId).eq("courses.code", courseCode).single();
    if (cohortError || !cohort?.active || !(cohort.courses as { active: boolean }).active) return jsonResponse({ message: "此梯次目前無法報名" }, 409, cors);

    const { data: plan, error: planError } = await supabase.from("pricing_plans")
      .select("id,code,title,total_amount_twd,installment_count,installment_amount_twd,eligibility,active")
      .eq("course_id", cohort.course_id).eq("code", pricingCode).single();
    if (planError || !plan?.active) return jsonResponse({ message: "此價格方案目前無法使用" }, 409, cors);
    if (plan.eligibility !== "public") {
      const [{ data: emailMatch }, { data: phoneMatch }] = await Promise.all([
        supabase.from("eligibility_records").select("id").eq("eligibility", plan.eligibility).eq("email", email).eq("active", true).maybeSingle(),
        supabase.from("eligibility_records").select("id").eq("eligibility", plan.eligibility).eq("phone", phone).eq("active", true).maybeSingle()
      ]);
      if (!emailMatch && !phoneMatch) return jsonResponse({ message: "目前查不到家長班舊生資格，請改選一般學員，或聯絡玩美學協助核對" }, 422, cors);
    }

    const { data: student, error: studentError } = await supabase.from("students").upsert({ email, full_name: name, phone, updated_at: new Date().toISOString() }, { onConflict: "email" }).select("id").single();
    if (studentError) throw studentError;

    const orderNumber = `BP${Date.now()}${crypto.randomUUID().slice(0, 4)}`.replaceAll("-", "").toUpperCase();
    const now = new Date().toISOString();
    const invoiceType = payload.invoiceType === "company" ? "company" : "personal";
    const { data: enrollment, error: enrollmentError } = await supabase.from("enrollments").insert({
      order_number: orderNumber, student_id: student.id, cohort_id: cohort.id, amount_twd: plan.total_amount_twd,
      pricing_plan_id: plan.id, payment_option: paymentOption,
      invoice_type: invoiceType, tax_id: invoiceType === "company" ? String(payload.taxId ?? "").trim() : null,
      invoice_title: invoiceType === "company" ? String(payload.invoiceTitle ?? "").trim() : null,
      privacy_consent_at: now, terms_consent_at: now
    }).select("id").single();
    if (enrollmentError) throw enrollmentError;

    const { error: portalTokenError } = await supabase.from("enrollment_portal_tokens").insert({ enrollment_id: enrollment.id });
    if (portalTokenError) throw portalTokenError;

    const installmentRows = paymentOption === "installments"
      ? Array.from({ length: plan.installment_count }, (_, index) => ({ enrollment_id: enrollment.id, installment_number: index + 1, amount_twd: plan.installment_amount_twd }))
      : [{ enrollment_id: enrollment.id, installment_number: 1, amount_twd: plan.total_amount_twd }];
    const { data: installments, error: installmentError } = await supabase.from("payment_installments").insert(installmentRows).select("id,installment_number,amount_twd");
    if (installmentError) throw installmentError;
    const firstInstallment = installments?.find((item) => item.installment_number === 1);
    if (!firstInstallment) throw new Error("Unable to create first installment");
    const chargeAmount = firstInstallment.amount_twd;
    const { error: transactionError } = await supabase.from("payment_transactions").insert({
      enrollment_id: enrollment.id, payment_installment_id: firstInstallment.id,
      merchant_order_number: orderNumber, amount_twd: chargeAmount
    });
    if (transactionError) throw transactionError;

    const merchantId = Deno.env.get("PAYUNI_MERCHANT_ID")!;
    const hashKey = Deno.env.get("PAYUNI_HASH_KEY")!;
    const hashIv = Deno.env.get("PAYUNI_HASH_IV")!;
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL")!.replace(/\/$/, "");
    const functionBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const encrypted = await encryptPayuni({
      MerID: merchantId, MerTradeNo: orderNumber, TradeAmt: String(chargeAmount), Timestamp: String(Math.floor(Date.now() / 1000)),
      ProdDesc: `${String(cohort.title)}｜${String(plan.title)}${paymentOption === "installments" ? "第1期" : ""}`.slice(0, 50), UsrMail: email,
      ReturnURL: `${functionBase}/payuni-return`, NotifyURL: `${functionBase}/payuni-notify`
    }, hashKey, hashIv);

    return jsonResponse({
      paymentUrl: Deno.env.get("PAYUNI_ENV") === "production" ? "https://api.payuni.com.tw/api/upp" : "https://sandbox-api.payuni.com.tw/api/upp",
      fields: { MerID: merchantId, Version: "1.0", EncryptInfo: encrypted, HashInfo: await payuniHash(encrypted, hashKey, hashIv) }
    }, 201, cors);
  } catch (error) {
    console.error("create-payment", error);
    return jsonResponse({ message: "訂單建立失敗，請稍後再試" }, 500, cors);
  }
});
