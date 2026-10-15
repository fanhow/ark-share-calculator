import {loadLatest,loadSaved,taipeiDay,dateStatus,changeText} from './background-data.js';
const $=id=>document.getElementById(id);let snapshot=null,importedQuote=null,applying=false,requestVersion=0;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const number=x=>x===null?'待更新':new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(x);
function time(x){if(!x)return '未提供';return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(x));}
function link(text,url){const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function card(r){
 const box=node('article',undefined,'background-item'),head=node('div',undefined,'background-item-head');head.append(node('h3',r.label),node('span',r.group==='TW'?'台灣':r.group==='US'?'美國':'總經','region'));box.append(head);
 const value=node('p',number(r.value),'background-value');value.append(node('small',r.unit?' '+r.unit:''));box.append(value,node('p',changeText(r),'background-change'));
 const status=dateStatus(r.asOf,$('background-date').value),meta=node('p',undefined,'background-asof');meta.append(node('span','資料日 '+(r.asOf||'待提供')),node('span',status.text,'date-state '+status.kind));box.append(meta);
 const details=node('details'),summary=node('summary','來源與時點');details.append(summary,node('p','擷取：'+time(r.fetchedAt)));
 if(r.previousAsOf)details.append(node('p','比較前值：'+r.previousAsOf));if(r.note)details.append(node('p',r.note));details.append(r.source?link('原始來源 ↗',r.source):node('p','來源連結未提供'));box.append(details);return box;
}
function render(){
 if(!snapshot)return;
 $('background-results').hidden=false;$('background-headline').textContent=snapshot.headline||'每日市場摘要';
 $('background-meta').textContent=`摘要日 ${snapshot.date} · 發布 ${time(snapshot.generatedAt)}${snapshot.importedAt?" · 快照匯入 "+time(snapshot.importedAt):""} · 本次讀取 ${time(snapshot.loadedAt)}（台北時間）`;
 $('background-market').replaceChildren(...snapshot.market.map(card));$('background-macro').replaceChildren(...snapshot.macro.map(card));$('background-macro-section').hidden=!snapshot.macro.length;
 const tw=snapshot.market.filter(r=>r.group==='TW'),us=snapshot.market.filter(r=>r.group==='US');
 const dates=rows=>[...new Set(rows.map(r=>r.asOf||'待提供'))].join('、')||'未提供';
 $('background-dates').textContent=`台股資料日：${dates(tw)} ｜ 美股資料日：${dates(us)}（美東交易日）`;
 const missing=tw.some(r=>!r.asOf||r.value===null),older=tw.some(r=>r.asOf&&r.asOf<$('background-date').value);
 $('background-freshness').textContent=missing?'台股有資料或日期缺漏，請核對來源。':older?'台股資料早於你選的基準日；尚未取得該日收盤背景。休市日請自行調整基準日。':'請按每項資料日期判讀；日期相同不代表即時行情。';
 $('background-source-json').href=snapshot.sourceURL;
 const c=snapshot.context;$('background-apply').disabled=$('background-status').dataset.state!=='success'||!(c.ratio||c.fx);
 $('background-fields').textContent=`配置 R：${c.ratio?c.ratio.value+'%（'+time(c.ratio.asOf)+'）':'尚未提供'}；USD/TWD：${c.fx?c.fx.value+'（'+time(c.fx.asOf)+'）':'尚未提供'}；個股價格：${c.quotes.length} 檔；策略 K：${c.quotes.filter(q=>q.k).length} 檔。`;
 $('background-field-warnings').textContent=c.warnings.join(' ');$('background-field-warnings').hidden=!c.warnings.length;
 $('background-quotes').replaceChildren(new Option('選擇有來源日期的個股',''),...c.quotes.map((q,i)=>new Option(`${q.symbol} · ${q.market} · ${q.price.value} ${q.currency} · ${time(q.price.asOf)}`,String(i))));$('background-quote-apply').disabled=true;
}
$('background-date').value=taipeiDay();$('background-date').addEventListener('change',render);
$('background-refresh').addEventListener('click',async()=>{
 ++requestVersion;const button=$('background-refresh');button.disabled=true;button.textContent='讀取中…';$('background-status').textContent='正在核對最新已發布摘要…';$('background-status').dataset.state='loading';
 $('background-apply').disabled=true;$('background-quote-apply').disabled=true;
 try{snapshot=await loadLatest();$('background-status').textContent='已讀取公開摘要；請核對下方行情日期。';$('background-status').dataset.state='success';render();notifyReady();if(!$('background-applied').hidden)$('background-applied').textContent='背景已重新讀取；先前帶入的試算值保持原樣，需要時請重新帶入。';}
 catch(e){window.dispatchEvent(new Event('ark-background-error'));$('background-status').textContent=(e.name==='AbortError'?'讀取逾時，請稍後重試。':'更新失敗：'+e.message)+(snapshot?' 下方保留上次讀取內容，不能當成本次更新。':' 請稍後重試，手動試算仍可使用。');$('background-status').dataset.state='error';if(snapshot){$('background-apply').disabled=true;$('background-quote-apply').disabled=true;}}
 finally{button.disabled=false;button.textContent='更新方舟背景資料';}
});
function setInput(id,value,type='input'){const el=$(id);el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}));}
$('background-apply').addEventListener('click',()=>{
 if(!snapshot||$('background-apply').disabled)return;
 const c=snapshot.context;applying=true;const used=[];
 if(c.ratio){setInput('target-ratio',c.ratio.value);used.push(`R ${c.ratio.value}%，${time(c.ratio.asOf)}，來源：${c.ratio.source}`);}
 if(c.fx){setInput('portfolio-fx',c.fx.value);setInput('fx',c.fx.value);used.push(`1 USD = ${c.fx.value} TWD，${time(c.fx.asOf)}，來源：${c.fx.source}`);}
 applying=false;$('background-applied').hidden=false;$('background-applied').textContent='已依你的操作帶入：'+used.join('；')+'。持股與現金仍由你填寫。';
});
$('background-quotes').addEventListener('change',()=>{$('background-quote-apply').disabled=!snapshot||$('background-quotes').value===''||$('background-status').dataset.state!=='success';});
$('background-quote-apply').addEventListener('click',()=>{
 if(!snapshot||$('background-quote-apply').disabled)return;const q=snapshot.context.quotes[Number($('background-quotes').value)];if(!q)return;
 applying=true;setInput('market',q.market,'change');setInput('symbol',q.symbol);setInput('price',q.price.value);setInput('k',q.k?.value||'');if(snapshot.context.fx)setInput('fx',snapshot.context.fx.value);applying=false;importedQuote=q;
 $('background-applied').hidden=false;$('background-applied').textContent=`已帶入 ${q.symbol}：${q.price.value} ${q.currency}，${q.priceType==='close'?'收盤價':q.priceType==='last'?'最近報價':'手動價格'}，${time(q.price.asOf)}。來源：${q.price.source}。${q.k?'策略 K '+q.k.value+'，'+time(q.k.asOf)+'，來源：'+q.k.source:'來源沒有策略 K，已清除原 K；可用預算換算。'}`;
 $('advanced-calculator').open=true;document.querySelector('[data-step="shares"]').click();
});
for(const id of ['symbol','market'])$(id).addEventListener(id==='market'?'change':'input',()=>{if(applying||!importedQuote)return;importedQuote=null;applying=true;setInput('price','');setInput('k','');applying=false;$('background-applied').textContent='標的／市場已修改，已清除帶入的價格與策略 K，請重新選取或手動填寫。';});
for(const id of ['target-ratio','portfolio-fx','fx','price','k'])$(id).addEventListener('input',()=>{if(!applying&&!$('background-applied').hidden)$('background-applied').textContent='試算欄位已手動修改；目前輸入不再保證與上次帶入資料一致。';});

function notifyReady(){
 $('background-compact').textContent=`摘要 ${snapshot.date} · 台股 ${[...new Set(snapshot.market.filter(r=>r.group==='TW').map(r=>r.asOf||'日期未提供'))].join('、')} · 台北 08:00／20:00 匯入`;
 window.dispatchEvent(new CustomEvent('ark-background-ready',{detail:snapshot}));
}
async function startup(){
 const version=++requestVersion;
 try{const saved=await loadSaved();if(version!==requestVersion)return;snapshot=saved;
  const failed=saved.importStatus.status==='error';$('background-status').dataset.state=failed?'error':'success';
  $('background-status').textContent=failed?`最近排程匯入失敗（${time(saved.importStatus.checkedAt)}）；以下保留上次成功快照，請手動更新。`:`已載入排程快照；最近檢查 ${time(saved.importStatus.checkedAt)}${saved.importStatus.status==='unchanged_source'?'，來源尚無變更':''}。台北每日 08:00／20:00 排程，實際執行可能延遲。`;
  render();if(failed){$('background-compact').textContent='最近排程匯入失敗 · 請展開核對';window.dispatchEvent(new Event('ark-background-error'));}else notifyReady();
 }catch(e){if(version!==requestVersion)return;$('background-status').textContent='暫時讀不到排程快照，可按「更新方舟背景資料」直接讀來源。';$('background-compact').textContent='排程快照尚未讀取 · 可手動更新';}
}
startup();
