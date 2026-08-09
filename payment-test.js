const form = document.querySelector("#enrollment-form");
const statusBox = document.querySelector("#form-status");
const cohortSelect = form.elements.cohortId;

async function loadTestCohort() {
  try {
    const response = await fetch(`${window.BP_CONFIG.cohortsEndpoint}?courseCode=TEACHER-DIALOGUE`);
    const result = await response.json();
    if (!response.ok || !result.cohorts?.length) throw new Error("目前沒有可用梯次");
    cohortSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = result.cohorts[0].id;
    option.textContent = `${result.cohorts[0].title}（測試用）`;
    cohortSelect.append(option);
  } catch (error) {
    cohortSelect.innerHTML = '<option value="">測試梯次載入失敗</option>';
    statusBox.textContent = error.message;
  }
}

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  statusBox.textContent = "正在建立 NT$1 測試訂單…";
  try {
    const response = await fetch(window.BP_CONFIG.paymentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "無法建立測試訂單");
    statusBox.textContent = "正在前往 PAYUNi…";
    submitToPayuni(result.paymentUrl, result.fields);
  } catch (error) {
    statusBox.textContent = `${error.message}，請稍後再試。`;
    button.disabled = false;
  }
});

loadTestCohort();

