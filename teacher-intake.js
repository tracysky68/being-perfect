const form = document.querySelector("#teacher-intake-form");
const loadingState = document.querySelector("[data-portal-loading]");
const errorState = document.querySelector("[data-portal-error]");
const successState = document.querySelector("[data-portal-success]");
const token = new URLSearchParams(location.search).get("token") ?? "";

function showError(message) {
  loadingState.hidden = true;
  form.hidden = true;
  errorState.hidden = false;
  document.querySelector("[data-error-message]").textContent = message;
}

function formatSession(session) {
  const start = new Date(session.startsAt);
  const end = new Date(session.endsAt);
  const date = new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Taipei" }).format(start);
  const time = `${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(start)}–${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(end)}`;
  return { date, time, type: session.scheduleType === "weekday" ? "平日" : "假日" };
}

function renderSessions(sessions, selections, cohortId = null) {
  ["day_1", "day_2"].forEach((module) => {
    const container = document.querySelector(`[data-${module.replace("_", "-")}]`);
    const options = sessions.filter((session) => session.module === module && (!cohortId || session.cohortId === cohortId));
    container.innerHTML = options.map((session) => {
      const display = formatSession(session);
      const full = session.remaining === 0 && selections[module] !== session.id;
      return `<label class="session-card${full ? " is-full" : ""}"><input type="radio" name="${module === "day_1" ? "day1SessionId" : "day2SessionId"}" value="${session.id}" ${selections[module] === session.id ? "checked" : ""} ${full ? "disabled" : ""} required><span class="session-type">${display.type}</span><strong>${display.date}</strong><small>${display.time}</small><em>${full ? "已額滿" : `剩餘 ${session.remaining} 位`}</em></label>`;
    }).join("");
  });
}

function setChecked(name, values = []) {
  form.querySelectorAll(`[name="${name}"]`).forEach((input) => { input.checked = values.includes(input.value); });
}

function fillExisting(intake) {
  if (!intake) return;
  ["currentRole", "organization", "teachingYears", "artBackground", "educationBackground", "focusQuestions", "learningExpectations", "caseDescription", "additionalNotes"].forEach((name) => {
    if (form.elements[name]) form.elements[name].value = intake[name] ?? "";
  });
  setChecked("studentAgeGroups", intake.studentAgeGroups);
  setChecked("mainChallenges", intake.mainChallenges);
  form.elements.artworkPermission.checked = intake.artworkPermission === true;
}

async function loadPortal() {
  if (!token) return showError("連結缺少專屬識別碼，請使用付款確認信中的完整連結。");
  try {
    const response = await fetch(`${window.BP_CONFIG.intakeEndpoint}?token=${encodeURIComponent(token)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "目前無法載入資料");
    document.querySelector("[data-student-name]").textContent = `${result.student.name}，你好`;
    document.querySelector("[data-cohort-title]").textContent = result.cohortSelectionRequired ? "請在下方選擇月份" : result.cohort;
    document.querySelector("[data-intake-identity]").hidden = false;
    if (result.cohortSelectionRequired) {
      const picker = document.querySelector("[data-cohort-picker]");
      const select = document.querySelector("[data-cohort-select]");
      picker.hidden = false; select.required = true;
      select.innerHTML = '<option value="">請選擇月份</option>'+result.cohorts.map((cohort)=>`<option value="${cohort.id}">${cohort.title.replace(/^2026 年 /, "")}</option>`).join("");
      const refresh = () => renderSessions(result.sessions, result.selections, select.value);
      select.addEventListener("change", refresh); refresh();
    } else renderSessions(result.sessions, result.selections);
    fillExisting(result.intake);
    loadingState.hidden = true;
    form.hidden = false;
  } catch (error) {
    showError(error.message);
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("[data-submit-status]");
  const ages = [...form.querySelectorAll('[name="studentAgeGroups"]:checked')].map((item) => item.value);
  const challenges = [...form.querySelectorAll('[name="mainChallenges"]:checked')].map((item) => item.value);
  if (!form.reportValidity()) return;
  if (!ages.length || !challenges.length) {
    status.textContent = "請至少選擇一個孩子年齡與一項教學困難。";
    status.dataset.state = "error";
    return;
  }

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.textContent = "正在安全儲存…";
  status.dataset.state = "loading";
  const data = new FormData(form);
  const payload = {
    token,
    cohortId: data.get("cohortId") || null,
    day1SessionId: data.get("day1SessionId"),
    day2SessionId: data.get("day2SessionId"),
    intake: {
      currentRole: data.get("currentRole"), organization: data.get("organization"), teachingYears: data.get("teachingYears"),
      studentAgeGroups: ages, artBackground: data.get("artBackground"), educationBackground: data.get("educationBackground"),
      mainChallenges: challenges, focusQuestions: data.get("focusQuestions"), learningExpectations: data.get("learningExpectations"),
      caseDescription: data.get("caseDescription"), artworkPermission: data.get("artworkPermission") === "on", additionalNotes: data.get("additionalNotes")
    }
  };

  try {
    const response = await fetch(window.BP_CONFIG.intakeSubmitEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "目前無法儲存");
    form.hidden = true;
    successState.hidden = false;
    scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    status.textContent = error.message;
    status.dataset.state = "error";
    button.disabled = false;
  }
});

loadPortal();
