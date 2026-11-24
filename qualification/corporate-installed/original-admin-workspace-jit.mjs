// Original DPAPI and signed Control/JIT source qualification, NOT an installed
// GUI or a real T2 Kernel witness. The only fixture is the Kernel transport.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {MessageChannel} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const [privateRoot,coreRoot,...extra]=process.argv.slice(2);
assert.equal(process.platform,'win32');
assert.ok(extra.length===0&&isAbsolute(privateRoot)&&isAbsolute(coreRoot));
const load=(root,path)=>import(pathToFileURL(join(root,path)).href);
const [native,access,http,loopback,subject,transport]=await Promise.all([
 load(privateRoot,'interop/native-admin-d3.mjs'),
 load(coreRoot,'src/t3/signed-access-host-port.mjs'),
 load(coreRoot,'src/t3/original-control-http-handler.mjs'),
 load(coreRoot,'src/t3/control-loopback-owner.mjs'),
 load(coreRoot,'src/t3/subject-access-binding.mjs'),
 load(coreRoot,'src/t3/origin-isolated-kernel-transport.mjs'),
]);
const root=realpathSync(mkdtempSync(join(tmpdir(),'iwxa-admin-workspace-jit-')));
const org=randomUUID(),workspace=randomUUID(),managerRoot=join(root,'owner');
const token=randomBytes(32).toString('base64url');
const listeners=new Set();
let manager=null,server=null,stop=null,handler=null,epoch=1,phase='ENROLL',checks=0;
let stored=null,reads=0,creates=0,receiver=null,client=null;
const timings={};
const measured=async(name,fn)=>{const start=performance.now();try{return await fn()}finally{timings[name]=Math.round(performance.now()-start)}};
const fixture={
 sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
 hasOperation:op=>['t1.getWorkspace','t1.createWorkspace'].includes(op),
 async getWorkspace(id){
  assert.equal(id,workspace);reads++;
  return stored===null?null:structuredClone(stored);
 },
 async createWorkspace(input){
  assert.equal(input.workspace_id,workspace);assert.equal(input.profile,'generic');
  assert.equal(stored,null,'exactly one write');
  creates++;stored={...input,revision:1,read_only:false,deleted_at:null};
  return structuredClone(stored);
 },
};
const failCode=e=>typeof e?.code==='string'&&/^[A-Z][A-Z0-9_]{3,99}$/.test(e.code)
 ?e.code:e?.name==='AssertionError'?'ASSERTION_FAILED':
 typeof e?.message==='string'&&/^(?:T3_|INTEROP_|ORG_|ACCESS_)[A-Z0-9_]{3,90}$/.test(e.message)
 ?e.message:'OTHER';
try{
 const request=join(root,'enroll.json');
 writeFileSync(request,JSON.stringify({organizationId:org,workspaceId:workspace,
  organizationName:'Original Workspace JIT qualification'}),{flag:'wx'});
 assert.equal(native.runNativeAdminD3(['d3-enroll',managerRoot,org,request]).operation,'D3_ENROLLED');
 manager=native.openInstalledOriginalAdminD3HostPort({root:managerRoot,organizationId:org,
  confirmHumanReview:async()=>false,currentHostEpoch:()=>epoch});
 const snapshot=manager.nativeState().view.snapshot;
 assert.equal(snapshot.organizationId,org);assert.equal(snapshot.workspaceId,workspace);checks++;
 phase='CONTROL_HTTP_ATTACH';
 server=createServer((req,res)=>{
  if(handler)void handler(req,res);
  else{res.writeHead(503);res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const origin='http://127.0.0.1:'+server.address().port;
 handler=manager.mountOriginalControlHttp({
  createOriginalControlHttpHandler:http.createOriginalControlHttpHandler,
  createSignedAccessHostPort:access.createSignedAccessHostPort,
  origin,token,subscribeInvalidation:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
 });
 const browser=loopback.createControlLoopbackOwner({origin,token,
  fetchImpl:(url,options={})=>fetch(url,{...options,headers:{...options.headers,Origin:origin}})});
 stop=browser.subscribeSignedAccessInvalidation(()=>{});
 phase='SIGNED_READ_CONTEXT';
 const read=await measured('selectRead',()=>browser.signedKernelAccess('getWorkspace'));
 assert.ok(read);
 const rc=await read.currentContext();
 assert.equal(rc.kind,'CORP');assert.equal(rc.organization_id,org);assert.equal(rc.workspace_id,workspace);
 assert.equal(rc.grant_id,'grant:workspace-read');
 checks++;
 phase='SIGNED_READ_JIT';
 const readPort=subject.createSubjectKernelBinding({kernel:fixture,access:read});
 assert.equal(await measured('readJit',()=>readPort.getWorkspace(workspace)),null);
 assert.equal(reads,1);assert.equal(creates,0);checks++;
 phase='CROSS_SCOPE_DENIED';
 await assert.rejects(readPort.getWorkspace(randomUUID()),{code:'T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE'});
 assert.equal(reads,1);
 await assert.rejects(readPort.createWorkspace({workspace_id:workspace,profile:'generic'}));
 assert.equal(creates,0);checks++;
 phase='SIGNED_CREATE_CONTEXT';
 const writer=await browser.signedKernelAccess('createWorkspace');
 assert.ok(writer);const wc=await writer.currentContext();
 assert.equal(wc.workspace_id,workspace);assert.equal(wc.organization_id,org);
 assert.equal(wc.grant_id,'grant:workspace-onboarding');
 assert.notEqual(wc.grant_id,rc.grant_id);checks++;
 phase='SIGNED_CREATE_JIT';
 const writePort=subject.createSubjectKernelBinding({kernel:fixture,access:writer});
 assert.equal((await measured('createJit',()=>writePort.createWorkspace({workspace_id:workspace,profile:'generic'}))).workspace_id,workspace);
 assert.equal(creates,1);checks++;
 phase='SIGNED_READBACK_JIT';
 assert.equal((await measured('readbackJit',()=>readPort.getWorkspace(workspace))).workspace_id,workspace);
 assert.equal(reads,2);assert.equal(creates,1);checks++;
 phase='NO_UNSCOPED_WRITES';
 assert.equal(await browser.signedKernelAccess('putObject'),null);
 assert.equal(await browser.signedKernelAccess('commitObjectGraph'),null);checks++;
 phase='SIGNED_MESSAGE_PORT_READ';
 const {port1,port2}=new MessageChannel();
 // Same transport as the installed trusted realm. The original native JIT
 // is exercised on every call; storage is still explicitly a fixture.
 receiver=transport.bindSignedOriginalKernelPort({port:port1,isActive:()=>true,
  createSignedFacade:async()=>({getWorkspace:async(id)=>{
    const owner=await browser.signedKernelAccess('getWorkspace');
    assert.ok(owner);
    const initial=await owner.currentContext();
    const bound=subject.createSubjectKernelBinding({kernel:fixture,access:owner});
    const row=await bound.getWorkspace(id);
    const current=await browser.signedKernelAccess('getWorkspace');
    assert.deepEqual(await current.currentContext(),initial);
    return row;
  }})});
 client=transport.createIsolatedKernelClient({port:port2}); // exact installed default
 assert.equal((await measured('messagePortRead',()=>client.invoke('getWorkspace',workspace))).workspace_id,workspace);
 assert.equal(reads,3);assert.equal(creates,1);checks++;
 process.stdout.write(JSON.stringify({result:'PASS',checks,reads,creates,timings,
  originalControlHttp:true,windowsDpapi:true,realKernel:false,productionActivation:false})+'\n');
}catch(e){
 process.stderr.write('ADMIN_WORKSPACE_JIT_PHASE='+phase+'\nADMIN_WORKSPACE_JIT_CODE='+failCode(e)+'\n');
 process.exitCode=1;
}finally{
 client?.close();receiver?.close();stop?.();
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await manager?.close();
 rmSync(root,{recursive:true,force:true});
}
