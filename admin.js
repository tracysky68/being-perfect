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
let records = [];

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
  records = result.records;
  updateMetrics(); populateCohorts(); renderRows();
  document.querySelector("#last-updated").textContent = `更新：${dateTime(new Date())}`;
}

function updateMetrics() {
  document.querySelector("#metric-total").textContent = records.length;
  document.querySelector("#metric-paid").textContent = records.filter(r=>["paid","partially_paid"].includes(r.status)).length;
  document.querySelector("#metric-intake").textContent = records.filter(r=>r.intake).length;
  document.querySelector("#metric-action").textContent = records.filter(r=>["payment_failed","refunding"].includes(r.status)||r.emailStatus==="failed").length;
}

function populateCohorts() {
  const select = document.querySelector("#cohort-filter");
  const current = select.value;
  select.innerHTML = '<option value="">全部梯次</option>'+[...new Set(records.map(r=>r.cohort))].sort().map(v=>`<option>${escapeHtml(v)}</option>`).join("");
  select.value = current;
}

function filteredRecords() {
  const query = document.querySelector("#search-input").value.trim().toLowerCase();
  const cohort = document.querySelector("#cohort-filter").value;
  const status = document.querySelector("#status-filter").value;
  return records.filter((r) => {
    const matchesQuery = !query || [r.name,r.email,r.phone,r.orderNumber].some(v=>String(v).toLowerCase().includes(query));
    const matchesCohort = !cohort || r.cohort === cohort;
    const matchesStatus = !status || (status === "paid" && ["paid","partially_paid"].includes(r.status)) || (status === "pending" && r.status === "pending_payment") || (status === "action" && (["payment_failed","refunding"].includes(r.status)||r.emailStatus==="failed")) || (status === "complete" && r.intake);
    return matchesQuery && matchesCohort && matchesStatus;
  });
}

function renderRows() {
  const list = filteredRecords();
  tbody.innerHTML = list.map((r)=>`<tr data-id="${r.id}"><td><div class="person"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.email)}</span><span>${escapeHtml(r.phone)}</span></div></td><td><b>${escapeHtml(r.cohort)}</b><div class="subtle">${r.sessions.map(s=>escapeHtml(s.title)).join("、")||"尚未選擇日期"}</div></td><td>${paymentBadge(r)}<div class="subtle">${money(r.amountTwd)} · ${escapeHtml(r.paymentOptionLabel)}</div></td><td>${r.intake?badge("已完成","good"):badge("待填寫","warn")}</td><td>${r.emailStatus==="sent"?badge("已寄送","good"):r.emailStatus==="failed"?badge("寄送失敗","bad"):badge("尚未寄送")}</td><td class="row-arrow">→</td></tr>`).join("");
  document.querySelector("#loading-state").hidden = true;
  document.querySelector("#empty-state").hidden = list.length > 0;
  table.hidden = list.length === 0;
  tbody.querySelectorAll("tr").forEach(row=>row.addEventListener("click",()=>openDetail(row.dataset.id)));
}

function openDetail(id) {
  const r = records.find(item=>item.id===id); if(!r)return;
  const intake = r.intake;
  document.querySelector("#student-detail").innerHTML = `<div class="detail-head"><span class="section-no">STUDENT FILE</span><h2>${escapeHtml(r.name)}</h2><p>${escapeHtml(r.cohort)} · ${escapeHtml(r.orderNumber)}</p></div><div class="detail-grid"><section class="detail-section"><h3>聯絡與付款</h3><dl><dt>Email</dt><dd>${escapeHtml(r.email)}</dd><dt>手機</dt><dd>${escapeHtml(r.phone)}</dd><dt>付款狀態</dt><dd>${paymentBadge(r)} ${money(r.amountTwd)}</dd><dt>付款時間</dt><dd>${dateTime(r.paidAt)}</dd><dt>確認信</dt><dd>${escapeHtml(r.emailStatusLabel)}</dd></dl></section><section class="detail-section"><h3>上課日期</h3><dl>${r.sessions.map(s=>`<dt>${s.module==="day_1"?"第一天":"第二天"}</dt><dd>${escapeHtml(s.title)}<br>${dateTime(s.startsAt)}</dd>`).join("")||"尚未選擇"}</dl></section>${intake?`<section class="detail-section"><h3>教學背景</h3><dl><dt>目前身分</dt><dd>${escapeHtml(intake.currentRole)}</dd><dt>單位</dt><dd>${escapeHtml(intake.organization)||"—"}</dd><dt>年資</dt><dd>${escapeHtml(intake.teachingYears)}</dd><dt>學生年齡</dt><dd>${tags(intake.studentAgeGroups)}</dd><dt>藝術背景</dt><dd>${escapeHtml(intake.artBackground)}</dd><dt>教育背景</dt><dd>${escapeHtml(intake.educationBackground)}</dd></dl></section><section class="detail-section"><h3>教學需求</h3><dl><dt>主要挑戰</dt><dd>${tags(intake.mainChallenges)}</dd><dt>最想釐清</dt><dd>${escapeHtml(intake.focusQuestions)}</dd><dt>學習期待</dt><dd>${escapeHtml(intake.learningExpectations)}</dd></dl></section><section class="detail-section wide"><h3>補充資料</h3><dl><dt>案例描述</dt><dd>${escapeHtml(intake.caseDescription)||"—"}</dd><dt>其他備註</dt><dd>${escapeHtml(intake.additionalNotes)||"—"}</dd><dt>作品使用同意</dt><dd>${intake.artworkPermission?"同意":"不同意"}</dd><dt>提交時間</dt><dd>${dateTime(intake.submittedAt)}</dd></dl></section>`:`<section class="detail-section wide"><h3>課前資料</h3><p>學員尚未完成填寫。</p></section>`}</div>`;
  dialog.showModal();
}

function exportCsv() {
  const rows = filteredRecords().map(r=>[r.name,r.email,r.phone,r.cohort,r.status,r.amountTwd,r.sessions.map(s=>s.title).join(" / "),r.intake?"已完成":"待填寫",r.emailStatusLabel]);
  const csv = [["姓名","Email","手機","梯次","付款狀態","金額","上課場次","課前資料","寄信狀態"],...rows].map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const link = document.createElement("a"); link.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"})); link.download=`玩美學學員名單-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function showLogin(message="") { loginView.hidden=false; dashboardView.hidden=true; loginStatus.textContent=message; }
function showDashboard() { loginView.hidden=true; dashboardView.hidden=false; loadData().catch(error=>{document.querySelector("#loading-state").innerHTML=`<p>${escapeHtml(error.message)}</p>`;}); }
loginForm.addEventListener("submit",async(e)=>{e.preventDefault();const email=document.querySelector("#admin-email").value.trim();loginStatus.textContent="正在寄送登入連結…";const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:"https://beingperfect.com.tw/admin.html"}});loginStatus.textContent=error?`寄送失敗：${error.message}`:"登入連結已寄出，請到信箱點擊後回到這裡。";});
document.querySelector("#logout-button").addEventListener("click",async()=>{await supabase.auth.signOut();showLogin("已安全登出。");});
document.querySelector("#refresh-button").addEventListener("click",loadData);document.querySelector("#export-button").addEventListener("click",exportCsv);document.querySelectorAll("#search-input,#cohort-filter,#status-filter").forEach(el=>el.addEventListener(el.tagName==="INPUT"?"input":"change",renderRows));document.querySelector(".dialog-close").addEventListener("click",()=>dialog.close());dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
const {data:{session}}=await supabase.auth.getSession();session?showDashboard():showLogin();supabase.auth.onAuthStateChange((_event,next)=>{if(next&&dashboardView.hidden)showDashboard();});

