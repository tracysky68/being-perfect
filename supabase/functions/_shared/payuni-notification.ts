// Pure decision layer for a hash-checked PAYUNi NotifyURL message.
// The outer Status is not covered by HashInfo; never let it override the
// decrypted TradeStatus, order, merchant or amount.
export type PayuniDecision =
  | { kind: "paid" | "pending" | "failed" | "duplicate_paid"; reason: string }
  | { kind: "review"; reason: string };

export function classifyPayuniNotification(input: {
  outerStatus: unknown;
  details: Record<string, unknown>;
  merchantId: string;
  orderNumber: string;
  amountTwd: number;
  currentStatus: string;
  currentTradeNumber?: string | null;
}): PayuniDecision {
  const { details } = input;
  const review = (reason: string): PayuniDecision => ({ kind: "review", reason });
  if (!details || typeof details !== "object" || details.ApiType) return review("unexpected_message_type");
  if (!input.merchantId || String(details.MerID ?? "") !== input.merchantId) return review("merchant_mismatch");
  if (!input.orderNumber || String(details.MerTradeNo ?? "") !== input.orderNumber) return review("order_mismatch");
  const amount = String(details.TradeAmt ?? "");
  if (!Number.isSafeInteger(input.amountTwd) || input.amountTwd <= 0 ||
      !/^[1-9]\d*$/.test(amount) || Number(amount) !== input.amountTwd) return review("amount_mismatch");

  const tradeStatus = String(details.TradeStatus ?? "");
  const tradeNumber = String(details.TradeNo ?? "").trim();
  const paid = input.outerStatus === "SUCCESS" && tradeStatus === "1" && tradeNumber.length > 0;
  if (input.currentStatus === "verified") {
    return paid && input.currentTradeNumber === tradeNumber
      ? { kind: "duplicate_paid", reason: "already_verified" }
      : review("conflict_with_verified_payment");
  }
  if (input.outerStatus !== "SUCCESS") return review("outer_status_not_success");
  if (tradeStatus === "0") return { kind: "pending", reason: "awaiting_payment" };
  if (tradeStatus === "1") return tradeNumber
    ? { kind: "paid", reason: "confirmed_trade" }
    : review("missing_trade_number");
  if (tradeStatus === "2" || tradeStatus === "3") return { kind: "failed", reason: "payment_failed_or_cancelled" };
  return review("unknown_trade_status");
}
