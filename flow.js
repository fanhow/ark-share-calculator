import {calculatePortfolio} from './portfolio.js';
const $=id=>document.getElementById(id),form=$('portfolio-form');let result=null,linked=false,touched=false;
const fmt=value=>{const [a,b]=String(value).split('.');return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(b?'.'+b:'');};
function showStep(step){
 const first=step==='allocation';$('allocation-step').hidden=!first;$('shares-step').hidden=first;
 for(const b of document.querySelectorAll('[data-step]')){const active=b.dataset.step===step;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));}
 $('flow-caption').textContent=first?'01 / 先決定本次要布局多少資金':'02 / 再換算每檔股票可買幾股';
}
for(const button of document.querySelectorAll('[data-step]'))button.addEventListener('click',()=>showStep(button.dataset.step));
function values(){return {currency:$('portfolio-currency').value,stockTW:$('stock-tw').value,stockUS:$('stock-us').value,cashTWD:$('cash-twd').value,cashUSD:$('cash-usd').value,ratio:$('target-ratio').value,fx:$('portfolio-fx').value};}
function update(){
 const currency=$('portfolio-currency').value;
 for(const el of document.querySelectorAll('.stock-currency'))el.textContent=currency;
 const v=values(),foreign=currency==='TWD'?v.cashUSD:v.cashTWD;
 $('portfolio-fx-group').hidden=/^0*(\.0*)?$/.test(foreign.trim());
 try{
  const r=calculatePortfolio(v);result=r;$('portfolio-error').hidden=true;
  $('gauge-value').textContent=Number(r.ratio).toLocaleString('en-US',{maximumFractionDigits:2});$('gauge-value').title='輸入比例：'+r.ratio+'%（圖示最多顯示兩位小數）';$('gauge').style.setProperty('--ratio',Math.max(0,Math.min(100,Number(r.ratio)))+'%');
  $('current-percent').textContent=r.currentPct+'%';$('target-percent').textContent=r.ratio+'%';
  $('current-stock').textContent=fmt(r.stock);$('current-cash').textContent=fmt(r.cash);$('target-stock').textContent=fmt(r.targetStock);$('target-cash').textContent=fmt(r.targetCash);
  $('current-bar').style.width=Math.max(0,Math.min(100,Number(r.currentPct)))+'%';$('target-bar').style.width=Math.max(0,Math.min(100,Number(r.ratio)))+'%';
  $('total-assets').textContent=r.currency+' '+fmt(r.total);
  $('action-label').textContent=r.action==='buy'?'依目標比例可布局':r.action==='reduce'?'依目標比例需調節':'目前配置可維持';
  $('action-amount').textContent=r.currency+' '+fmt(r.amount);
  $('allocation-action').dataset.action=r.action;
  $('continue-shares').disabled=r.action!=='buy';
  $('action-note').textContent=r.action==='buy'?'這筆金額可帶到下一步，再設定分配檔數與個股價格。':r.action==='reduce'?'目前持股超過目標比例。這是需減少的總市值，不會轉成買入預算。':'目前沒有正的布局金額；仍可切換「位階股數」自行試算。';
 }catch(e){
  result=null;$('portfolio-error').hidden=!touched;$('portfolio-error').textContent=e.message;
  for(const id of ['gauge-value','current-percent','target-percent','current-stock','current-cash','target-stock','target-cash','total-assets','action-amount'])$(id).textContent='—';
  $('gauge').style.setProperty('--ratio','0%');$('current-bar').style.width='0%';$('target-bar').style.width='0%';$('action-label').textContent='請補齊配置條件';$('action-note').textContent='無效或缺漏的輸入不會保留上一筆布局結果。';$('continue-shares').disabled=true;
 }
}
function invalidateLink(){if(!linked)return;linked=false;$('budget').value='';$('budget').dispatchEvent(new Event('input',{bubbles:true}));$('budget-origin').hidden=false;$('budget-origin').textContent='第一步條件已變更。請重新帶入布局金額，或自行填寫本次預算。';}
form.addEventListener('input',()=>{touched=true;invalidateLink();$('portfolio-example-note').textContent='依你輸入的配置條件試算；比例不會自動更新。';update();});
form.addEventListener('change',()=>{invalidateLink();update();});
form.addEventListener('submit',e=>{e.preventDefault();update();});
$('portfolio-currency').addEventListener('change',()=>{$('stock-tw').value='';$('stock-us').value='';$('portfolio-example-note').textContent='試算幣別已切換，請重填兩項庫存市值，避免直接重新標記幣別。';update();});
$('portfolio-example').addEventListener('click',()=>{invalidateLink();$('portfolio-currency').value='TWD';$('stock-tw').value='400000';$('stock-us').value='200000';$('cash-twd').value='400000';$('cash-usd').value='0';$('target-ratio').value='70';$('portfolio-fx').value='';$('portfolio-example-note').textContent='純示範：持股60萬、現金40萬、目標70%，布局金額為10萬。';update();});
$('continue-shares').addEventListener('click',()=>{
 if(!result||result.action!=='buy')return;
 $('currency').value=result.currency;$('budget').value=result.buyBudget;
 if(result.fx)$('fx').value=result.fx;else $('fx').value='';
 $('budget').dispatchEvent(new Event('input',{bubbles:true}));linked=true;
 $('budget-origin').hidden=false;$('budget-origin').textContent=`已帶入第一步：${result.currency} ${fmt(result.buyBudget)}。這是依你填入的 ${result.ratio}% 目標比例計算。`;
 showStep('shares');$('shares-step').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
});
$('budget').addEventListener('input',()=>{if(linked){linked=false;$('budget-origin').textContent='本次預算已自行修改，與第一步配置解除連動。';}});
$('currency').addEventListener('change',()=>{if(linked){linked=false;$('budget').value='';$('budget').dispatchEvent(new Event('input',{bubbles:true}));$('budget-origin').textContent='預算幣別已切換，請重新輸入預算或回第一步帶入，避免混用幣別。';}});
$('example').addEventListener('click',()=>{linked=false;$('budget-origin').hidden=true;});
update();showStep('allocation');
