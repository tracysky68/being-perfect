// Pure monthly calculations shared by the dashboard and tests.
window.BP_REVENUE = {
 month(date=new Date()) { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'}).formatToParts(date);return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}`; },
 rows(data,code='',year='',today=this.month()) {
  const selected=data.filter(r=>!code||r.course_code===code);
  const byMonth=new Map();
  for(const r of selected){const v=byMonth.get(r.month)||{month:r.month,received:0,transactions:0,orders:0,estimated:0};v.received+=Number(r.received);v.transactions+=Number(r.transaction_count);v.orders+=Number(r.enrollment_count);v.estimated+=Number(r.estimated_dates||0);byMonth.set(r.month,v);}
  const first=year?`${year}-01`:[today,...data.map(r=>r.month)].sort()[0];
  const last=year?(`${year}`===today.slice(0,4)?today:`${year}-12`):today;
  const out=[];for(let m=first;m<=last;){out.push(byMonth.get(m)||{month:m,received:0,transactions:0,orders:0,estimated:0});let [y,n]=m.split('-').map(Number);n++;if(n===13){y++;n=1;}m=`${y}-${String(n).padStart(2,'0')}`;}
  return out.reverse();
 },
 previous(month){let [y,m]=month.split('-').map(Number);m--;if(!m){y--;m=12;}return `${y}-${String(m).padStart(2,'0')}`;}
};
