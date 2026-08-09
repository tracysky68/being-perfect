const enrollmentForm = document.querySelector("#enrollment-form");
const formStatus = document.querySelector("#form-status");
const cohortSelect = enrollmentForm?.elements.cohortId;
const paymentOptions = document.querySelector("[data-payment-options]");

const fallbackPlans = {
  "GENERAL-2026": { totalAmountTwd: 13800, installmentCount: 3, installmentAmountTwd: 4600 }
};
let pricingPlans = fallbackPlans;

function money(amount) {
  return `NT$${Number(amount).toLocaleString("zh-TW")}`;
}

function updateCheckoutSummary() {
  const pricingCode = enrollmentForm.elements.pricingCode.value;
  const paymentOption = enrollmentForm.elements.paymentOption.value;
  const plan = pricingPlans[pricingCode] ?? fallbackPlans[pricingCode];
  if (!plan) return;
  document.querySelector("[data-full-amount]").textContent = `本次付款 ${money(plan.totalAmountTwd)}`;
  document.querySelector("[data-installment-amount]").textContent = `每期 ${money(plan.installmentAmountTwd)}，共 ${plan.installmentCount} 期`;
  document.querySelector("[data-checkout-total]").textContent = money(paymentOption === "installments" ? plan.installmentAmountTwd : plan.totalAmountTwd);
  document.querySelectorAll(".payment-choice").forEach((item) => item.classList.toggle("is-selected", item.querySelector("input").checked));
}

async function loadCohorts() {
  const endpoint = window.BP_CONFIG?.cohortsEndpoint;
  if (!cohortSelect || !endpoint) return;
  try {
    const response = await fetch(`${endpoint}?courseCode=${encodeURIComponent(enrollmentForm.elements.courseCode.value)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    cohortSelect.innerHTML = '<option value="">請選擇月份</option>';
    const availableCohorts = result.cohorts.filter((cohort) => {
      const monthMatch = cohort.title.match(/(\d{1,2})\s*月/);
      return monthMatch && [9, 10, 11].includes(Number(monthMatch[1]));
    });
    availableCohorts.forEach((cohort) => {
      const option = document.createElement("option");
      option.value = cohort.id;
      const monthMatch = cohort.title.match(/(\d{1,2})\s*月/);
      const monthLabel = monthMatch ? `${Number(monthMatch[1])} 月` : cohort.title;
      option.textContent = `${monthLabel}｜平日、假日`;
      cohortSelect.append(option);
    });
    if (result.pricingPlans?.length) {
      const generalPlan = result.pricingPlans.find((plan) => plan.code === "GENERAL-2026");
      if (generalPlan) pricingPlans = { "GENERAL-2026": generalPlan };
      updateCheckoutSummary();
    }
    if (!availableCohorts.length) cohortSelect.innerHTML = '<option value="">目前尚無開放報名月份</option>';
  } catch (error) {
    cohortSelect.innerHTML = '<option value="">梯次載入失敗，請稍後再試</option>';
  }
}

loadCohorts();
paymentOptions?.addEventListener("change", updateCheckoutSummary);
updateCheckoutSummary();

function submitToPayuni(url, fields) {
  const paymentForm = document.createElement("form");
  paymentForm.method = "post";
  paymentForm.action = url;
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    paymentForm.append(input);
  });
  document.body.append(paymentForm);
  paymentForm.submit();
}

enrollmentForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!enrollmentForm.reportValidity()) return;

  const endpoint = window.BP_CONFIG?.paymentEndpoint;
  if (!endpoint) {
    formStatus.textContent = "報名頁已完成；待 Supabase 測試環境連線後即可建立付款。";
    formStatus.dataset.state = "notice";
    return;
  }

  const submitButton = enrollmentForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  formStatus.textContent = "正在安全建立訂單…";
  formStatus.dataset.state = "loading";

  try {
    const data = new FormData(enrollmentForm);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(data.entries()))
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "目前無法建立訂單");
    formStatus.textContent = "訂單已建立，正在前往 PAYUNi…";
    submitToPayuni(result.paymentUrl, result.fields);
  } catch (error) {
    formStatus.textContent = `${error.message}，請稍後再試或聯絡玩美學。`;
    formStatus.dataset.state = "error";
    submitButton.disabled = false;
  }
});
