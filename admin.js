import { setupReminders } from "./admin-reminders.js?v=20261030-style2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.BP_CONFIG;
const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const table = document.querySelector("#students-table");
const tbody = document.querySelector("#students-body");
const dialog = document.querySelector("#student-dialog");
const manualDialog = document.querySelector("#manual-dialog");
const manualForm = document.querySelector("#manual-form");
const passwordDialog = document.querySelector("#password-dialog");
const passwordForm = document.querySelector("#password-form");
let records = [];
let cohorts = [];
let trainingSettings = [];
let monthlyRevenue = null;
const completedIntake = r => Boolean(r.intake || r.trainingIntake);
function scopedRecords(){const code=document.querySelector("#course-filter").value;return records.filter(r=>!code||r.courseCode===code);}
const overviewOrigin = "https://being-perfect-core-workbench.onrender.com";
const overviewNonce = new URLSearchParams(location.hash.slice(1)).get("overview");
const overviewBridgeActive = /^[0-9a-f]{32}$/.test(overviewNonce ?? "") && !!window.opener;
let overviewRun = 0;
function sendOverview(type, snapshot) {
  if (overviewBridgeActive && !window.opener.closed) window.opener.postMessage({ type, nonce: overviewNonce, snapshot }, overviewOrigin);
}
async function readTeacherOverview() {
  if (!overviewBridgeActive) return;
  const run = ++overviewRun;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw Error("NO_SESSION");
    const url = new URL(config.adminEndpoint);
    url.pathname = url.pathname.replace(/\/admin-dashboard$/, "/teacher-overview");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
    if (!response.ok) throw Error("SUMMARY_UNAVAILABLE");
    const snapshot = await response.json();
    if (run === overviewRun) sendOverview("wan-teacher-summary", snapshot);
  } catch {
    if (run === overviewRun) sendOverview("wan-teacher-disconnected", null);
  }
}
if (overviewBridgeActive) window.addEventListener("message", event => {
  if (event.source === window.opener && event.origin === overviewOrigin &&
      event.data?.type === "wan-teacher-refresh" && event.data?.nonce === overviewNonce) readTeacherOverview();
});

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"}[char]));
const money = (value) => `NT$${Number(value || 0).toLocaleString("zh-TW")}`;
const dateTime = (value) => value ? new Intl.DateTimeFormat("zh-TW", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Taipei"}).format(new Date(value)) : "—";
const tags = (values=[]) => `<div class="tag-list">${values.map((v)=>`<span>${escapeHtml(v)}</span>`).join("") || "—"}</div>`;

function badge(label, tone="neutral") { return `<span class="badge ${tone}">${label}</span>`; }
function paymentBadge(record) {
  if (["paid","partially_paid"].includes(record.status)) return badge(record.status === "paid" ? "已付款" : "部分付款", "good");
  if (["payment_failed","refunding","refunded"].includes(record.status)) return badge("需處理", "bad");
  return badge("待付款", "warn");
}

async function loadData() {
  document.querySelector("#loading-state").hidden = false; table.hidden = true;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return showLogin();
  const response = await fetch(config.adminEndpoint, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (response.status === 401 || response.status === 403) { await supabase.auth.signOut(); showLogin("這個帳號沒有管理權限。"); return; }
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "後台資料載入失敗");
  monthlyRevenue = Array.isArray(result.monthlyRevenue) ? result.monthlyRevenue : null;
  records = result.records; cohorts = result.cohorts || []; trainingSettings = result.trainingSettings || [];
  updateMetrics(); populateCohorts(); renderRows();
  document.querySelector("#last-updated").textContent = `更新：${dateTime(new Date())}`;
  readTeacherOverview();
}

function updateMetrics() {
  const code = document.querySelector("#course-filter").value;
  document.querySelector("#revenue-scope").textContent = code === "TEACHER-DIALOGUE" ? "內心畫教師專班" : code === "TEACHER-TRAINING" ? "創感力師資培訓" : "兩門課程合併";
  document.querySelectorAll("[data-course-scope]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.courseScope === code)));

  document.querySelector("#metric-total").textContent = scopedRecords().length;
  document.querySelector("#metric-paid").textContent = scopedRecords().filter(r=>["paid","partially_paid"].includes(r.status)).length;
  document.querySelector("#metric-intake").textContent = scopedRecords().filter(completedIntake).length;
  document.querySelector("#metric-action").textContent = scopedRecords().filter(r=>["payment_failed","refunding"].includes(r.status)||r.emailStatus==="failed").length;
  renderRevenue();
}

function populateCohorts() {
  const select = document.querySelector("#cohort-filter");
  const current = select.value;
  select.innerHTML = '<option value="">全部梯次</option>'+[...new Set(scopedRecords().map(r=>r.cohort))].sort().map(v=>`<option>${escapeHtml(v)}</option>`).join("");
  select.value = [...select.options].some(o=>o.value===current)?current:"";
  populateManualCohorts();
}

function filteredRecords() {
  const query = document.querySelector("#search-input").value.trim().toLowerCase();
  const cohort = document.querySelector("#cohort-filter").value;
  const status = document.querySelector("#status-filter").value;
  return scopedRecords().filter((r) => {
    const matchesQuery = !query || [r.name,r.email,r.phone,r.orderNumber].some(v=>String(v).toLowerCase().includes(query));
    const matchesCohort = !cohort || r.cohort === cohort;
    const matchesStatus = !status || (status === "paid" && ["paid","partially_paid"].includes(r.status)) || (status === "pending" && r.status === "pending_payment") || (status === "action" && (["payment_failed","refunding"].includes(r.status)||r.emailStatus==="failed")) || (status === "complete" && completedIntake(r)) || (status === "missing" && !completedIntake(r)) || (status === "partial" && r.status === "partially_paid");
    return matchesQuery && matchesCohort && matchesStatus;
  });
}

function renderRows() {
  const list = filteredRecords();
  tbody.innerHTML = list.map((r)=>`<tr data-id="${r.id}"><td><div class="person"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.email)}</span><span>${escapeHtml(r.phone)}</span></div></td><td><div class="subtle">${escapeHtml(r.courseTitle)}</div><b>${escapeHtml(r.cohort)}</b><div class="subtle">${(r.courseCode==="TEACHER-TRAINING"?r.trainingSessions:r.sessions).map(s=>escapeHtml(s.title)).join("、")||"尚未安排日期"}</div></td><td>${paymentBadge(r)}<div class="subtle">${money(r.amountTwd)} · ${escapeHtml(r.paymentOptionLabel)}</div></td><td>${completedIntake(r)?badge("已完成","good"):badge("待填寫","warn")}</td><td>${r.emailStatus==="sent"?badge("已寄送","good"):r.emailStatus==="failed"?badge("寄送失敗","bad"):badge("尚未寄送")}</td><td class="row-arrow">→</td></tr>`).join("");
  document.querySelector("#loading-state").hidden = true;
  document.querySelector("#empty-state").hidden = list.length > 0;
  table.hidden = list.length === 0;
  tbody.querySelectorAll("tr").forEach(row=>row.addEventListener("click",()=>openDetail(row.dataset.id)));
}

function openDetail(id) {
  const r = records.find(item=>item.id===id); if(!r)return;
  const intake = r.intake;
  document.querySelector("#student-detail").innerHTML = `<div class="detail-head"><span class="section-no">STUDENT FILE</span><h2>${escapeHtml(r.name)}</h2><p>${escapeHtml(r.cohort)} · ${escapeHtml(r.orderNumber)}</p></div><div class="detail-grid"><section class="detail-section"><h3>聯絡與付款</h3><dl><dt>Email</dt><dd>${escapeHtml(r.email)}</dd><dt>手機</dt><dd>${escapeHtml(r.phone)}</dd><dt>付款狀態</dt><dd>${paymentBadge(r)} ${money(r.amountTwd)}</dd><dt>付款時間</dt><dd>${dateTime(r.paidAt)}</dd><dt>確認信</dt><dd>${escapeHtml(r.emailStatusLabel)}</dd></dl></section><section class="detail-section"><h3>上課日期</h3><dl>${r.sessions.map(s=>`<dt>${s.module==="day_1"?"第一天":"第二天"}</dt><dd>${escapeHtml(s.title)}<br>${dateTime(s.startsAt)}</dd>`).join("")||"尚未選擇"}</dl></section>${intake?`<section class="detail-section"><h3>教學背景</h3><dl><dt>目前身分</dt><dd>${escapeHtml(intake.currentRole)}</dd><dt>單位</dt><dd>${escapeHtml(intake.organization)||"—"}</dd><dt>年資</dt><dd>${escapeHtml(intake.teachingYears)}</dd><dt>學生年齡</dt><dd>${tags(intake.studentAgeGroups)}</dd><dt>藝術背景</dt><dd>${escapeHtml(intake.artBackground)}</dd><dt>教育背景</dt><dd>${escapeHtml(intake.educationBackground)}</dd></dl></section><section class="detail-section"><h3>教學需求</h3><dl><dt>主要挑戰</dt><dd>${tags(intake.mainChallenges)}</dd><dt>最想釐清</dt><dd>${escapeHtml(intake.focusQuestions)}</dd><dt>學習期待</dt><dd>${escapeHtml(intake.learningExpectations)}</dd></dl></section><section class="detail-section wide"><h3>補充資料</h3><dl><dt>案例描述</dt><dd>${escapeHtml(intake.caseDescription)||"—"}</dd><dt>其他備註</dt><dd>${escapeHtml(intake.additionalNotes)||"—"}</dd><dt>作品使用同意</dt><dd>${intake.artworkPermission?"同意":"不同意"}</dd><dt>提交時間</dt><dd>${dateTime(intake.submittedAt)}</dd></dl></section>`:`<section class="detail-section wide"><h3>課前資料</h3><p>學員尚未完成填寫。</p></section>`}</div>`;
  if (r.trainingIntake) {
    const fields = {role_title:"目前職業／身分",organization:"任職單位",teaching_experience:"教學經驗",motivation:"參訓動機",intended_use:"培訓後運用",learning_expectations:"學習期待",additional_notes:"補充說明"};
    const section = document.querySelector("#student-detail .detail-section.wide");
    section.innerHTML = `<h3>師資培訓課前調查</h3><dl>${Object.entries(fields).map(([key,label])=>`<dt>${label}</dt><dd>${escapeHtml(r.trainingIntake[key])||"—"}</dd>`).join("")}<dt>提交時間</dt><dd>${dateTime(r.trainingIntake.submitted_at)}</dd></dl>`;
  }
  if(r.trainingIntake?.questionnaire){
    const answers=r.trainingIntake.questionnaire;
    const section=document.querySelector("#student-detail .detail-section.wide");
    section.innerHTML=`<h3>師資培訓課前問卷</h3><dl>${window.TRAINING_QUESTIONNAIRE.map(f=>`<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(Array.isArray(answers[f.key])?answers[f.key].join('、'):answers[f.key])||'—'}</dd>`).join('')}<dt>資料使用說明同意時間</dt><dd>${dateTime(r.trainingIntake.consent_at)}</dd><dt>提交時間</dt><dd>${dateTime(r.trainingIntake.submitted_at)}</dd></dl>`;
  }
  if (r.courseCode === "TEACHER-TRAINING") {
    document.querySelectorAll("#student-detail .detail-section")[1].innerHTML=`<h3>整期課表</h3><dl>${r.trainingSessions.slice().sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).map(s=>`<dt>${escapeHtml(s.title)}</dt><dd>${dateTime(s.starts_at)} ～ ${dateTime(s.ends_at)}</dd>`).join("")||"尚未安排"}</dl>`;
  }
  const history = records.filter(item=>item.studentId===r.studentId);
  document.querySelector("#student-detail").insertAdjacentHTML("beforeend",`<section class="detail-section"><h3>這位學員的報名紀錄</h3><p class="subtle">依目前載入的報名紀錄顯示</p><ul>${history.map(item=>`<li>${escapeHtml(item.courseTitle)} · ${escapeHtml(item.cohort)} · ${paymentBadge(item)}</li>`).join("")}</ul></section>`);
  if (["paid", "partially_paid"].includes(r.status)) {
    document.querySelector("#student-detail .detail-section").insertAdjacentHTML("beforeend", `<div class="detail-email-action"><button type="button" data-resend-intake>補寄課前表單</button><p data-resend-status class="form-status" role="status"></p></div>`);
    document.querySelector("[data-resend-intake]").addEventListener("click", () => resendIntakeEmail(r));
  }
  if (r.status === "paid") {
    document.querySelector("#student-detail").insertAdjacentHTML("beforeend", `<section class="detail-section"><h3>官方 LINE 課前通知</h3><p>固定範本會帶入學員姓名、課程與專屬連結。複製後請一對一傳送給本人。</p><button type="button" data-prepare-line>產生 LINE 訊息</button><div data-line-result hidden><label>訊息內容<textarea data-line-message readonly rows="10" style="width:100%;box-sizing:border-box;margin:12px 0;padding:12px;font:inherit"></textarea></label><button type="button" data-copy-line>複製 LINE 訊息</button></div><p data-line-status role="status"></p></section>`);
    const root=document.querySelector('[data-prepare-line]').closest('section');
    root.querySelector('[data-prepare-line]').addEventListener('click',async()=>{
      const button=root.querySelector('[data-prepare-line]'),status=root.querySelector('[data-line-status]');button.disabled=true;status.textContent='正在產生…';
      try {
        const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('請重新登入');
        const response=await fetch(config.adminEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:'prepare_line_intake',enrollmentId:r.id})});
        const result=await response.json();if(!response.ok)throw new Error(result.message||'產生失敗');
        root.querySelector('[data-line-message]').value=result.message;root.querySelector('[data-line-result]').hidden=false;status.textContent='訊息已備妥，尚未發送。';
      }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
    });
    root.insertAdjacentHTML('beforeend',`<div class="line-direct-panel"><h4>從後台手動發送</h4><p>先在官方 LINE 核對學員本人，複製該學員的聊天室網址貼到下方。LINE 暱稱可能與報名姓名不同，請勿只憑姓名選人。</p><label>學員的官方 LINE 聊天室網址<input data-line-recipient type="text" style="width:100%;box-sizing:border-box" placeholder="https://chat.line.biz/…/chat/…" autocomplete="off"></label><button type="button" data-line-preview>核對收件人與訊息</button><p data-line-direct-status role="status">正在讀取發送紀錄…</p><div data-line-confirm hidden><p data-line-recipient-name></p><textarea data-line-send-message readonly rows="10" style="width:100%;box-sizing:border-box;font:inherit"></textarea><label><input data-line-confirm-check type="checkbox">我已核對此 LINE 聯絡人就是這位學員本人</label><button type="button" data-line-send disabled>確認透過官方 LINE 發送</button></div></div>`);
    const directStatus=root.querySelector('[data-line-direct-status]'),previewButton=root.querySelector('[data-line-preview]'),sendButton=root.querySelector('[data-line-send]'),confirmBox=root.querySelector('[data-line-confirm]'),confirmCheck=root.querySelector('[data-line-confirm-check]');
    let preview=null;
    const callLine=async(action,extra={})=>{
      const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('請重新登入');
      const response=await fetch(config.adminEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,enrollmentId:r.id,...extra})});
      const result=await response.json();if(!response.ok)throw new Error(result.message||'LINE 操作失敗');return result;
    };
    const showDelivery=result=>{
      const d=result.delivery;const labels={sending:'發送處理中，請勿重送',accepted:'LINE 已受理（不代表已讀）',failed:'發送失敗，請管理員核對',unknown:'結果待確認，請勿重送',external_scheduled:'已在官方 LINE 預約發送'};
      directStatus.textContent=d?`${labels[d.status]||d.status}。${d.note||''}`:result.message||'尚未發送。';
      if(d||result.blocked){previewButton.disabled=true;sendButton.disabled=true;confirmBox.hidden=true;}
    };
    previewButton.disabled=true;
    callLine('line_intake_status').then(result=>{showDelivery(result);if(result.bound){root.querySelector('[data-line-recipient]').closest('label').hidden=true;root.querySelector('.line-direct-panel p').textContent='學員已完成本人 LINE 綁定，直接核對訊息即可發送。';}previewButton.disabled=Boolean(result.delivery)||!result.configured;if(!result.configured)directStatus.textContent='官方 LINE 尚未完成串接設定，仍可使用上方複製功能。';}).catch(error=>{directStatus.textContent=error.message;});
    root.querySelector('[data-line-recipient]').addEventListener('input',()=>{preview=null;confirmCheck.checked=false;sendButton.disabled=true;confirmBox.hidden=true;});
    confirmCheck.addEventListener('change',()=>{sendButton.disabled=!preview||!confirmCheck.checked;});
    previewButton.addEventListener('click',async()=>{
      previewButton.disabled=true;preview=null;confirmBox.hidden=true;confirmCheck.checked=false;sendButton.disabled=true;directStatus.textContent='正在核對官方 LINE 聯絡人…';
      try{const result=await callLine('preview_line_intake',{recipient:root.querySelector('[data-line-recipient]').value});if(result.blocked){showDelivery(result);return;}preview=result;root.querySelector('[data-line-recipient-name]').textContent=`發送帳號：${result.officialName}｜LINE 收件人：${result.displayName}｜報名學員：${result.name}`;root.querySelector('[data-line-send-message]').value=result.message;confirmBox.hidden=false;directStatus.textContent='請核對收件人與內容，勾選後才能發送。';}
      catch(error){directStatus.textContent=error.message;}finally{if(preview)previewButton.disabled=false;else if(!directStatus.textContent.includes('已有'))previewButton.disabled=false;}
    });
    sendButton.addEventListener('click',async()=>{
      if(!preview||!confirmCheck.checked)return;sendButton.disabled=true;previewButton.disabled=true;root.querySelector('[data-line-recipient]').disabled=true;confirmCheck.disabled=true;directStatus.textContent='正在提交至官方 LINE，請勿重複操作…';
      try{const result=await callLine('send_line_intake',{recipient:preview.userId,bound:preview.bound,messageHash:preview.hash,displayName:preview.displayName,confirmed:true});showDelivery(result);}
      catch(error){directStatus.textContent=error.message+'；請重新開啟此學員查看發送紀錄，勿立即重送。';}
    });
    root.querySelector('[data-copy-line]').addEventListener('click',async()=>{
      const field=root.querySelector('[data-line-message]'),status=root.querySelector('[data-line-status]');
      try{await navigator.clipboard.writeText(field.value);status.textContent='已複製，請貼到官方 LINE 傳給本人；尚未代為發送。';}
      catch{field.focus();field.select();status.textContent='請手動複製已選取的訊息，再貼到官方 LINE。';}
    });
  }
  document.querySelector("#student-detail").insertAdjacentHTML("beforeend", `<section class="detail-danger-zone"><div><h3>刪除學員資料</h3><p>永久刪除此筆報名、付款、選課與課前資料。此操作無法復原。</p></div><button type="button" data-delete-student>刪除學員</button><p data-delete-status class="form-status" role="status"></p></section>`);
  document.querySelector("[data-delete-student]").addEventListener("click", () => deleteStudent(r));
  reminderUI.detail(r,document.querySelector("#student-detail"));
  dialog.showModal();
}

const reminderUI=setupReminders({supabase,config,dashboard:dashboardView,escapeHtml,dateTime});

async function deleteStudent(record) {
  if (!window.confirm(`確定要永久刪除「${record.name}」的這筆報名資料嗎？\n\n刪除後無法復原。`)) return;
  const typedName = window.prompt(`為避免誤刪，請輸入學員姓名「${record.name}」確認：`);
  if (typedName === null) return;
  if (typedName.trim() !== record.name) {
    window.alert("姓名不一致，已取消刪除。");
    return;
  }
  const button = document.querySelector("[data-delete-student]");
  const status = document.querySelector("[data-delete-status]");
  button.disabled = true;
  status.textContent = "正在刪除學員資料…";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登入狀態已失效，請重新登入。");
    const response = await fetch(config.adminEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "delete_enrollment", enrollmentId: record.id, confirmationName: typedName.trim() }),
    });
    const result = await response.json();
    if (!response.ok || !result.deleted) throw new Error(result.message || "刪除失敗");
    dialog.close();
    await loadData();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

async function resendIntakeEmail(record) {
  if (!window.confirm(`確定要將課前表單補寄至 ${record.email} 嗎？`)) return;
  const button = document.querySelector("[data-resend-intake]");
  const status = document.querySelector("[data-resend-status]");
  button.disabled = true;
  status.textContent = "正在補寄課前表單…";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("登入狀態已失效，請重新登入。");
    const response = await fetch(config.adminEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: "resend_intake_email", enrollmentId: record.id }),
    });
    const result = await response.json();
    if (!response.ok || !result.emailSent) throw new Error(result.message || "補寄失敗");
    record.emailStatus = "sent";
    record.emailStatusLabel = "已寄送";
    status.textContent = `已成功補寄至 ${record.email}。`;
    button.textContent = "已補寄，可再次寄送";
    renderRows();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function exportCsv() {
  const rows = filteredRecords().map(r=>[r.name,r.email,r.phone,r.courseTitle,r.cohort,r.status,r.amountTwd,(r.courseCode==="TEACHER-TRAINING"?r.trainingSessions:r.sessions).map(s=>s.title).join(" / "),completedIntake(r)?"已完成":"待填寫",r.emailStatusLabel]);
  const csv = [["姓名","Email","手機","課程","梯次","付款狀態","金額","上課場次","課前資料","寄信狀態"],...rows].map(row=>row.map(v=>`"${String(v??"").replace(/^[=+@\-\t\r]/, "' $&").replaceAll('"','""')}"`).join(",")).join("\n");
  const link = document.createElement("a"); link.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"})); link.download=`玩美學學員名單-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function openManualForm() {
  manualForm.reset();
  manualForm.elements.courseCode.value = document.querySelector("#course-filter").value || "TEACHER-DIALOGUE";
  populateManualCohorts();
  manualForm.elements.amountTwd.value = manualForm.elements.courseCode.value === "TEACHER-TRAINING" ? "" : "13800";
  manualForm.elements.paidDate.value = new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Taipei"});
  document.querySelector("#manual-status").textContent = "";
  document.querySelector("#manual-submit").disabled = false;
  manualDialog.showModal();
}

manualForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!manualForm.reportValidity()) return;
  const submit = document.querySelector("#manual-submit");
  const status = document.querySelector("#manual-status");
  submit.disabled = true; status.textContent = "正在建立學員與專屬課前連結…";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const payload = Object.fromEntries(new FormData(manualForm).entries());
    payload.action = "create_manual_paid";
    const response = await fetch(config.adminEndpoint, { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "建立失敗");
    status.textContent = result.emailSent ? "建立完成，課前表單信件已寄出。" : result.emailRequested ? "學員已建立，但信件寄送失敗；可稍後補寄。" : "學員已建立，尚未寄信。";
    await loadData();
    setTimeout(()=>manualDialog.close(), 1600);
  } catch (error) { status.textContent = error.message; submit.disabled = false; }
});

function showLogin(message="") { loginView.hidden=false; dashboardView.hidden=true; loginStatus.textContent=message; }
function showDashboard() { loginView.hidden=true; dashboardView.hidden=false; loadData().catch(error=>{document.querySelector("#loading-state").innerHTML=`<p>${escapeHtml(error.message)}</p>`;}); }
loginForm.addEventListener("submit",async(e)=>{e.preventDefault();const email=document.querySelector("#admin-email").value.trim();const password=document.querySelector("#admin-password").value;const button=loginForm.querySelector('button[type="submit"]');button.disabled=true;loginStatus.textContent="正在登入…";const {error}=await supabase.auth.signInWithPassword({email,password});button.disabled=false;loginStatus.textContent=error?"登入失敗，請確認密碼是否正確。":"登入成功，正在開啟後台…";});
document.querySelector("#toggle-password").addEventListener("click",()=>{const input=document.querySelector("#admin-password");const showing=input.type==="text";input.type=showing?"password":"text";document.querySelector("#toggle-password").textContent=showing?"顯示":"隱藏";});
document.querySelector("#change-password-button").addEventListener("click",()=>{passwordForm.reset();document.querySelector("#password-status").textContent="";passwordDialog.showModal();});
document.querySelector(".password-close").addEventListener("click",()=>passwordDialog.close());
passwordForm.addEventListener("submit",async(e)=>{e.preventDefault();const data=new FormData(passwordForm);const password=String(data.get("newPassword"));const confirm=String(data.get("confirmPassword"));const status=document.querySelector("#password-status");if(password!==confirm){status.textContent="兩次輸入的密碼不一致。";return;}status.textContent="正在儲存…";const {error}=await supabase.auth.updateUser({password});if(error){status.textContent=`儲存失敗：${error.message}`;return;}status.textContent="密碼已更新完成。";setTimeout(()=>passwordDialog.close(),1000);});
document.querySelector("#logout-button").addEventListener("click",async()=>{++overviewRun;sendOverview("wan-teacher-disconnected",null);await supabase.auth.signOut();showLogin("已安全登出。");});
document.querySelector("#manual-add-button").addEventListener("click",openManualForm);document.querySelector(".manual-close").addEventListener("click",()=>manualDialog.close());
document.querySelector("#refresh-button").addEventListener("click",loadData);document.querySelector("#export-button").addEventListener("click",exportCsv);document.querySelectorAll("#search-input,#cohort-filter,#status-filter").forEach(el=>el.addEventListener(el.tagName==="INPUT"?"input":"change",renderRows));document.querySelector("#student-dialog .dialog-close").addEventListener("click",()=>dialog.close());dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
const {data:{session}}=await supabase.auth.getSession();session?showDashboard():showLogin();supabase.auth.onAuthStateChange((_event,next)=>{if(next&&dashboardView.hidden)showDashboard();});

function populateManualCohorts(){
  const code=manualForm.elements.courseCode.value;
  const select=manualForm.elements.cohortId;
  select.required=code==="TEACHER-TRAINING";
  select.innerHTML=`<option value="">${select.required?"請選擇師資培訓梯次":"由學員在課前表單選擇"}</option>`+cohorts.filter(c=>c.courses?.code===code).map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.title)}</option>`).join("");
}
manualForm.elements.courseCode.addEventListener("change",()=>{populateManualCohorts();manualForm.elements.amountTwd.value="";});
document.querySelector("#course-filter").addEventListener("change",()=>{populateCohorts();updateMetrics();renderRows();});
document.querySelectorAll("[data-course-scope]").forEach(button => button.addEventListener("click", () => {
  document.querySelector("#course-filter").value = button.dataset.courseScope;
  document.querySelector("#cohort-filter").value = "";
  document.querySelector("#status-filter").value = "";
  document.querySelector("#search-input").value = "";
  populateCohorts(); updateMetrics(); renderRows();
}));

const setupDialog=document.querySelector("#training-setup-dialog");
const setupForm=document.querySelector("#training-setup-form");
function addSessionEditor(session={}){
  const localTime=value=>value?new Date(new Date(value).getTime()+8*60*60*1000).toISOString().slice(0,16):"";
  const row=document.createElement("div");row.className="training-session-row";
  row.innerHTML=`<label>課堂名稱<input data-session-title required maxlength="120" value="${escapeHtml(session.title)}"></label><label>開始<input data-session-start type="datetime-local" required value="${localTime(session.starts_at)}"></label><label>結束<input data-session-end type="datetime-local" required value="${localTime(session.ends_at)}"></label><button type="button" aria-label="移除此堂課">移除</button>`;
  row.querySelector("button").addEventListener("click",()=>row.remove());document.querySelector("#training-session-editor").append(row);
}
function fillSetup(){
  const setting=trainingSettings.find(s=>s.cohort_id===setupForm.elements.cohortId.value);
  const toggle=document.querySelector("#training-toggle-registration");
  toggle.hidden=!setting;toggle.textContent=setting?.cohorts?.active?"暫停此梯次報名":"開放此梯次報名";
  const configuredMethods=setting?.payment_methods;
  document.querySelector('#training-installment-label').hidden=Boolean(configuredMethods);
  document.querySelector('#training-installment-help').hidden=Boolean(configuredMethods);
  const methodsPanel=document.querySelector('#training-payment-methods');methodsPanel.hidden=!configuredMethods;
  methodsPanel.innerHTML=configuredMethods?`<h3>付款方式</h3><ul>${configuredMethods.map(m=>`<li>${escapeHtml(m.label)}：待設定</li>`).join('')}</ul><p>信用卡分期由金流及銀行處理，不使用本系統的等額分期收款。付款通路完成前請保留草稿。</p>`:'';
  setupForm.elements.title.value=setting?.cohorts?.title||"";
  setupForm.elements.description.value=setting?.description||"";
  setupForm.elements.amountTwd.value=setting?.pricing_plans?.total_amount_twd||"";
  setupForm.elements.installmentCount.value=setting?.pricing_plans?.installment_count||1;
  setupForm.elements.active.checked=setting?.cohorts?.active===true;
  document.querySelector("#training-session-editor").replaceChildren();
  (setting?.training_sessions||[]).slice().sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).forEach(addSessionEditor);
  document.querySelector("#training-setup-status").textContent="";
}
function setupOptions(selected=""){
  setupForm.elements.cohortId.innerHTML='<option value="">＋ 建立新梯次</option>'+trainingSettings.map(s=>`<option value="${escapeHtml(s.cohort_id)}">${escapeHtml(s.cohorts?.title)}${s.cohorts?.active?"（開放中）":"（草稿）"}</option>`).join("");
  setupForm.elements.cohortId.value=selected;fillSetup();
}
document.querySelector("#training-setup-button").addEventListener("click",()=>{setupOptions();setupDialog.showModal();});
document.querySelector("#training-setup-close").addEventListener("click",()=>setupDialog.close());
document.querySelector("#training-add-session").addEventListener("click",()=>addSessionEditor());
setupForm.elements.cohortId.addEventListener("change",fillSetup);
setupForm.addEventListener("submit",async event=>{
  event.preventDefault();if(!setupForm.reportValidity())return;
  const button=document.querySelector("#training-setup-save");const status=document.querySelector("#training-setup-status");
  const data=Object.fromEntries(new FormData(setupForm));
  const sessions=[...document.querySelectorAll(".training-session-row")].map(row=>({title:row.querySelector("[data-session-title]").value.trim(),startsAt:row.querySelector("[data-session-start]").value+":00+08:00",endsAt:row.querySelector("[data-session-end]").value+":00+08:00"}));
  if(Number(data.amountTwd)%Number(data.installmentCount)!==0){status.textContent="總費用須可整除分期期數。";return;}
  if(sessions.some(s=>new Date(s.endsAt)<=new Date(s.startsAt))){status.textContent="每堂課的結束時間必須晚於開始時間。";return;}
  if(setupForm.elements.active.checked&&!sessions.length){status.textContent="開放報名前請至少設定一堂課。";return;}
  button.disabled=true;status.textContent="正在儲存…";
  try{
    const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("請重新登入");
    const response=await fetch(config.adminEndpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:"save_training_setup",settings:{...data,active:setupForm.elements.active.checked,sessions}})});
    const result=await response.json();if(!response.ok)throw new Error(result.message||"儲存失敗");
    await loadData();setupOptions(result.cohortId);status.textContent=setupForm.elements.active.checked?"已儲存並開放報名。":"草稿已儲存，尚未開放報名。";
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});

document.querySelector("#training-toggle-registration").addEventListener("click",async()=>{
  const setting=trainingSettings.find(s=>s.cohort_id===setupForm.elements.cohortId.value);if(!setting)return;
  const button=document.querySelector("#training-toggle-registration");const status=document.querySelector("#training-setup-status");button.disabled=true;
  try{
    const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("請重新登入");
    const response=await fetch(config.adminEndpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:"set_training_registration",cohortId:setting.cohort_id,active:!setting.cohorts.active})});
    const result=await response.json();if(!response.ok)throw new Error(result.message||"更新失敗");
    await loadData();setupOptions(setting.cohort_id);status.textContent="報名狀態已更新；課表與費用保持原設定。";
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});

const paymentLinkDialog=document.querySelector('#payment-link-dialog');
const paymentLinkForm=document.querySelector('#payment-link-form');
function fillPaymentLink(){
 const setting=trainingSettings.find(s=>s.cohort_id===paymentLinkForm.elements.cohortId.value);
 const link=setting?.training_payment_links?.find(l=>l.channel===paymentLinkForm.elements.channel.value);
 paymentLinkForm.elements.url.value=link?.payment_url||'';
 paymentLinkForm.elements.amountTwd.value=link?.amount_twd||setting?.pricing_plans?.total_amount_twd||'';
 paymentLinkForm.elements.active.checked=link?.active===true;
}
document.querySelector('#payment-link-button').addEventListener('click',()=>{
 paymentLinkForm.reset();paymentLinkForm.elements.cohortId.innerHTML=trainingSettings.map(s=>`<option value="${escapeHtml(s.cohort_id)}">${escapeHtml(s.cohorts?.title)}</option>`).join('');
 fillPaymentLink();document.querySelector('#payment-link-status').textContent='';paymentLinkDialog.showModal();
});
document.querySelector('#payment-link-close').addEventListener('click',()=>paymentLinkDialog.close());
paymentLinkForm.elements.cohortId.addEventListener('change',fillPaymentLink);
paymentLinkForm.elements.channel.addEventListener('change',fillPaymentLink);
paymentLinkForm.addEventListener('submit',async event=>{
 event.preventDefault();if(!paymentLinkForm.reportValidity())return;
 const button=paymentLinkForm.querySelector('button');const status=document.querySelector('#payment-link-status');button.disabled=true;
 try{
 const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('請重新登入');
 const response=await fetch(config.adminEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({...Object.fromEntries(new FormData(paymentLinkForm)),action:'save_training_payment_link',active:paymentLinkForm.elements.active.checked})});
 const result=await response.json();if(!response.ok)throw new Error(result.message||'儲存失敗');await loadData();status.textContent='付款連結已儲存；交易查核與報名狀態不會因開啟連結而變更。';
 }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
});

function renderRevenue(){
 const model=window.BP_REVENUE,current=model.month(),code=document.querySelector('#course-filter').value;
 document.querySelector('#revenue-month-title').textContent=`${current.replace('-',' 年 ')} 月營業額`;
 if(monthlyRevenue===null){
  ['#revenue-received','#revenue-transactions','#revenue-previous'].forEach(id=>document.querySelector(id).textContent='暫無資料');
  document.querySelector('#revenue-orders').textContent='';document.querySelector('#revenue-change').textContent='';
  document.querySelector('#revenue-note').textContent='月份統計尚未載入，請重新整理；此狀態不代表營業額為 0。';document.querySelector('#revenue-history-button').disabled=true;return;
 }
 document.querySelector('#revenue-history-button').disabled=false;
 const rows=model.rows(monthlyRevenue,code,'',current),zero={received:0,transactions:0,orders:0};
 const now=rows.find(r=>r.month===current)||zero,prev=rows.find(r=>r.month===model.previous(current))||zero;
 document.querySelector('#revenue-received').textContent=money(now.received);
 document.querySelector('#revenue-transactions').textContent=now.transactions+' 筆';
 document.querySelector('#revenue-orders').textContent=`${now.orders} 筆報名有收款`;
 document.querySelector('#revenue-previous').textContent=money(prev.received);
 const change=prev.received?`${now.received>=prev.received?'+':''}${((now.received-prev.received)/prev.received*100).toFixed(1)}%`:'上月為 0，不計百分比';
 document.querySelector('#revenue-change').textContent=`${change}（當月累計）`;
 document.querySelector('#revenue-note').textContent=(now.transactions?'':'當月尚無已確認收款。')+'僅統計系統已確認的款項，不等於銀行撥款或扣除手續費、退款後的淨收入。未登記的 PAYUNi 款項不會自動出現。'+(rows.some(r=>r.estimated)?' 部分舊紀錄缺少確認日期，暫以通知／建檔日期歸月。':'');
}
function revenueHistoryRows(){return window.BP_REVENUE.rows(monthlyRevenue||[],document.querySelector('#revenue-course').value,document.querySelector('#revenue-year').value);}
function renderRevenueHistory(){
 const rows=revenueHistoryRows(),total=rows.reduce((s,r)=>s+r.received,0),count=rows.reduce((s,r)=>s+r.transactions,0),peak=Math.max(0,...rows.map(r=>r.received));
 document.querySelector('#revenue-history-scope').textContent=document.querySelector('#revenue-course').selectedOptions[0].textContent;
 document.querySelector('#revenue-statistics').innerHTML=`<article>所選期間收款合計<strong>${money(total)}</strong></article><article>平均每月收款<strong>${money(rows.length?Math.round(total/rows.length):0)}</strong><small>含零收款月與未結束的當月</small></article><article>收款筆數<strong>${count} 筆</strong></article><article>最高收款月份<strong>${peak?rows.filter(r=>r.received===peak).map(r=>r.month).join('、'):'尚無收款'}</strong><small>${money(peak)}</small></article>`;
 document.querySelector('#revenue-months').innerHTML=rows.map(r=>`<tr><td>${escapeHtml(r.month)}${r.month===window.BP_REVENUE.month()?'（本月）':''}</td><td>${money(r.received)}</td><td>${r.transactions}</td><td>${r.orders}</td><td><div class="revenue-bar" aria-label="${escapeHtml(r.month)} ${money(r.received)}"><span style="width:${peak?r.received/peak*100:0}%"></span></div></td></tr>`).join('');
}
document.querySelector('#revenue-history-button').addEventListener('click',()=>{
 const current=window.BP_REVENUE.month().slice(0,4),years=[...new Set([current,...(monthlyRevenue||[]).map(r=>r.month.slice(0,4))])].sort().reverse();
 document.querySelector('#revenue-year').innerHTML='<option value="">全部年份</option>'+years.map(y=>`<option value="${y}">${y} 年</option>`).join('');
 document.querySelector('#revenue-year').value=current;document.querySelector('#revenue-course').value=document.querySelector('#course-filter').value;
 renderRevenueHistory();document.querySelector('#revenue-history-dialog').showModal();
});
document.querySelector('#revenue-history-close').addEventListener('click',()=>document.querySelector('#revenue-history-dialog').close());
document.querySelectorAll('#revenue-course,#revenue-year').forEach(e=>e.addEventListener('change',renderRevenueHistory));
document.querySelector('#revenue-export').addEventListener('click',()=>{
 const csv='\uFEFF'+[['月份','已確認收款TWD','收款筆數','付款報名數'],...revenueHistoryRows().map(r=>[r.month,r.received,r.transactions,r.orders])].map(r=>r.join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`營業額-${document.querySelector('#revenue-course').value||'合併'}-${document.querySelector('#revenue-year').value||'歷年'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
