// Local browser engine witness. Not product/Codex acceptance.
// Both bundles are built only inside the disposable private checkout.
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

const [old,candidate,root]=process.argv.slice(2).map(resolve);
const fail=code=>{throw Error('DB9_WITNESS_'+code)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
if(!chrome)fail('BROWSER_UNAVAILABLE');
await mkdir(root,{recursive:false});
const esbuild=await import(pathToFileURL(join(candidate,'node_modules/esbuild/lib/main.js')).href);
const legacyCode=`
import {runMigrations} from './src/local-store/internal/migrations';
import {STORES} from './src/local-store/types';
const clock='2026-11-25T00:00:00.000Z';
const event=(id,workspace_id='source',occurred_at=clock)=>({event_id:id,workspace_id,occurred_at,service_id:'svc.one',event_type:'demo.changed',object_id:'object:a',payload:{id}});
const object=(id,workspace_id='source')=>({object_id:id,workspace_id,schema_id:'demo.thing',schema_version:'1.0.0',revision:1,created_at:clock,updated_at:clock,created_by_service:'svc.one',updated_by_service:'svc.one',deleted:false,data:{id},extensions:{}});
const relation={relation_id:'relation:1',workspace_id:'source',from_object_id:'object:a',to_object_id:'object:b',relation_type:'demo.related'};
const request=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);r.onblocked=()=>no(Error('blocked'));});
async function open(v){
 const r=indexedDB.open('iwxa-local',v);
 r.onupgradeneeded=e=>runMigrations(r.result,r.transaction,e.oldVersion,v);
 return request(r);
}
globalThis.seedLegacy=async version=>{
 await request(indexedDB.deleteDatabase('iwxa-local'));
 let db=await open(7);
 try{
  const tx=db.transaction([STORES.events,STORES.objects,STORES.relations,STORES.workspaces],'readwrite');
  const finished=new Promise((ok,no)=>{tx.oncomplete=ok;tx.onabort=()=>no(tx.error);tx.onerror=()=>no(tx.error);});
  tx.objectStore(STORES.workspaces).put({workspace_id:'source',profile:'default',capabilities:['read','write'],created_at:clock,updated_at:clock});
  for(const o of [object('object:a'),object('object:b')])tx.objectStore(STORES.objects).add(o);
  for(const e of [event('z'),event('a'),event('m','source','2026-11-24T23:00:00.000Z')])tx.objectStore(STORES.events).add(e);
  tx.objectStore(STORES.relations).add(relation);
  await finished;
 }finally{db.close();}
 if(version===8){db=await open(8);db.close();}
 return true;
};
`;
const candidateCode=`
import {LocalStore,STORES,commitObjectChange} from './src/local-store';
const clock='2026-11-25T00:00:00.000Z',earlier='2026-11-24T23:00:00.000Z';
const event=(id,workspace_id='source',occurred_at=clock)=>({event_id:id,workspace_id,occurred_at,service_id:'svc.one',event_type:'demo.changed',object_id:'object:a',payload:{id}});
const check=(v,code)=>{if(!v)throw Error('DB9_WITNESS_'+code);};
const canon=v=>Array.isArray(v)?v.map(canon):v!==null&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const same=(a,b)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const connect=()=>LocalStore.connect({factory:globalThis.indexedDB});
globalThis.verifyMigration=async version=>{
 const store=await connect();
 try{
  const page=await store.listEventCommitWindow('source',null,10);
  check(same(page.entries.map(e=>e.event),[event('m','source',earlier),event('a'),event('z')]),'LEGACY_EVENTS');
  check(page.entries.every(e=>e.legacyHistory)&&page.legacyHistoryCausalProven===false,'LEGACY_PROOF');
  check((await store.getObject('source','object:a'))?.revision===1,'LEGACY_OBJECT');
  await store.transact(STORES.relations,'readonly',tx=>{
   const r=tx.objectStore(STORES.relations).get(['source','relation:1']);
   r.onsuccess=()=>check(r.result?.relation_id==='relation:1','LEGACY_RELATION');
  });
  if(version===8){
   const write=await commitObjectChange(store,{workspace_id:'source',by_service:'svc.one',expectedRevision:1,
      object:{object_id:'object:a',schema_id:'demo.thing',schema_version:'1.0.0',data:{n:2}},
      event:{event_type:'demo.saved',payload:{n:2},occurred_at:clock}});
   const added=[event('new:z'),event('new:a','source',earlier)];
   await store.transact(STORES.events,'readwrite',tx=>{for(const row of added)tx.objectStore(STORES.events).add(row);});
   const first=await store.listEventCommitWindow('source',page.nextAfterEventId,1);
   const tail=await store.listEventCommitWindow('source',first.nextAfterEventId,10);
   check(first.entries[0].event.event_id===write.event.event_id&&same(tail.entries.map(e=>e.event),added)&&tail.entries.every(e=>!e.legacyHistory),'NEW_COMMIT_ORDER');
   const saved=await store.listEventCommitWindow('source',null,100);
   let rejected=false;
   try{await store.transact([STORES.events,STORES.objects],'readwrite',tx=>{
      tx.objectStore(STORES.events).add(event('aborted'));tx.objectStore(STORES.objects).delete(['source','object:a']);throw Error('abort');});}catch{rejected=true;}
   check(rejected&&same((await store.listEventCommitWindow('source',null,100)).entries,saved.entries)&&
     (await store.getObject('source','object:a'))?.revision===2,'TRANSACTION_ABORT');
   const firstCatalog=await store.listObjectWindow({workspace_id:'source',limit:1,include_deleted:true},['demo.thing']);
   check(firstCatalog.entries.length===1&&firstCatalog.has_more===true,'CATALOG_FIRST');
   const last=await store.listObjectWindow({workspace_id:'source',limit:1,include_deleted:true,after_object_id:firstCatalog.next_after_object_id},['demo.thing']);
   check(firstCatalog.entries[0].object_id==='object:a'&&last.entries[0]?.object_id==='object:b'&&!last.has_more,'CATALOG_LAST');
  }
  return true;
 }finally{store.close();}
};
globalThis.verifyCold=async()=>{
 const store=await connect();
 try{
   const page=await store.listEventCommitWindow('source',null,100);
   check(page.entries.length===6&&page.entries.at(-1).event.event_id==='new:a'&&
     page.entries.slice(0,3).every(e=>e.legacyHistory)&&page.entries.slice(3).every(e=>!e.legacyHistory)&&
     (await store.getObject('source','object:a'))?.revision===2,'COLD_BROWSER_REOPEN');
   return true;
 }finally{store.close();}
};
`;
// stdin resolves imports against the verified source, not a copied Kernel.
async function bundle(code,dir,name){
 const result=await esbuild.build({stdin:{contents:code,resolveDir:dir,sourcefile:name+'.ts',loader:'ts'},
  absWorkingDir:dir,bundle:true,platform:'browser',format:'iife',target:'es2022',write:false,
  nodePaths:[join(candidate,'node_modules')],logLevel:'silent'});
 return result.outputFiles[0].contents;
}
const [legacy,next]=await Promise.all([bundle(legacyCode,old,'legacy'),bundle(candidateCode,candidate,'db9')]);
const html='<!doctype html><meta charset="utf-8"><script src="/legacy.js"></script><script src="/db9.js"></script>';
const server=createServer((req,res)=>{
 if(req.url==='/legacy.js'||req.url==='/db9.js'){res.writeHead(200,{'content-type':'application/javascript','cache-control':'no-store'});res.end(req.url==='/legacy.js'?legacy:next);}
 else if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end(html);}
 else{res.writeHead(404);res.end();}
});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok)});
const url='http://127.0.0.1:'+server.address().port+'/';
const profile=join(root,'profile'),active=join(profile,'DevToolsActivePort');
let proc=null,ws=null;
async function start(){
 await mkdir(profile,{recursive:true});await rm(active,{force:true});
 proc=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,url],{stdio:'ignore'});
 let port;
 for(let i=0;i<150;i++){if(proc.exitCode!==null)fail('BROWSER_EXIT');try{port=Number((await readFile(active,'utf8')).split('\n')[0]);if(port)break;}catch{}await sleep(100);}
 if(!port)fail('BROWSER_START_TIMEOUT');
 let page;
 for(let i=0;i<100;i++){try{page=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith(url));if(page)break;}catch{}await sleep(100);}
 if(!page)fail('PAGE_UNAVAILABLE');
 ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((ok,no)=>{const t=setTimeout(()=>no(Error('DB9_WITNESS_CDP_TIMEOUT')),10000);
  ws.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});
  ws.addEventListener('error',()=>{clearTimeout(t);no(Error('DB9_WITNESS_CDP_CONNECT'));},{once:true});});
 let id=0;
 const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
 const call=(method,params={})=>new Promise((ok,no)=>{
  const n=++id,t=setTimeout(()=>{pending.delete(n);no(Error('DB9_WITNESS_CDP_TIMEOUT'));},60000);
  pending.set(n,m=>{clearTimeout(t);if(m.error)no(Error('DB9_WITNESS_CDP_ERROR'));else ok(m.result);});
  ws.send(JSON.stringify({id:n,method,params}));
 });
 const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails){
    const d=result.exceptionDetails.exception?.description??'';
    const code=d.match(/DB9_WITNESS_[A-Z0-9_]+/)?.[0]??'DB9_WITNESS_PAGE_EXCEPTION';
    throw Error(code);
  }
  return result.result.value;
 };
 for(let i=0;i<100;i++){if(await evaluate("typeof seedLegacy==='function'&&typeof verifyMigration==='function'&&typeof verifyCold==='function'"))return {evaluate,call};await sleep(100);}
 fail('BUNDLE_NOT_READY');
}
async function stop(){
 if(ws){ws.close();ws=null;}
 if(!proc)return;
 const p=proc;proc=null;
 if(p.exitCode!==null)return;
 // SIGTERM allows Chrome to close the persistent IndexedDB database.
 p.kill('SIGTERM');
 for(let i=0;i<100;i++){if(p.exitCode!==null)return;await sleep(100);}
 p.kill('SIGKILL');fail('COLD_BROWSER_CLOSE_TIMEOUT');
}
try{
 let b=await start();
 if(await b.evaluate("typeof indexedDB==='object'&&indexedDB instanceof IDBFactory")!==true)fail('NOT_NATIVE');
 if(await b.evaluate('seedLegacy(7).then(()=>verifyMigration(7))')!==true)fail('DB7_TO_9');
 if(await b.evaluate('seedLegacy(8).then(()=>verifyMigration(8))')!==true)fail('DB8_TO_9');
 await stop();b=await start();
 if(await b.evaluate('verifyCold()')!==true)fail('COLD_REOPEN');
 console.log(JSON.stringify({nativeIndexedDB:true,passed:['db7To9','db8To9','commitOrder','transactionAbort','catalog','coldBrowserReopen']}));
}finally{try{await stop();}finally{server.close();}}
