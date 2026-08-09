Deno.serve(async (request) => {
  if (request.method !== "POST" && request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const siteUrl = Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/$/, "");
  if (!siteUrl) return new Response("Missing site configuration", { status: 500 });
  // 瀏覽器返回頁不作為入帳依據；付款狀態只由已驗證的 NotifyURL 更新。
  return Response.redirect(`${siteUrl}/payment-result.html`, 303);
});
