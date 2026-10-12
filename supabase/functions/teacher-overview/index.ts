import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
async function authenticate(request: Request, supabase: ReturnType<typeof createClient>) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  const allowed = (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return !error && user?.email && allowed.includes(user.email.toLowerCase()) ? user : null;
}

async function teacherOverview(supabase: ReturnType<typeof createClient>, cors: HeadersInit) {
  const rawIds = (Deno.env.get("OVERVIEW_TEACHER_COHORT_IDS") ?? "").split(",").map(v => v.trim()).filter(Boolean);
  const courseId = Deno.env.get("OVERVIEW_TEACHER_COURSE_ID") ?? "";
  const expiresAt = Deno.env.get("OVERVIEW_TEACHER_EXPIRES_AT") ?? "";
  const now = Date.now();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(courseId) || !rawIds.length || rawIds.length > 12 ||
      new Set(rawIds).size !== rawIds.length || rawIds.some(id => !uuid.test(id)) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiresAt) ||
      !Number.isFinite(Date.parse(expiresAt)) || now >= Date.parse(expiresAt) ||
      Date.parse(expiresAt) - now > 7 * 86400000) {
    return json({ message: "教師摘要讀權未啟用或已到期" }, 403, cors);
  }
  const { data: cohorts, error: cohortError } = await supabase.from("cohorts")
    .select("id,title").eq("course_id", courseId).in("id", rawIds).limit(12);
  if (cohortError || cohorts?.length !== rawIds.length) return json({ message: "教師摘要梯次範圍不符" }, 503, cors);
  const base = () => supabase.from("enrollments").select("id", { count: "exact", head: true }).in("cohort_id", rawIds);
  const [total, paid, pendingPayment, paymentIssues, intakeComplete, emailFailed] = await Promise.all([
    base(),
    base().in("status", ["paid", "partially_paid"]),
    base().eq("status", "pending_payment"),
    base().in("status", ["payment_failed", "refunding"]),
    supabase.from("enrollments").select("id,teacher_intake_responses!inner(enrollment_id)", { count: "exact", head: true }).in("cohort_id", rawIds),
    supabase.from("email_deliveries").select("id,enrollments!inner(cohort_id)", { count: "exact", head: true })
      .eq("template", "payment_confirmed_teacher_intake").eq("status", "failed").in("enrollments.cohort_id", rawIds),
  ]);
  const results = { total, paid, pendingPayment, paymentIssues, intakeComplete, emailFailed };
  if (Object.values(results).some(result => result.error || typeof result.count !== "number" ||
      !Number.isSafeInteger(result.count) || result.count < 0)) {
    return json({ message: "教師摘要未完整讀取" }, 503, cors);
  }
  return json({
    wireVersion: "teacher-overview/1",
    cohorts: cohorts!.map(({ id, title }) => ({ id, title })),
    metrics: Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.count])),
    sourceUpdatedAt: null,
    readAt: new Date().toISOString(),
    grantExpiresAt: expiresAt,
  }, 200, cors);
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin === allowedOrigin ? origin : allowedOrigin);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "GET" || !allowedOrigin || origin !== allowedOrigin) return json({ message: "Request not allowed" }, 403, cors);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
    const user = await authenticate(request, supabase);
    if (!user?.email) return json({ message: "沒有管理權限" }, 403, cors);
    return await teacherOverview(supabase, cors);
  } catch (error) {
    console.error("teacher-overview", error);
    return json({ message: "教師摘要未完整讀取" }, 503, cors);
  }
});
