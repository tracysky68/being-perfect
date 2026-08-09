import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptPayuni, payuniHash, secureEqual } from "../_shared/payuni.ts";

function supabaseServerKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const current = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return current.default as string;
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
