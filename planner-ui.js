import {capital,planStock} from './planner.js';
import {decimal} from './calculator.js';

const $=id=>document.getElementById(id),form=$('planner-form');
const plans=[];let result=null,context=null,importedPrice=null,importedFx=null,manualPrice=false,stale=false,attempted=false,serial=0;
const group=value=>{const [a,b]=String(value).split('.');return a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(b?'.'+b:'');};
const money=(value,currency=$('plan-currency').value)=>currency+' '+group(value);
const element=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const identity=()=>$('plan-market').value+':'+$('plan-symbol').value.trim().toUpperCase();
let previousIdentity=identity();
function values(){return {currency:$('plan-currency').value,total:$('plan-total').value,used:$('plan-used').value,reserve:$('plan-reserve').value,fixed:$('plan-fixed').value,scope:$('plan-scope').value,count:$('plan-count').value,symbol:$('plan-symbol').value,market:$('plan-market').value,price:$('plan-price').value,step:$('plan-step').value,fx:$('plan-fx').value};}
function visibility(){
 $('plan-count-group').hidden=$('plan-scope').value!=='total';
 $('plan-fx-group').hidden=$('plan-currency').value===($('plan-market').value==='TW'?'TWD':'USD');
}
function steps(){
 const options=$('plan-market').value==='TW'?[['1','1 股（可買零股）'],['1000','1,000 股（整張）']]:[['1','1 股'],['0.01','0.01 股（券商須支援）']];
 $('plan-step').replaceChildren(...options.map(([value,label])=>new Option(label,value)));
}
function suggestions(){$('plan-symbols').replaceChildren(...(context?.quotes||[]).filter(q=>q.market===$('plan-market').value).map(q=>new Option(q.symbol,q.symbol)));}
function sourceNote(){
 const symbol=$('plan-symbol').value.trim().toUpperCase();let text;
 if(importedPrice){const q=importedPrice;text=`${q.symbol} ${q.priceType==='close'?'收盤價':q.priceType==='last'?'最近報價':'來源價格'}：${q.price.value} ${q.currency}；來源時點 ${q.price.asOf}；來源：${q.price.source}。${stale?' 最新匯入失敗，這是先前帶入的舊價格，請手動核對。':''}`;}
 else if(manualPrice&&$('plan-price').value.trim())text='目前使用你手動填入的價格；背景更新會保留這個數值。';
 else if(stale)text='背景更新失敗，暫停自動帶入；請手動填寫並核對買入價格。';
 else if(symbol)text='公開摘要尚未提供這個代號與市場的價格，請手動填入買入價格。';
 else text='先輸入你要布局的價值區股票；來源有相同代號與市場的價格時會帶入。';
 if(importedFx&&$('plan-fx').value===importedFx.value&&!$('plan-fx-group').hidden)text+=` 匯率來源時點 ${importedFx.asOf}；來源：${importedFx.source}。${stale?' 最新更新失敗，這是先前帶入的匯率，請核對。':''}`;
 $('plan-source').textContent=text;$('plan-source').classList.toggle('is-stale',stale&&!!(importedPrice||importedFx));
}
function autofill(){
 if(!context){sourceNote();return;}
 const symbol=$('plan-symbol').value.trim().toUpperCase(),market=$('plan-market').value;
 const q=(context.quotes||[]).find(q=>q.symbol===symbol&&q.market===market);
 if(!manualPrice){
  if(q){$('plan-price').value=q.price.value;importedPrice=q;}
  else if(importedPrice){$('plan-price').value='';importedPrice=null;}
 }
 if(context.fx&&!$('plan-fx').value.trim()){$('plan-fx').value=context.fx.value;importedFx=context.fx;}
 sourceNote();
}
function clearResult(){
 result=null;$('plan-shares').replaceChildren(document.createTextNode('—'),element('span','股'));
 for(const id of ['plan-cost','plan-after','plan-more'])$(id).textContent='—';
 $('plan-stock-label').textContent='輸入條件後顯示';$('plan-units').textContent='股數依交易單位向下取整';$('plan-add').disabled=true;
 $('plan-result-note').textContent='以資金上限換算；費用與成交變動請另留現金。';
}
function ledger(){
 $('plan-list').replaceChildren(...plans.map(p=>{
  const li=element('li'),description=element('div'),remove=element('button','移除');
  description.append(element('strong',p.symbol+' · '+group(p.shares)+' 股'),element('span',money(p.reservedCost,p.currency)));
  remove.type='button';remove.setAttribute('aria-label','移除 '+p.symbol+' 的布局');remove.addEventListener('click',()=>{plans.splice(plans.findIndex(x=>x.id===p.id),1);update();});
  li.append(description,remove);return li;
 }));
 try{const c=capital(values(),plans);$('plan-committed').textContent=money(c.planned);$('plan-available').textContent=money(c.available);$('plan-ledger-note').textContent=plans.length?'以上是本次規劃，尚未下單。':'尚未加入股票；可先計算第一檔。';}
 catch{$('plan-committed').textContent=plans.length?money(plans.reduce((sum,p)=>sum.add(decimal(p.reservedCost)),decimal('0')).text(2)):'—';$('plan-available').textContent='—';$('plan-ledger-note').textContent='請補齊有效資金，才能顯示目前可用額度。';}
}
function update(){
 visibility();ledger();sourceNote();
 try{
  const r=planStock(values(),plans);result=r;$('plan-error').hidden=true;
  $('plan-shares').replaceChildren(document.createTextNode(group(r.shares)),element('span','股'));
  $('plan-stock-label').textContent=r.symbol+' · '+(r.market==='TW'?'台股':'美股');
  $('plan-units').textContent=r.market==='TW'?group(r.lots)+' 張 ＋ '+group(r.oddShares)+' 股':group(r.units)+' 個單位 × '+r.step+' 股';
  $('plan-cost').textContent=money(r.reservedCost);$('plan-after').textContent=money(r.layoutRemaining);$('plan-more').textContent=group(r.moreFullStocks)+' 檔';
  $('plan-add').disabled=r.zero;
  $('plan-result-note').textContent=r.zero?'這筆額度不足一個所選下單單位，可調整單位或布局金額。':(r.capped?'已依實際可用資金縮小本檔額度。':'')+'加入清單後才扣除額度；預留價金未含費用與成交變動。';
 }catch(error){clearResult();const v=values(),ready=[v.total,v.fixed,v.scope,v.symbol,v.price].every(x=>String(x).trim());$('plan-error').hidden=!(attempted||ready);$('plan-error').textContent=error.message;}
}
form.addEventListener('submit',event=>{event.preventDefault();attempted=true;update();});
form.addEventListener('input',event=>{
 const id=event.target.id;
 if(id==='plan-symbol'){
  if(identity()!==previousIdentity){$('plan-price').value='';importedPrice=null;manualPrice=false;previousIdentity=identity();}autofill();
 }else if(id==='plan-price'){manualPrice=!!$('plan-price').value.trim();importedPrice=null;}
 else if(id==='plan-fx')importedFx=null;
 update();
});
form.addEventListener('change',event=>{
 if(event.target.id==='plan-market'){$('plan-price').value='';importedPrice=null;manualPrice=false;previousIdentity=identity();steps();suggestions();visibility();autofill();}
 if(event.target.id==='plan-currency'){
  plans.splice(0);for(const id of ['plan-total','plan-fixed','plan-price','plan-fx'])$(id).value='';$('plan-used').value='0';$('plan-reserve').value='0';
  importedPrice=null;importedFx=null;manualPrice=false;attempted=false;visibility();autofill();
 }
 update();
});
$('plan-add').addEventListener('click',()=>{
 if(!result||$('plan-add').disabled)return;
 const r=result;plans.push({id:++serial,symbol:r.symbol,market:r.market,currency:r.currency,shares:r.shares,reservedCost:r.reservedCost});
 $('plan-symbol').value='';$('plan-price').value='';importedPrice=null;manualPrice=false;previousIdentity=identity();attempted=false;update();$('plan-symbol').focus();
});
$('plan-example').addEventListener('click',()=>{
 plans.splice(0);const example={'plan-currency':'TWD','plan-total':'1000000','plan-used':'600000','plan-reserve':'100000','plan-fixed':'20000','plan-scope':'per_stock','plan-count':'1','plan-market':'TW','plan-symbol':'範例','plan-price':'50','plan-fx':''};
 for(const [id,value]of Object.entries(example))$(id).value=value;
 steps();suggestions();importedPrice=null;importedFx=null;manualPrice=true;previousIdentity=identity();attempted=false;update();
 $('plan-source').textContent='假設範例：100 萬總資金，已占用 60 萬、保留 10 萬，每檔 2 萬、股價 50 元。';
});
window.addEventListener('ark-background-ready',event=>{
 context=event.detail?.context||null;stale=false;
 suggestions();
 autofill();update();
});
window.addEventListener('ark-background-error',()=>{context=null;stale=true;$('plan-symbols').replaceChildren();sourceNote();update();});
steps();visibility();update();
