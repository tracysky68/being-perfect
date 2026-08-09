import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const corsHeaders = (origin: string) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" });
const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });

function serverKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default as string;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin === allowedOrigin ? origin : allowedOrigin);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "GET" || !allowedOrigin || origin !== allowedOrigin) return jsonResponse({ message: "Request not allowed" }, 403, cors);

  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(token)) return jsonResponse({ message: "這個專屬連結無效" }, 404, cors);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
  const { data: portal } = await supabase.from("enrollment_portal_tokens").select("enrollment_id").eq("token", token).eq("active", true).maybeSingle();
  if (!portal) return jsonResponse({ message: "這個專屬連結無效或已停用" }, 404, cors);

  const { data: enrollment } = await supabase.from("enrollments").select("id,status,student_id,cohort_id").eq("id", portal.enrollment_id).single();
  if (!enrollment) return jsonResponse({ message: "找不到報名資料" }, 404, cors);
  if (!["paid", "partially_paid"].includes(enrollment.status)) return jsonResponse({ message: "付款尚未確認，確認後即可填寫" }, 403, cors);

  const [{ data: student }, { data: cohort }, { data: sessions }, { data: selections }, { data: intake }, { data: occupied }] = await Promise.all([
    supabase.from("students").select("full_name,email").eq("id", enrollment.student_id).single(),
    supabase.from("cohorts").select("title").eq("id", enrollment.cohort_id).single(),
    supabase.from("course_sessions").select("id,module,schedule_type,title,starts_at,ends_at,capacity").eq("cohort_id", enrollment.cohort_id).eq("active", true).order("starts_at"),
    supabase.from("enrollment_sessions").select("session_id,module").eq("enrollment_id", enrollment.id).in("status", ["confirmed", "admin_assigned"]),
    supabase.from("teacher_intake_responses").select("role_title,organization,teaching_years,student_age_groups,art_background,education_background,main_challenges,focus_questions,learning_expectations,case_description,artwork_permission,additional_notes,submitted_at").eq("enrollment_id", enrollment.id).maybeSingle(),
    supabase.from("enrollment_sessions").select("session_id").in("status", ["confirmed", "admin_assigned"])
  ]);

  const counts = (occupied ?? []).reduce<Record<string, number>>((map, row) => {
    map[row.session_id] = (map[row.session_id] ?? 0) + 1;
    return map;
  }, {});

  return jsonResponse({
    student: { name: student?.full_name ?? "學員", email: student?.email ?? "" },
    cohort: cohort?.title ?? "教師專班",
    sessions: (sessions ?? []).map((session) => ({
      id: session.id, module: session.module, scheduleType: session.schedule_type, title: session.title,
      startsAt: session.starts_at, endsAt: session.ends_at,
      remaining: Math.max(0, session.capacity - (counts[session.id] ?? 0))
    })),
    selections: Object.fromEntries((selections ?? []).map((item) => [item.module, item.session_id])),
    intake: intake ? {
      currentRole: intake.role_title, organization: intake.organization ?? "", teachingYears: intake.teaching_years,
      studentAgeGroups: intake.student_age_groups, artBackground: intake.art_background,
      educationBackground: intake.education_background, mainChallenges: intake.main_challenges,
      focusQuestions: intake.focus_questions, learningExpectations: intake.learning_expectations,
      caseDescription: intake.case_description ?? "", artworkPermission: intake.artwork_permission,
      additionalNotes: intake.additional_notes ?? "", submittedAt: intake.submitted_at
    } : null
  }, 200, cors);
});
