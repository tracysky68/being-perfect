(async()=>{
 const status=document.querySelector('#payment-link-status');const container=document.querySelector('#payment-links');
 const requested=new URLSearchParams(location.search).get('cohort');
 try{
 const response=await fetch(window.BP_CONFIG.trainingPaymentLinksEndpoint);if(!response.ok)throw new Error('目前無法載入付款連結，請稍後重試或聯絡課程行政。');
 const result=await response.json();const links=(result.links||[]).filter(l=>!requested||l.cohortId===requested);
 if(!links.length){status.textContent='目前尚無開放的付款連結，請聯絡課程行政。';return;}
 for(const item of links){
  const url=new URL(item.url);
  if(url.protocol!=='https:'||!(url.hostname==='payuni.com.tw'||url.hostname.endsWith('.payuni.com.tw'))||url.username||url.password||url.port||Number(item.amountTwd)!==39800)continue;
  const label={payuni_hosted:'前往 PAYUNi（信用卡／ATM）',payuni_credit_installments:'前往 PAYUNi 信用卡付款',cardless_installments:'前往 PAYUNi 無卡分期'}[item.channel];if(!label)continue;
  const card=document.createElement('section');const title=document.createElement('p');title.textContent=item.title;
  const a=document.createElement('a');a.className='button dark checkout-button';a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label+' →';card.append(title,a);container.append(card);
 }
 status.textContent=container.children.length?'課程總費用 NT$39,800。請核對付款頁的課程名稱與金額。':'付款連結驗證未通過，請聯絡課程行政。';
 }catch(e){status.textContent=e.message;}
})();
