import {Q,decimal,InputError} from './calculator.js';
const zero=new Q(0n),one=new Q(1n),hundred=new Q(100n);
const error=s=>{throw new InputError(s);};
function away(q,scale){const abs=new Q(q.n<0n?-q.n:q.n,q.d).ceil(scale);return q.n<0n?new Q(-abs.n,abs.d):abs;}
function halfUp(q,scale){const p=10n**BigInt(scale),n=q.n*p;return new Q(n/q.d+(2n*(n%q.d)>=q.d?1n:0n),p);}
export function calculatePortfolio(input){
 const currency=input.currency;if(!['TWD','USD'].includes(currency))error('請選擇試算幣別');
 const scale=currency==='USD'?2:0;
 const stockTW=decimal(input.stockTW,'台股庫存市值'),stockUS=decimal(input.stockUS,'美股庫存市值');
 if(stockTW.cmp(stockTW.down(scale))!==0||stockUS.cmp(stockUS.down(scale))!==0)error(currency==='TWD'?'台幣庫存市值請填整元；若有小數請先依 App 顯示取值。':'美元庫存市值最多填兩位小數。');
 const twd=decimal(input.cashTWD,'台幣現金'),usd=decimal(input.cashUSD,'美元現金');
 if(String(input.ratio??'').trim()==='')error('請填入目標持股比例；可使用方舟顯示值或自行設定。');
 const percent=decimal(input.ratio,'目標持股比例');if(percent.cmp(hundred)>0)error('此工具的目標比例範圍為 0% 至 100%');
 const needsFx=currency==='TWD'?usd.cmp(zero)>0:twd.cmp(zero)>0;
 let fx=one;if(needsFx){fx=decimal(input.fx,'匯率');if(fx.cmp(zero)<=0)error('匯率必須大於 0');}
 const cashConverted=currency==='TWD'?twd.add(usd.mul(fx)):usd.add(twd.mul(one.div(fx).down(100)));
 const cash=away(cashConverted,scale),stock=stockTW.add(stockUS),total=stock.add(cash);
 const ratio=halfUp(percent.div(hundred),10),targetStock=away(total.mul(ratio),scale);
 const targetCash=total.sub(targetStock).down(2),delta=away(cash.sub(targetCash),scale);
 const action=delta.cmp(zero)>0?'buy':delta.cmp(zero)<0?'reduce':'hold';
 const absDelta=new Q(delta.n<0n?-delta.n:delta.n,delta.d);
 const currentPct=total.cmp(zero)>0?stock.div(total).mul(hundred):zero;
 return {currency,stock:stock.text(2),stockTW:stockTW.text(2),stockUS:stockUS.text(2),cash:cash.text(2),total:total.text(2),targetStock:targetStock.text(2),targetCash:targetCash.text(2),delta:delta.text(2),amount:absDelta.text(2),buyBudget:action==='buy'?absDelta.text(2):'0',action,ratio:percent.text(),currentPct:currentPct.text(2),cashTWD:twd.text(),cashUSD:usd.text(),fx:needsFx?fx.text():null,needsFx};
}
