import {Q,decimal,calculate,InputError} from './calculator.js';
const zero=new Q(0n),one=new Q(1n),min=(a,b)=>a.cmp(b)<0?a:b;
const fail=m=>{throw new InputError(m);};
export function capital(input,plans=[]){
 if(!['TWD','USD'].includes(input.currency))fail('請選擇資金幣別');
 const total=decimal(input.total,'總資金'),used=decimal(input.used,'已占用資金'),reserve=decimal(input.reserve,'保留現金');
 if(total.cmp(zero)<=0)fail('總資金必須大於 0');
 let planned=zero;for(const p of plans){if(p.currency!==input.currency)fail('清單與資金幣別不一致');planned=planned.add(decimal(p.reservedCost,'清單價金'));}
 const available=total.sub(used).sub(reserve).sub(planned);
 if(available.cmp(zero)<0)fail('已占用、保留現金與布局清單合計超過總資金，請調整。');
 return {total:total.text(),used:used.text(),reserve:reserve.text(),planned:planned.text(),available:available.text()};
}
export function planStock(input,plans=[]){
 const money=capital(input,plans),available=decimal(money.available);
 if(!String(input.symbol||'').trim())fail('請輸入股票代號');
 if(plans.some(p=>p.market===input.market&&p.symbol===String(input.symbol).trim().toUpperCase()))fail('這檔已在清單中；若要改金額，請先移除原項目再試算');
 if(!['per_stock','total'].includes(input.scope))fail('請選擇布局金額是每檔金額，還是本次全部股票的總額');
 const fixed=decimal(input.fixed,'方舟布局金額');if(fixed.cmp(zero)<=0)fail('布局金額必須大於 0');
 const count=input.scope==='total'?decimal(input.count,'分配檔數'):one;
 if(count.d!==1n||count.cmp(one)<0||count.cmp(new Q(100000n))>0)fail('分配檔數須為 1 至 100,000 的整數');
 if(available.cmp(zero)<=0)fail('目前已無可布局資金');
 const totalRemaining=input.scope==='total'?fixed.sub(decimal(money.planned)):available;
 if(totalRemaining.cmp(zero)<=0)fail('本次全部股票的布局額度已用完');
 const target=fixed.div(count),cap=min(target,min(available,totalRemaining)).down(2);
 if(cap.cmp(zero)<=0)fail('剩餘額度不足 0.01，請調整布局金額');
 const result=calculate({mode:'budget',market:input.market,currency:input.currency,budget:cap.text(12),count:'1',price:input.price,step:input.step,fx:input.fx});
 // Reserve the exact cross-currency cost rounded UP to a cent, so the ledger
 // never spends a fractional remainder hidden by display rounding.
 const quote=decimal(result.shares).mul(decimal(input.price));
 const exactCost=result.cross?(result.quote==='USD'?quote.mul(decimal(input.fx)):quote.div(decimal(input.fx))):quote;
 const reservedCost=exactCost.ceil(2),remaining=available.sub(reservedCost);
 if(remaining.cmp(zero)<0)fail('四捨五入後超過可用額，請預留至少 0.01 的空間');
 const layoutRemaining=input.scope==='total'?min(totalRemaining.sub(reservedCost),remaining):remaining;
 return {...result,symbol:String(input.symbol).trim().toUpperCase(),capital:money,target:target.text(),capped:cap.cmp(target)<0,reservedCost:reservedCost.text(2),availableAfter:remaining.text(),layoutRemaining:layoutRemaining.text(),moreFullStocks:layoutRemaining.div(target).down(0).text(0)};
}
