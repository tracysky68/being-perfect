import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPayuni, payuniHash, secureEqual } from "../_shared/payuni.ts";

function supabaseServerKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const current = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return current.default as string;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendPaymentEmail(supabase: ReturnType<typeof createClient>, enrollmentId: string) {
  const template = "payment_confirmed_teacher_intake";
  const { data: enrollment, error } = await supabase.from("enrollments")
    .select("order_number,amount_twd,students!inner(full_name,email),cohorts!inner(title),enrollment_portal_tokens!inner(token,active)")
    .eq("id", enrollmentId).eq("enrollment_portal_tokens.active", true).single();
  if (error || !enrollment) throw error ?? new Error("Enrollment email data unavailable");

  const student = enrollment.students as unknown as { full_name: string; email: string };
  const cohort = enrollment.cohorts as unknown as { title: string };
  const portal = enrollment.enrollment_portal_tokens as unknown as { token: string; active: boolean };
  const { data: delivery, error: deliveryError } = await supabase.from("email_deliveries").upsert({
    enrollment_id: enrollmentId, template, recipient: student.email,
  }, { onConflict: "enrollment_id,template", ignoreDuplicates: true }).select("id,status,attempts").maybeSingle();
  if (deliveryError) throw deliveryError;

  const { data: current } = delivery ? { data: delivery } : await supabase.from("email_deliveries")
    .select("id,status,attempts").eq("enrollment_id", enrollmentId).eq("template", template).single();
  if (!current || current.status === "sent") return;

  const publicSite = Deno.env.get("PUBLIC_SITE_URL") ?? "https://beingperfect.com.tw";
  const intakeUrl = `${publicSite.replace(/\/$/, "")}/teacher-intake.html?token=${encodeURIComponent(portal.token)}`;
  const amount = Number(enrollment.amount_twd).toLocaleString("zh-TW");
  const html = `<!doctype html><html lang="zh-Hant"><body style="margin:0;background:#f8f6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC',sans-serif;color:#171717"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:2px solid #171717;border-radius:20px;padding:32px"><p style="margin:0 0 10px;color:#eb5656;font-weight:700">玩美學 Being Perfect</p><h1 style="font-size:28px;line-height:1.35;margin:0 0 18px">付款已確認，歡迎加入教師專班</h1><p>${escapeHtml(student.full_name)} 您好：</p><p style="line-height:1.8">我們已收到您的款項。請點選下方按鈕，完成兩天上課日期與課前背景資料，讓講師能在課前更了解您的教學需求。</p><p style="line-height:1.8"><strong>梯次：</strong>${escapeHtml(cohort.title)}<br><strong>本次款項：</strong>NT$${amount}<br><strong>訂單編號：</strong>${escapeHtml(enrollment.order_number)}</p><p style="margin:28px 0"><a href="${intakeUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:10px">填寫上課日期與課前資料</a></p><p style="font-size:14px;line-height:1.7;color:#666">此連結為您的專屬連結，請勿轉傳。如按鈕無法開啟，可複製以下網址：<br><a href="${intakeUrl}" style="color:#eb5656;word-break:break-all">${intakeUrl}</a></p></div></div></body></html>`;

  await supabase.from("email_deliveries").update({ status: "pending", attempts: current.attempts + 1, last_error: null, updated_at: new Date().toISOString() }).eq("id", current.id);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "玩美學 <course@mail.beingperfect.com.tw>", to: [student.email], subject: "付款確認｜請完成上課日期與課前資料", html }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.message ?? `Resend HTTP ${response.status}`);
    await supabase.from("email_deliveries").update({ status: "sent", provider_message_id: result.id, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", current.id);
  } catch (emailError) {
    await supabase.from("email_deliveries").update({ status: "failed", last_error: String(emailError).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", current.id);
    throw emailError;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    const contentType = request.headers.get("content-type") ?? "";
    const input = contentType.includes("application/json") ? await request.json() : Object.fromEntries((await request.formData()).entries());
    const encrypted = String(input.EncryptInfo ?? "");
    const receivedHash = String(input.HashInfo ?? "");
    const hashKey = Deno.env.get("PAYUNI_HASH_KEY")!;
    const hashIv = Deno.env.get("PAYUNI_HASH_IV")!;
    const expectedHash = await payuniHash(encrypted, hashKey, hashIv);
    if (!secureEqual(receivedHash.toUpperCase(), expectedHash)) return new Response("Hash mismatch", { status: 400 });

    const details = await decryptPayuni(encrypted, hashKey, hashIv);
    const orderNumber = details.MerTradeNo;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServerKey());
    const { data: transaction } = await supabase.from("payment_transactions")
      .select("id,enrollment_id,payment_installment_id,amount_twd,enrollments!inner(id,status)")
      .eq("merchant_order_number", orderNumber).single();
    const enrollment = transaction?.enrollments as { id: string; status: string } | undefined;
    if (!transaction || !enrollment || Number(details.TradeAmt) !== transaction.amount_twd) {
      if (transaction) await supabase.from("payment_transactions").update({ status: "needs_review", raw_notification: details, hash_verified: true, notified_at: new Date().toISOString() }).eq("id", transaction.id);
      return new Response("Order mismatch", { status: 409 });
    }

    // PAYUNi 各 API 版本的成功欄位須以商店後台最新版文件及 sandbox 實測確認。
    const success = ["SUCCESS", "1", "00"].includes(String(details.Status ?? details.TradeStatus ?? "").toUpperCase());
    const timestamp = new Date().toISOString();
    await supabase.from("payment_transactions").update({
      provider_trade_number: details.TradeNo ?? null, status: success ? "verified" : "failed",
      payment_method: details.PaymentType ?? details.PayType ?? null, raw_notification: details,
      hash_verified: true, notified_at: timestamp, verified_at: success ? timestamp : null
    }).eq("id", transaction.id);
    if (success) {
      if (transaction.payment_installment_id) {
        await supabase.from("payment_installments").update({ status: "paid", paid_at: timestamp, updated_at: timestamp }).eq("id", transaction.payment_installment_id);
      }
      const { count: unpaidCount } = await supabase.from("payment_installments")
        .select("id", { count: "exact", head: true }).eq("enrollment_id", enrollment.id).neq("status", "paid");
      const fullyPaid = unpaidCount === 0;
      await supabase.from("enrollments").update({ status: fullyPaid ? "paid" : "partially_paid", paid_at: fullyPaid ? timestamp : null, updated_at: timestamp }).eq("id", enrollment.id);
      try {
        await sendPaymentEmail(supabase, enrollment.id);
      } catch (emailError) {
        // 金流通知仍須回覆成功；寄信失敗會記錄，PAYUNi 重送通知時可再嘗試。
        console.error("payment-confirmation-email", emailError);
      }
    } else if (enrollment.status === "pending_payment") {
      // 已付款訂單永不因延遲或重複的失敗通知而降級。
      await supabase.from("enrollments").update({ status: "payment_failed", updated_at: timestamp }).eq("id", enrollment.id);
    }
    await supabase.from("audit_logs").insert({ entity_type: "enrollment", entity_id: enrollment.id, action: success ? "payment_verified" : "payment_failed", details: { provider: "payuni" } });
    return new Response("SUCCESS", { status: 200 });
  } catch (error) {
    console.error("payuni-notify", error);
    return new Response("Notification processing failed", { status: 500 });
  }
});
