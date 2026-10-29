const form = document.querySelector('#training-registration');
const loadStatus = document.querySelector('#load-status');
const money = n => `NT$${Number(n).toLocaleString('zh-TW')}`;
let catalog;
function selectedPlan() {
  const setting = catalog?.trainingSettings?.find(s => s.cohort_id === form.elements.cohortId.value);
  const planCode = setting?.pricing_plans?.code;
  return catalog?.pricingPlans?.find(p => p.code === planCode && p.eligibility === 'public');
}
function selectedMethods() {
  return catalog?.trainingSettings?.find(s=>s.cohort_id===form.elements.cohortId.value)?.payment_methods;
}
function updatePayment() {
  const plan = selectedPlan();
  if (!plan) { form.querySelector('button').disabled = true; return; }
  const methods = selectedMethods();
  if (methods) {
    const method=methods.find(m=>m.code===form.elements.paymentOption.value);
    document.querySelector('#total-price').textContent=money(plan.totalAmountTwd);
    document.querySelector('#payment-summary').textContent=method?.note || '請選擇付款方式。';
    form.elements.pricingCode.value=plan.code;
    form.querySelector('button').textContent='付款方式設定中，尚未開放報名';
    form.querySelector('button').disabled=true;
    return;
  }
  const installments = form.elements.paymentOption.value === 'installments';
  document.querySelector('#total-price').textContent = money(plan.totalAmountTwd);
  document.querySelector('#payment-summary').textContent = installments
    ? `本次支付第 1 期 ${money(plan.installmentAmountTwd)}；共 ${plan.installmentCount} 期，後續尚需支付 ${money(plan.totalAmountTwd - plan.installmentAmountTwd)}。`
    : `本次付款 ${money(plan.totalAmountTwd)}`;
  form.elements.pricingCode.value = plan.code;
  form.querySelector('button').disabled = false;
}
function updateCohort() {
  const setting = catalog.trainingSettings.find(s => s.cohort_id === form.elements.cohortId.value);
  const plan = selectedPlan();
  document.querySelector('#course-description').textContent = setting?.description || catalog.course?.description || '';
  const list = document.querySelector('#training-schedule'); list.replaceChildren();
  const formatter = new Intl.DateTimeFormat('zh-TW',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Taipei'});
  (setting?.training_sessions || []).slice().sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).forEach(s => {
    const li = document.createElement('li'); li.textContent = s.title;
    const span = document.createElement('span'); span.textContent = `${formatter.format(new Date(s.starts_at))} ～ ${formatter.format(new Date(s.ends_at))}`;
    li.append(span); list.append(li);
  });
  const methods=selectedMethods();
  const methodList=document.querySelector('#payment-method-list');
  methodList.hidden=true;
  const options=methods?methods.map(m=>({value:m.code,label:m.label,note:'付款資訊待設定'})):[{value:'full',label:'一次付清',note:`本次付款 ${money(plan.totalAmountTwd)}`},...(plan?.installmentCount>1?[{value:'installments',label:`分 ${plan.installmentCount} 期付款`,note:`每期 ${money(plan.installmentAmountTwd)}`}]:[])];
  const container=document.querySelector('#training-payment-options');container.replaceChildren();
  options.forEach((option,index)=>{
    const label=document.createElement('label');label.className='payment-choice';
    const input=document.createElement('input');input.type='radio';input.name='paymentOption';input.value=option.value;input.checked=index===0;
    const span=document.createElement('span');const title=document.createElement('b');title.textContent=option.label;
    const small=document.createElement('small');small.textContent=option.note;span.append(title,small);label.append(input,span);container.append(label);
  });
  updatePayment();
}
async function load() {
  try {
    const response = await fetch(`${window.BP_CONFIG.cohortsEndpoint}?courseCode=TEACHER-TRAINING`);
    if (response.status === 404) { loadStatus.textContent = '師資培訓班尚未開放報名，日期與費用確認後會在這裡公布。'; return; }
    catalog = await response.json();
    if (!response.ok) throw new Error('目前無法載入報名資料，請稍後重新整理。');
    const available = (catalog.cohorts || []).filter(c => catalog.trainingSettings?.some(s=>s.cohort_id===c.id && s.training_sessions?.length && catalog.pricingPlans.some(p=>p.code===s.pricing_plans?.code && p.eligibility==='public')));
    if (!available.length) { loadStatus.textContent = '目前尚無開放報名梯次。'; return; }
    available.forEach(c=>form.elements.cohortId.add(new Option(c.title,c.id)));
    const requested = new URLSearchParams(location.search).get('cohort');
    if (requested && available.some(c=>c.id===requested)) form.elements.cohortId.value=requested;
    updateCohort(); form.hidden=false; loadStatus.hidden=true;
  } catch (e) { loadStatus.textContent=e.message; }
}
form.elements.cohortId.addEventListener('change',updateCohort);
document.querySelector('#training-payment-options').addEventListener('change',updatePayment);
form.addEventListener('submit',async event=>{
  event.preventDefault(); if (selectedMethods() || !form.reportValidity() || !selectedPlan()) return;
  const button=form.querySelector('button'); const status=document.querySelector('#payment-status');
  button.disabled=true; status.textContent='正在建立報名與付款訂單…';
  try {
    const response=await fetch(window.BP_CONFIG.paymentEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});
    const result=await response.json(); if(!response.ok)throw new Error(result.message || '目前無法建立訂單');
    const target=new URL(result.paymentUrl);
    if(target.protocol!=='https:' || !['api.payuni.com.tw','sandbox-api.payuni.com.tw'].includes(target.hostname))throw new Error('付款連結驗證失敗，請聯絡客服。');
    const payment=document.createElement('form'); payment.method='POST'; payment.action=target.href;
    Object.entries(result.fields).forEach(([name,value])=>{const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;payment.append(input);});
    document.body.append(payment); payment.submit();
  } catch(e) {status.textContent=e.message;button.disabled=false;}
});
load();
