// PAYUNi official UOP Notify v1: https://docs.payuni.com.tw/web/#/7/53
export function validateUop(details: Record<string,string>, merchant: string, linkName: string) {
  if (!merchant || !linkName || details.MerchantId !== merchant || details.LinkName !== linkName) throw new Error('SOURCE_MISMATCH');
  if (!/^\d+$/.test(details.TradeAmt ?? '') || Number(details.TradeAmt) !== 39800) throw new Error('AMOUNT_MISMATCH');
  if (!details.No || details.No.length > 100 || !details.OrderNo || details.OrderNo.length > 100) throw new Error('INVALID_TRANSACTION');
  // SUCCESS on account-number creation is not payment. Only TradeStatus=1 is paid.
  if (details.TradeStatus !== '1') return null;
  const name = (details.PaymentName ?? '').trim();
  const email = (details.PaymentEmail ?? '').trim().toLowerCase();
  const phone = (details.PaymentPhone ?? '').trim();
  if (!name || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+\d()\s-]{8,30}$/.test(phone)) throw new Error('CONTACT_REQUIRED');
  return {merchant,tradeNo:details.No,orderNo:details.OrderNo,linkName,amount:39800,name,email,phone,paymentType:details.PaymentType ?? '',cardInst:details.CardInst ?? ''};
}
