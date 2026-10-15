import { calculate } from './calculator.js';
const $=id=>document.getElementById(id),form=$('calculator');let last=null;
const mode=()=>new FormData(form).get('mode');
const groupNumber=s=>{const [a,b]=String(s).split('.');return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(b?'.'+b:'');};
const displayMoney=(s,c)=>`${c} ${groupNumber(s)}`;
function compact(s){const [a,b='']=s.split('.');const v=a+(b?'.'+b.slice(0,6).replace(/0+$/,''):'').replace(/\.$/,'');return v==='0'&&/[1-9]/.test(s)?'< 0.000001':v;}
function options(){
 const market=$('market').value;const values=market==='TW'?[['1','1 股 · 可買零股'],['1000','1,000 股 · 只買整張'],['custom','自訂每單位股數']]:[['1','1 股 · 整股'],['0.01','0.01 股 · 券商須支援零碎股'],['custom','自訂每單位股數']];
 $('step-choice').replaceChildren(...values.map(([v,t])=>new Option(t,v)));
}
function visibility(){
 const ark=mode()==='ark',quote=$('market').value==='TW'?'TWD':'USD';
 $('k-group').hidden=!ark;$('fx-group').hidden=quote===$('currency').value;
 $('custom-step-group').hidden=$('step-choice').value!=='custom';
 $('price-currency').textContent=quote;
 $('mode-note').textContent=ark?'使用已還原的股數算式；策略 K(9) 請自行提供。':'把預算平均分配到指定檔數，再按每股價格換算。';
 $('result-mode').textContent=ark?'方舟公式重建':'預算換算';
}
function inputs(){return {mode:mode(),market:$('market').value,currency:$('currency').value,budget:$('budget').value,count:$('count').value,price:$('price').value,k:$('k').value,fx:$('fx').value,step:$('step-choice').value==='custom'?$('custom-step').value:$('step-choice').value};}
function update(){
 visibility();$('stock-label').textContent=$('symbol').value.trim()||'自訂標的';
 try{
  const r=calculate(inputs());last={...r,symbol:$('symbol').value.trim()};$('error').hidden=true;$('download').disabled=false;
  $('result-quantity').replaceChildren(document.createTextNode(groupNumber(r.shares)),Object.assign(document.createElement('span'),{textContent:'股'}));
  let unit=r.market==='TW'?`${groupNumber(r.lots)} 張 ＋ ${groupNumber(r.oddShares)} 股`:`${groupNumber(r.units)} 個單位 × ${r.step} 股`;
  if(r.zero)unit=r.mode==='ark'&&r.modelShares==='0'?'方舟公式截位後為 0 股，可改用預算換算檢視資金。':'目前預算不足一個所選交易單位。';
  $('unit-summary').textContent=unit;
  $('allocated').textContent=displayMoney(compact(r.allocation),r.currency);
  $('cost').textContent=displayMoney(compact(r.cost),r.currency);
  $('remaining').textContent=displayMoney(compact(r.remaining),r.currency);
  $('quote-cost').textContent=r.cross?`原幣股票價金：${displayMoney(compact(r.costQuote),r.quote)} · 1 USD = ${r.fx} TWD`:'';
  $('model-panel').hidden=r.mode!=='ark';
  if(r.mode==='ark'){$('model-shares').textContent=groupNumber(r.modelShares)+' 股';$('model-amount').textContent=displayMoney(r.modelAmount,r.currency);}
 }catch(e){
  last=null;$('result-quantity').replaceChildren(document.createTextNode('—'));$('unit-summary').textContent='補齊有效資料後會重新計算。';$('error').hidden=false;$('error').textContent=e.message;
  for(const id of ['allocated','cost','remaining'])$(id).textContent='—';$('quote-cost').textContent='';$('model-panel').hidden=true;$('download').disabled=true;
 }
}
form.addEventListener('submit',e=>{e.preventDefault();update();});
form.addEventListener('input',()=>{$('example-note').textContent='使用你輸入的條件試算；價格與策略參數不會自動更新。';update();});
$('market').addEventListener('change',()=>{options();$('price').value='';$('example-note').textContent='市場已切換，請重新填入每股價格，避免混用幣別。';update();});
form.addEventListener('change',update);
$('example').addEventListener('click',()=>{$('market').value='TW';$('currency').value='TWD';options();$('symbol').value='範例';$('budget').value='100000';$('count').value='5';$('price').value='50';$('k').value='4';$('fx').value='';$('custom-step').value='';$('example-note').textContent='假設範例：100,000 元、5 檔、50 元；策略 K9 = 4 僅為示範。';update();});
function csvCell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
$('download').addEventListener('click',()=>{if(!last)return;const rows=[['欄位','數值'],['試算時間',new Date().toISOString()],['股票代號',last.symbol],['模式',last.mode],['市場',last.market],['預算幣別',last.currency],['總布局預算',last.budget],['分配檔數',last.count],['每股價格',last.price],['股價幣別',last.quote],['USD/TWD',last.fx],['策略K9',last.k],['每單位股數',last.step],['可買股數',last.shares],['預估股票價金',last.cost],['每檔剩餘預算',last.remaining],['公式股數',last.modelShares],['公式顯示金額',last.modelAmount],['說明','未含手續費與滑價；策略K9由使用者提供，非官方選股建議。']];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='股數試算-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
update();
