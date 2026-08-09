import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const corsHeaders = (origin: string) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" });
const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
const roles = new Set(["幼兒園教師", "國小教師", "安親／課後教師", "美術教師", "才藝教師", "教育工作者", "其他"]);
const yearRanges = new Set(["未滿 1 年", "1–3 年", "4–7 年", "8–12 年", "13 年以上"]);
const backgrounds = new Set(["沒有", "曾接觸／自學", "受過相關培訓", "相關科系／專業背景"]);

function serverKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default as string;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const cors = corsHeaders(origin === allowedOrigin ? origin : allowedOrigin);
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST" || !allowedOrigin || origin !== allowedOrigin) return jsonResponse({ message: "Request not allowed" }, 403, cors);

  try {
    const payload = await request.json();
    const token = String(payload.token ?? "").trim();
    const day1SessionId = String(payload.day1SessionId ?? "").trim();
    const day2SessionId = String(payload.day2SessionId ?? "").trim();
    const intake = payload.intake ?? {};
    const ageGroups = Array.isArray(intake.studentAgeGroups) ? intake.studentAgeGroups.slice(0, 8).map(String) : [];
    const challenges = Array.isArray(intake.mainChallenges) ? intake.mainChallenges.slice(0, 8).map(String) : [];

    if (!/^[a-f0-9]{64}$/.test(token) || !day1SessionId || !day2SessionId ||
        !roles.has(intake.currentRole) || !yearRanges.has(intake.teachingYears) ||
        !backgrounds.has(intake.artBackground) || !backgrounds.has(intake.educationBackground) ||
        !ageGroups.length || !challenges.length || !String(intake.focusQuestions ?? "").trim() ||
        !String(intake.learningExpectations ?? "").trim()) {
      return jsonResponse({ message: "請完成所有必填欄位" }, 422, cors);
    }

    const cleanIntake = {
      currentRole: intake.currentRole,
      organization: String(intake.organization ?? "").trim().slice(0, 120),
      teachingYears: intake.teachingYears,
      studentAgeGroups: ageGroups,
      artBackground: intake.artBackground,
      educationBackground: intake.educationBackground,
      mainChallenges: challenges,
      focusQuestions: String(intake.focusQuestions).trim().slice(0, 2000),
      learningExpectations: String(intake.learningExpectations).trim().slice(0, 2000),
      caseDescription: String(intake.caseDescription ?? "").trim().slice(0, 3000),
      artworkPermission: intake.artworkPermission === true,
      additionalNotes: String(intake.additionalNotes ?? "").trim().slice(0, 2000)
    };

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serverKey());
    const { error } = await supabase.rpc("submit_teacher_intake", {
      access_token: token, day_1_session_id: day1SessionId, day_2_session_id: day2SessionId, intake: cleanIntake
    });
    if (error) {
      if (error.message.includes("SESSION_FULL")) return jsonResponse({ message: "你選擇的場次剛好額滿，請重新選擇" }, 409, cors);
      if (error.message.includes("PAYMENT_REQUIRED")) return jsonResponse({ message: "付款尚未確認" }, 403, cors);
      if (error.message.includes("INVALID_TOKEN")) return jsonResponse({ message: "這個專屬連結無效" }, 404, cors);
      console.error("submit-teacher-intake", error);
      return jsonResponse({ message: "目前無法儲存，請稍後再試" }, 500, cors);
    }
    return jsonResponse({ message: "日期與課前資料已儲存完成" }, 200, cors);
  } catch (error) {
    console.error("submit-teacher-intake", error);
    return jsonResponse({ message: "目前無法儲存，請稍後再試" }, 500, cors);
  }
});
