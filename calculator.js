// Original implementation. Exact rational arithmetic keeps decimal budgets exact.
export class InputError extends Error {}
const fail = message => { throw new InputError(message); };
const pow = n => 10n ** BigInt(n);
const gcd = (a,b) => { while(b) [a,b]=[b,a%b]; return a<0n?-a:a; };
export class Q {
  constructor(n,d=1n) { if(d===0n) fail('分母不可為零'); if(d<0n){n=-n;d=-d;} const g=gcd(n,d); this.n=n/g; this.d=d/g; }
  add(b){return new Q(this.n*b.d+b.n*this.d,this.d*b.d);}
  sub(b){return new Q(this.n*b.d-b.n*this.d,this.d*b.d);}
  mul(b){return new Q(this.n*b.n,this.d*b.d);}
  div(b){return new Q(this.n*b.d,this.d*b.n);}
  cmp(b){const v=this.n*b.d-b.n*this.d; return v>0n?1:v<0n?-1:0;}
  down(s){return new Q(this.n*pow(s)/this.d,pow(s));}
  ceil(s){const a=this.n*pow(s);return new Q(a/this.d+(a%this.d>0n?1n:0n),pow(s));}
  text(s=12){const neg=this.n<0n, a=(neg?-this.n:this.n)*pow(s)/this.d; const v=a.toString().padStart(s+1,'0'); return (neg?'-':'')+(s?v.slice(0,-s)+'.'+v.slice(-s):v).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');}
}
const one = new Q(1n), zero = new Q(0n);
export function decimal(value,label='數值') {
  let s=String(value??'').trim();
  if(s.includes(',')) { if(!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) fail(`${label}的千分位格式不正確`); s=s.replaceAll(',',''); }
  if(!/^\d{1,16}(\.\d{1,12})?$/.test(s)) fail(`請輸入有效的${label}（最多 12 位小數）`);
  const [a,b='']=s.split('.');return new Q(BigInt(a+b),pow(b.length));
}
function positive(value,label){const q=decimal(value,label);if(q.cmp(zero)<=0)fail(`${label}必須大於 0`);return q;}
function min(a,b){return a.cmp(b)<0?a:b;}
export function float32Exact(value) {
  const f=Math.fround(Number(value)); if(!Number.isFinite(f)||f<=0)fail('股價超出可重建的範圍');
  const v=new DataView(new ArrayBuffer(4));v.setFloat32(0,f);const center=v.getUint32(0),target=decimal(value);
  const fromBits=bits=>{const e=(bits>>>23)&255,m=BigInt((bits&0x7fffff)+(e?0x800000:0)),exp=(e||1)-127-23;return exp>=0?new Q(m*(2n**BigInt(exp))):new Q(m,2n**BigInt(-exp));};
  // Resolve the nearest binary32 against the original decimal, avoiding double rounding.
  let best=null,distance=null;
  for(const bits of [center-1,center,center+1]){
    const candidate=fromBits(bits),delta=candidate.sub(target),d=new Q(delta.n<0n?-delta.n:delta.n,delta.d);
    if(distance===null||d.cmp(distance)<0||(d.cmp(distance)===0&&(bits&1)===0)){best=candidate;distance=d;}
  }
  return best;
}
export function calculate(input) {
  const mode=input.mode;if(!['budget','ark'].includes(mode))fail('請選擇計算方式');
  if(!['TW','US'].includes(input.market))fail('請選擇市場');
  if(!['TWD','USD'].includes(input.currency))fail('請選擇資金幣別');
  const a=positive(input.budget,'總布局預算'),n=positive(input.count,'分配檔數'),price=positive(input.price,'每股價格');
  if(n.d!==1n||n.cmp(new Q(100000n))>0)fail('分配檔數必須是 1 至 100,000 的整數');
  const step=positive(input.step,'每單位股數');
  if(step.cmp(new Q(1000000n))>0||step.cmp(new Q(1n,1000000n))<0)fail('每單位股數範圍為 0.000001 至 1,000,000');
  if(input.market==='TW'&&step.d!==1n)fail('台股每單位股數必須是整數');
  const quote=input.market==='TW'?'TWD':'USD',cross=quote!==input.currency;
  const rate=cross?positive(input.fx,'匯率'):one;
  const exactFx=!cross?one:quote==='USD'?rate:one.div(rate);
  const modelFx=!cross?one:quote==='USD'?rate:one.div(rate).down(100);
  let k=null,factor=one;
  if(mode==='ark') { if(String(input.k??'').trim()==='')fail('方舟公式需要策略 K(9)。不知道時請使用預算換算。');k=decimal(input.k,'策略 K(9)');factor=k.cmp(one)>0?k:one; }
  const priceInBudget=price.mul(exactFx), modelPrice=mode==='ark'?float32Exact(price.text()).mul(modelFx):priceInBudget;
  const allocation=a.div(n).div(factor),raw=allocation.div(modelPrice);
  const modelShares=mode==='ark'?raw.down(input.market==='US'?2:0):raw;
  // Trading quantities use the entered decimal price and never exceed allocated capital.
  const cap=allocation.div(priceInBudget),units=min(modelShares,cap).div(step).down(0),shares=units.mul(step);
  const costQuote=shares.mul(price),cost=costQuote.mul(exactFx),remaining=allocation.sub(cost);
  const amountDigits=input.currency==='USD'?2:0;
  return {mode,quote,currency:input.currency,market:input.market,cross,k:k?.text()??null,factor:factor.text(),
    budget:a.text(),count:n.text(),price:price.text(),step:step.text(),fx:cross?rate.text():null,
    allocation:allocation.text(),shares:shares.text(12),units:units.text(0),
    costQuote:costQuote.text(),cost:cost.text(),remaining:remaining.text(),
    modelShares:mode==='ark'?modelShares.text(2):null,
    modelAmount:mode==='ark'?modelShares.mul(modelPrice).ceil(amountDigits).text(amountDigits):null,
    modelPrice:mode==='ark'?modelPrice.text(18):null,
    lots:input.market==='TW'?(shares.n/shares.d/1000n).toString():null,
    oddShares:input.market==='TW'?(shares.n/shares.d%1000n).toString():null,
    safetyReduced:modelShares.cmp(shares)>0,zero:shares.cmp(zero)===0};
}
