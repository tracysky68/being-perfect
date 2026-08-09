import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";

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
  if (request.method !== "GET" || !allowedOrigin || origin !== allowedOrigin) return jsonResponse({ message: "Request not allowed" }, 403, cors);
  const courseCode = new URL(request.url).searchParams.get("courseCode")?.trim();
  if (!courseCode) return jsonResponse({ message: "Missing course code" }, 400, cors);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServerKey());
  const { data: course, error: courseError } = await supabase.from("courses")
    .select("id").eq("code", courseCode).eq("active", true).single();
  if (courseError || !course) {
    console.error("course lookup", courseError);
    return jsonResponse({ message: "Course is unavailable" }, 404, cors);
  }

  const { data, error } = await supabase.from("cohorts")
    .select("id,title,starts_at")
    .eq("active", true).eq("course_id", course.id)
    .order("starts_at", { ascending: true });
  if (error) return jsonResponse({ message: "Unable to load cohorts" }, 500, cors);
  const { data: plans, error: plansError } = await supabase.from("pricing_plans")
    .select("code,title,total_amount_twd,installment_count,installment_amount_twd,eligibility")
    .eq("active", true).eq("course_id", course.id).order("total_amount_twd", { ascending: false });
  if (plansError) return jsonResponse({ message: "Unable to load pricing" }, 500, cors);
  return jsonResponse({
    cohorts: (data ?? []).map((item) => ({ id: item.id, title: item.title, startsAt: item.starts_at })),
    pricingPlans: (plans ?? []).map((plan) => ({
      code: plan.code, title: plan.title, totalAmountTwd: plan.total_amount_twd,
      installmentCount: plan.installment_count, installmentAmountTwd: plan.installment_amount_twd,
      eligibility: plan.eligibility
    }))
  }, 200, cors);
});
