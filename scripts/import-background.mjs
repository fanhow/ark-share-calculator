import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {FEED_BASE, loadLatest, validDay} from '../background-data.js';

const rootDir=fileURLToPath(new URL('../',import.meta.url));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const select=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
const measure=value=>object(value)?select(value,['value','asOf','source','kind','unit']):null;
const row=value=>({...select(value,['label','value','change','unit','changeUnit','asOf','previousAsOf','source','fetchedAt','note','status']),market:['TW','US','MACRO'].includes(value.group)?value.group:'MACRO'});

// Reconstruct only the public schema. Never spread the upstream document or context.
export function toSnapshot(normalized,importedAt){
 if(!object(normalized)||!validDay(normalized.date)||!Array.isArray(normalized.market)||!normalized.market.length)throw Error('公開摘要格式不符，未取代上次快照。');
 if(!Number.isFinite(Date.parse(importedAt)))throw Error('匯入時間無效。');
 const sourceURL=FEED_BASE+normalized.date+'.json';
 if(normalized.sourceURL!==sourceURL)throw Error('摘要來源不符合固定公開來源。');
 const c=object(normalized.context)?normalized.context:{};
 const quotes=(Array.isArray(c.quotes)?c.quotes:[]).filter(object).map(q=>({...select(q,['symbol','market','currency','priceType']),price:measure(q.price),arkK9:measure(q.k)}));
 return {schemaVersion:1,importedAt,sourceURL,brief:{
  ...select(normalized,['date','generatedAt','headline','note']),
  market:normalized.market.filter(object).map(row),
  macroRadar:{items:(Array.isArray(normalized.macro)?normalized.macro:[]).filter(object).map(row)},
  calculatorContext:{schemaVersion:1,targetStockRatio:measure(c.ratio),usdTwd:measure(c.fx),quotes},
 }};
}

export function sameSource(previous,next){
 return object(previous)&&previous.schemaVersion===1&&previous.sourceURL===next.sourceURL&&JSON.stringify(previous.brief)===JSON.stringify(next.brief);
}

export function createFileStore(dataDir=join(rootDir,'data')){
 return {
  async read(name){try{return JSON.parse(await readFile(join(dataDir,name),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
  async write(name,value){
   await mkdir(dataDir,{recursive:true});
   const destination=join(dataDir,name),temporary=destination+'.tmp-'+randomUUID();
   try{await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});await rename(temporary,destination);}
   finally{await rm(temporary,{force:true});}
  },
 };
}

const clockISO=clock=>{const value=clock();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw Error('匯入時間無效。');return value.toISOString();};

// Injectable I/O keeps tests offline. A failed read never replaces background.json.
export async function runImport({loader=loadLatest,store=createFileStore(),clock=()=>new Date()}={}){
 const startedAt=clockISO(clock);let previous=null,previousStatus=null;
 try{
  previous=await store.read('background.json');
  previousStatus=await store.read('import-status.json');
  const normalized=await loader(undefined,{now:new Date(startedAt)});
  const checkedAt=clockISO(clock),next=toSnapshot(normalized,checkedAt);
  const unchanged=sameSource(previous,next);
  const status={schemaVersion:1,status:unchanged?'unchanged_source':'success',checkedAt,lastSuccessfulImportAt:unchanged?previous.importedAt:checkedAt,sourceURL:next.sourceURL,date:next.brief.date};
  // Publication happens only after this process finishes. Prepare status first so
  // a status-write failure cannot replace the last successful snapshot.
  await store.write('import-status.json',status);
  if(!unchanged)await store.write('background.json',next);
  return {ok:true,changed:!unchanged,status,snapshot:unchanged?previous:next};
 }catch(error){
  // Do not expose response bodies or unexpected runtime error details publicly.
  const publicMessage=/^(來源回應 HTTP \d{3}|來源不是有效 JSON。|來源資料過大，未載入。|摘要|公開摘要|找不到可用日期|試算欄位|匯入時間)/.test(error?.message||'')?String(error.message).slice(0,300):error?.name==='AbortError'?'讀取公開摘要逾時。':'無法讀取或保存公開摘要；保留上次成功快照。';
  const status={schemaVersion:1,status:'error',checkedAt:clockISO(clock),lastSuccessfulImportAt:previous?.importedAt||previousStatus?.lastSuccessfulImportAt||null,sourceURL:previous?.sourceURL||FEED_BASE+'index.json',date:previous?.brief?.date||null,error:publicMessage};
  await store.write('import-status.json',status);
  return {ok:false,changed:false,status,snapshot:previous};
 }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const result=await runImport();
  console.log(JSON.stringify({status:result.status.status,checkedAt:result.status.checkedAt,date:result.status.date,lastSuccessfulImportAt:result.status.lastSuccessfulImportAt}));
  if(!result.ok)process.exitCode=1;
 }catch{console.error('公開摘要更新狀態無法保存，請檢查執行紀錄。');process.exitCode=1;}
}
