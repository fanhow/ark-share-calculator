import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FEED_BASE, normalizeBrief} from '../background-data.js';
import {createFileStore, runImport, sameSource, toSnapshot} from '../scripts/import-background.mjs';
import {stagePages} from '../scripts/stage-pages.mjs';

const started='2026-10-15T12:00:00.000Z',finished='2026-10-15T12:00:02.000Z';
const now=new Date(started);
const source={date:'2026-10-15',generatedAt:'2026-10-15T07:00:00+08:00',headline:'公開摘要',note:'保留各市場資料日',privateAccount:{cash:'never publish'},market:[{label:'台股加權',market:'TW',value:0,change:null,unit:'點',asOf:'2026-10-14',fetchedAt:'2026-10-15T06:59:00+08:00',source:'https://example.com/public',privateBalance:123}],macroRadar:{items:[{label:'美國 10 年債殖利率',value:4.5,change:0.01,unit:'%',changeUnit:'百分點',asOf:'2026-10-13'}]},calculatorContext:{schemaVersion:1,targetStockRatio:{value:'0',unit:'percent',kind:'ark_observed',asOf:'2026-10-15T06:00:00+08:00',source:'公開方舟觀察'},usdTwd:{value:'31.5',unit:'TWD_per_USD',asOf:'2026-10-15T06:00:00+08:00',source:'公開匯率'},quotes:[{symbol:'AAPL',market:'US',currency:'USD',priceType:'close',price:{value:'200.25',unit:'USD',asOf:'2026-10-14T20:15:00Z',source:'公開收盤價'},arkK9:{value:'4',unit:'strategy_K9',kind:'ark_observed',asOf:'2026-10-14T20:15:00Z',source:'公開方舟觀察'}}]}};
const normalized=()=>({...normalizeBrief(structuredClone(source),source.date,{now}),sourceURL:FEED_BASE+source.date+'.json',loadedAt:started});
function memoryStore(initial={}){const data=structuredClone(initial),writes=[];return {data,writes,async read(name){return structuredClone(data[name]??null);},async write(name,value){data[name]=structuredClone(value);writes.push(name);}};}
function clock(){let index=0;return ()=>new Date([started,finished][Math.min(index++,1)]);}

test('only approved public fields are saved and context maps back to the feed schema',()=>{
 const value=normalized();value.privateAccount={secret:'private'};value.market[0].privateBalance=999;value.context.ratio.privateValue='private';value.context.quotes[0].k.secret='private';
 const saved=toSnapshot(value,finished);
 assert.deepEqual(Object.keys(saved),['schemaVersion','importedAt','sourceURL','brief']);
 assert.equal(JSON.stringify(saved).includes('private'),false);
 assert.equal(saved.brief.market[0].market,'TW');assert.equal(saved.brief.market[0].value,0);assert.equal(saved.brief.market[0].change,null);
 assert.equal(saved.brief.market[0].asOf,'2026-10-14');assert.equal(saved.brief.market[0].fetchedAt,'2026-10-15T06:59:00+08:00');assert.equal(saved.importedAt,finished);
 assert.equal(saved.brief.macroRadar.items[0].changeUnit,'百分點');
 assert.equal(saved.brief.calculatorContext.targetStockRatio.value,'0');assert.equal(saved.brief.calculatorContext.usdTwd.unit,'TWD_per_USD');
 assert.equal(saved.brief.calculatorContext.quotes[0].arkK9.value,'4');
 const roundtrip=normalizeBrief(saved.brief,saved.brief.date,{now});
 assert.deepEqual(roundtrip.context,normalized().context);
});

test('rejects a snapshot claiming an arbitrary source URL',()=>{
 assert.throws(()=>toSnapshot({...normalized(),sourceURL:'https://example.com/private'},finished),/固定公開來源/);
});

test('success writes snapshot and status with completion time, not source asOf',async()=>{
 const store=memoryStore();let suppliedNow;
 const result=await runImport({store,clock:clock(),loader:async(_,{now})=>{suppliedNow=now;return normalized();}});
 assert.equal(result.ok,true);assert.equal(result.status.status,'success');assert.equal(result.status.checkedAt,finished);
 assert.equal(suppliedNow.toISOString(),started);assert.equal(result.status.lastSuccessfulImportAt,finished);
 assert.deepEqual(new Set(store.writes),new Set(['background.json','import-status.json']));
 assert.equal(store.data['background.json'].brief.market[0].asOf,'2026-10-14');
});

test('unchanged source updates check status and preserves the original snapshot timestamp',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const result=await runImport({store,clock:clock(),loader:async()=>normalized()});
 assert.equal(result.status.status,'unchanged_source');assert.equal(result.changed,false);assert.equal(result.status.lastSuccessfulImportAt,previous.importedAt);
 assert.deepEqual(store.data['background.json'],previous);assert.deepEqual(store.writes,['import-status.json']);
});

test('a same-day correction is imported even when the source date and generatedAt match',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const next=normalized();next.market[0].value=123;
 assert.equal(sameSource(previous,toSnapshot(next,finished)),false);
 const result=await runImport({store,clock:clock(),loader:async()=>next});
 assert.equal(result.status.status,'success');assert.equal(store.data['background.json'].brief.market[0].value,123);
});

test('a failed source check preserves the successful snapshot and publishes a safe error status',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const result=await runImport({store,clock:clock(),loader:async()=>{throw Error('raw private upstream body must not be published');}});
 assert.equal(result.ok,false);assert.equal(result.status.status,'error');assert.equal(result.status.lastSuccessfulImportAt,previous.importedAt);
 assert.deepEqual(store.data['background.json'],previous);assert.deepEqual(store.writes,['import-status.json']);
 assert.equal(JSON.stringify(result.status).includes('private'),false);
});

test('a first-run failure publishes an error without inventing a successful snapshot',async()=>{
 const store=memoryStore(),error=Object.assign(Error('timeout'),{name:'AbortError'});
 const result=await runImport({store,clock:clock(),loader:async()=>{throw error;}});
 assert.equal(result.status.status,'error');assert.equal(result.status.lastSuccessfulImportAt,null);assert.equal(result.snapshot,null);
 assert.equal(result.status.error,'讀取公開摘要逾時。');assert.equal(store.data['background.json'],undefined);
});

test('invalid transformed content cannot overwrite the previous snapshot',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const result=await runImport({store,clock:clock(),loader:async()=>({...normalized(),date:'invalid'})});
 assert.equal(result.ok,false);assert.deepEqual(store.writes,['import-status.json']);assert.deepEqual(store.data['background.json'],previous);
});

test('a failed atomic snapshot write retains the previous snapshot and publishes error status',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const write=store.write;store.write=async(name,value)=>{if(name==='background.json')throw Error('disk write failed');return write(name,value);};
 const next=normalized();next.market[0].value=123;
 const result=await runImport({store,clock:clock(),loader:async()=>next});
 assert.equal(result.ok,false);assert.equal(store.data['import-status.json'].status,'error');assert.deepEqual(store.data['background.json'],previous);
 assert.equal(result.status.lastSuccessfulImportAt,previous.importedAt);
});

test('a failed status write cannot replace the previous successful snapshot',async()=>{
 const previous=toSnapshot(normalized(),'2026-10-15T00:00:02.000Z'),store=memoryStore({'background.json':previous});
 const write=store.write;let failed=false;store.write=async(name,value)=>{if(name==='import-status.json'&&!failed){failed=true;throw Error('status write failed');}return write(name,value);};
 const next=normalized();next.market[0].value=123;
 const result=await runImport({store,clock:clock(),loader:async()=>next});
 assert.equal(result.ok,false);assert.equal(store.data['import-status.json'].status,'error');assert.deepEqual(store.data['background.json'],previous);
 assert.deepEqual(store.writes,['import-status.json']);
});

test('file store saves parseable JSON atomically without leaving temporary artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-import-'));
 try{const store=createFileStore(join(root,'data'));assert.equal(await store.read('missing.json'),null);await store.write('import-status.json',{status:'error'});assert.deepEqual(await store.read('import-status.json'),{status:'error'});assert.deepEqual(await readdir(join(root,'data')),['import-status.json']);}
 finally{await rm(root,{recursive:true,force:true});}
});

test('Pages staging includes public web files and data while excluding source tooling and links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-stage-'));
 try{
  for(const name of ['index.html','background.js','background.css','BACKGROUND-FEED.md','calculator-context.example.json','.nojekyll','package.json','package-lock.json','.env','private.txt'])await writeFile(join(root,name),name);
  for(const dir of ['tests','scripts','.git','data','data/nested'])await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'tests','hidden.test.mjs'),'not public');await writeFile(join(root,'data','background.json'),'{}');await writeFile(join(root,'data','nested','import-status.json'),'{}');await writeFile(join(root,'data','private.txt'),'not public');
  await symlink(join(root,'.env'),join(root,'linked.json'));
  const copied=await stagePages(root);
  assert.deepEqual(copied,['.nojekyll','BACKGROUND-FEED.md','background.css','background.js','calculator-context.example.json','data/background.json','data/nested/import-status.json','index.html']);
  assert.equal(await readFile(join(root,'_site','data','background.json'),'utf8'),'{}');
 }
 finally{await rm(root,{recursive:true,force:true});}
});

test('Pages staging refuses a data-directory symlink rather than copying external JSON',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-stage-link-')),external=await mkdtemp(join(tmpdir(),'ark-stage-external-'));
 try{
  await writeFile(join(root,'index.html'),'public');await writeFile(join(external,'secret.json'),'not public');await symlink(external,join(root,'data'));
  await assert.rejects(stagePages(root),/real directory/);
  assert.deepEqual(await readdir(join(root,'_site')),['index.html']);
 }
 finally{await rm(root,{recursive:true,force:true});await rm(external,{recursive:true,force:true});}
});

test('Pages staging rejects a website without its HTML entry point',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ark-stage-empty-'));
 try{await writeFile(join(root,'background.js'),'public');await assert.rejects(stagePages(root),/index\.html/);}
 finally{await rm(root,{recursive:true,force:true});}
});
