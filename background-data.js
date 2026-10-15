// Public market context only. No account endpoints or credentials.
export const FEED_BASE='https://fanhow.github.io/ark-agent/data/briefs/';
export const SOURCE_SITE='https://ark-agent.fanhow.chatgpt.site/';
const fail=m=>{throw new Error(m);};
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
const str=(x,max=300)=>typeof x==='string'?x.slice(0,max):'';
export function validDay(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;}
export function taipeiDay(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function safeURL(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function stamp(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(x)&&validDay(x.slice(0,10))&&Number.isFinite(Date.parse(x))?x:'';}
function num(x){if(typeof x==='number')return Number.isFinite(x)?x:null;if(typeof x==='string'&&/^-?\d+(\.\d+)?$/.test(x)&&Number.isFinite(Number(x)))return Number(x);return null;}
export function latestEntry(index,today=taipeiDay()){
 if(!Array.isArray(index)||index.length>5000)fail('摘要索引格式不符，請檢查來源。');
 const rows=index.filter(r=>obj(r)&&validDay(r.date)&&r.date<=today).sort((a,b)=>b.date.localeCompare(a.date)||(Date.parse(stamp(b.generatedAt))||0)-(Date.parse(stamp(a.generatedAt))||0));
 if(!rows.length)fail('找不到可用日期的已發布摘要。');
 return {date:rows[0].date,generatedAt:stamp(rows[0].generatedAt)};
}
function marketGroup(row){if(['TW','US','MACRO'].includes(row.market))return row.market;if(['台股加權','台積電'].includes(row.label))return 'TW';if(['S&P 500','那斯達克'].includes(row.label))return 'US';return 'MACRO';}
function normalizeRow(row,macro=false){
 if(!obj(row)||!str(row.label))return null;
 const group=macro?'MACRO':marketGroup(row),unit=str(row.unit,40);
 const changeUnit=str(row.changeUnit,40)||(['美國 10 年債殖利率','聯邦基金有效利率'].includes(row.label)?'百分點':group==='TW'||group==='US'?'%':'');
 return {label:str(row.label,100),value:num(row.value),change:num(row.change),unit,changeUnit,asOf:validDay(row.asOf)?row.asOf:null,previousAsOf:validDay(row.previousAsOf)?row.previousAsOf:null,source:safeURL(row.source),fetchedAt:stamp(row.fetchedAt),note:str(row.note,1000),group,status:str(row.status,40)};
}
const numericText=x=>{const s=typeof x==='number'?String(x):x;return typeof s==='string'&&/^\d{1,16}(\.\d{1,12})?$/.test(s)?s:null;};
function measure(raw,unit,range,kindRequired=false){
 if(!obj(raw))return null;const value=numericText(raw.value);
 if(value===null||!stamp(raw.asOf)||!str(raw.source,500)||raw.unit!==unit||!range(Number(value)))return null;
 if(kindRequired&&!['ark_observed','user_target'].includes(raw.kind))return null;
 return {value,asOf:raw.asOf,source:str(raw.source,500),kind:str(raw.kind,30),unit};
}
export function normalizeContext(raw,{now=new Date(),referenceDate=taipeiDay(now)}={}){
 const empty={ratio:null,fx:null,quotes:[],warnings:[]};if(raw===undefined||raw===null)return empty;
 if(!obj(raw)||raw.schemaVersion!==1)return {...empty,warnings:['試算欄位版本不符，保留手動輸入。']};
 const dated=(m,label)=>{if(!m)return null;if(Date.parse(m.asOf)>now.getTime()){warnings.push(label+'的時點在未來，未接受。');return null;}if(taipeiDay(new Date(m.asOf))<referenceDate)warnings.push(label+'早於摘要基準日，請核對再帶入。');return m;};
 const warnings=[];
 const ratio=dated(measure(raw.targetStockRatio,'percent',v=>v>=0&&v<=100,true),'配置比例'),fx=dated(measure(raw.usdTwd,'TWD_per_USD',v=>v>0),'匯率');
 if(raw.targetStockRatio&&!ratio)warnings.push('配置比例缺少有效數值、時點、單位或來源。');if(raw.usdTwd&&!fx)warnings.push('匯率缺少有效數值、時點、方向或來源。');
 const quotes=[],seen=new Set();
 for(const q of (Array.isArray(raw.quotes)?raw.quotes:[]).slice(0,500)){
  if(!obj(q)||!['TW','US'].includes(q.market)||!/^([A-Za-z0-9][A-Za-z0-9.\-^]{0,19})$/.test(q.symbol||''))continue;
  const currency=q.market==='TW'?'TWD':'USD',price=dated(measure(q.price,currency,v=>v>0),q.symbol+'價格');
  const key=q.market+':'+q.symbol.toUpperCase();if(!price||q.currency!==currency||seen.has(key)||!['close','last','manual'].includes(q.priceType))continue;
  let k=dated(measure(q.arkK9,'strategy_K9',v=>v>=0,true),q.symbol+'策略 K');if(k?.kind!=='ark_observed')k=null;
  if(q.arkK9&&!k)warnings.push(q.symbol+' 的策略 K 缺少已觀察到的方舟來源，未帶入。');
  if(k&&taipeiDay(new Date(k.asOf))!==taipeiDay(new Date(price.asOf)))warnings.push(q.symbol+'價格與策略 K 的台北日期不同，請核對同批資料。');
  seen.add(key);quotes.push({symbol:q.symbol.toUpperCase(),market:q.market,currency,price,k,priceType:q.priceType});
 }
 return {ratio,fx,quotes,warnings};
}
export function normalizeBrief(raw,expectedDate,{now=new Date()}={}){
 if(!obj(raw)||!validDay(raw.date)||raw.date!==expectedDate||!Array.isArray(raw.market)||raw.market.length>100)fail('摘要內容與索引日期不一致或格式不符。');
 const market=raw.market.map(r=>normalizeRow(r)).filter(Boolean);
 if(!market.length)fail('摘要沒有可顯示的市場欄位。');
 return {date:raw.date,generatedAt:stamp(raw.generatedAt),headline:str(raw.headline,600),note:str(raw.note,1200),market,macro:(Array.isArray(raw.macroRadar?.items)?raw.macroRadar.items:[]).slice(0,50).map(r=>normalizeRow(r,true)).filter(Boolean),context:normalizeContext(raw.calculatorContext,{now,referenceDate:raw.date})};
}
export function dateStatus(asOf,reference){
 if(!validDay(asOf))return {kind:'missing',text:'日期待提供'};
 if(!validDay(reference))return {kind:'missing',text:'請設定基準日'};
 if(asOf<reference)return {kind:'older',text:'早於基準日'};
 if(asOf>reference)return {kind:'newer',text:'晚於基準日'};
 return {kind:'same',text:'與基準日相同'};
}
export function changeText(row){if(row.change===null)return '變動待提供';return (row.change>0?'+':'')+new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(row.change)+(row.changeUnit?' '+row.changeUnit:'（單位待提供）');}
export async function loadLatest(fetcher=fetch,{now=new Date(),timeoutMs=12000}={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs),bust=now.getTime();
 const get=async file=>{const res=await fetcher(FEED_BASE+file+'?refresh='+bust,{cache:'no-store',credentials:'omit',signal:abort.signal});if(!res.ok)fail('來源回應 HTTP '+res.status);const text=await res.text();if(text.length>2000000)fail('來源資料過大，未載入。');try{return JSON.parse(text);}catch{fail('來源不是有效 JSON。');}};
 try{const entry=latestEntry(await get('index.json'),taipeiDay(now));const brief=normalizeBrief(await get(entry.date+'.json'),entry.date,{now});return {...brief,loadedAt:now.toISOString(),sourceURL:FEED_BASE+entry.date+'.json'};}
 finally{clearTimeout(timer);}
}
export async function loadSaved(fetcher=fetch,{now=new Date(),timeoutMs=12000}={}){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
 const get=async file=>{const res=await fetcher('./data/'+file+'?refresh='+now.getTime(),{cache:'no-store',credentials:'omit',signal:abort.signal});if(!res.ok)fail('尚未取得已排程匯入的資料');const raw=await res.text();if(raw.length>2000000)fail('快照過大');return JSON.parse(raw);};
 try{const [saved,status]=await Promise.all([get('background.json'),get('import-status.json')]);
  if(saved.schemaVersion!==1||!validDay(saved.brief?.date)||!stamp(saved.importedAt)||saved.sourceURL!==FEED_BASE+saved.brief.date+'.json'||status.schemaVersion!==1||!['success','error','unchanged_source'].includes(status.status)||!stamp(status.checkedAt))fail('排程快照格式不符');
  if(saved.brief.date>taipeiDay(now)||Date.parse(saved.importedAt)>now.getTime()||Date.parse(status.checkedAt)>now.getTime())fail('快照日期在未來');
  return {...normalizeBrief(saved.brief,saved.brief.date,{now}),loadedAt:now.toISOString(),importedAt:saved.importedAt,sourceURL:saved.sourceURL,importStatus:status};
 }finally{clearTimeout(timer);}
}
