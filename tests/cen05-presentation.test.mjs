import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationBridge} from '../vendor/brtest/u04-presentation/bridge.mjs';
import {empty,createProject,createItem,editItem} from '../vendor/atlas/src/core.mjs';
import {createAtlasProjectReadPort} from '../vendor/atlas/src/project-host-port.mjs';
import {createCen05PresentationConsumer} from '../runtime/cen05-presentation.mjs';

const make=()=>{
 const p=createProject(empty(),{name:'Original Atlas owner',type:'business'});
 const w=createItem(p.state,p.id,{title:'Work from Atlas'});
 const ref={projectId:p.id,workId:w.id,revision:String(w.state.revision)};
 let snapshot=w.state;
 const nativeCalls=[];
 const adapter={
   linkedWindow:true,
   async launch({appRef,hostRef,launchSpec}) {
     nativeCalls.push(['launch',appRef,hostRef,launchSpec]);
     return {status:'LAUNCHED',pid:1222,processStamp:'original-atlas-1222'};
   },
   async observe(){nativeCalls.push(['observe']);return {observed:true,windowRef:'owned-opaque-window'};},
   async focus(){nativeCalls.push(['focus']);return {focused:true};},
   async verifyProcessIdentity(){return {verified:true}}
 };
 const u04=createPresentationBridge(adapter);
 const reader=createAtlasProjectReadPort({
   openSnapshot:async()=>snapshot,
   // Test fixture authorization: CEN05 must still use the real Atlas port.
   authorize:async()=>true
 });
 const observeWork=async({organizationId,workRef})=>{
   const result=await reader.observeRevision(workRef,{organizationId});
   return {status:result.status,projectId:workRef.projectId,
     workId:workRef.workId,revision:String(snapshot.revision),organizationId};
 };
 let approvals=0;
 const resolveLaunch=async({appRef,hostRef})=>{
   approvals++;
   assert.equal(appRef,'iwxa.atlas');
   assert.equal(hostRef,'center-manager');
   return {authorized:true,launchSpec:{provider:'U01_TEST_HOST_PROVISIONED_ATLAS'}};
 };
 const port=createCen05PresentationConsumer({u04,observeWork,resolveLaunch});
 return {port,ref,u04,nativeCalls,update(value){snapshot=value;},snapshot,workId:w.id,projectId:p.id,
   getApprovals(){return approvals}};
};

test('CEN05 delegates Atlas launch, activate and detach to the actual U04 contract',async()=>{
 const f=make();
 const opened=await f.port.openAtlas({organizationId:'org-A',hostRef:'center-manager',workRef:f.ref});
 assert.equal(opened.status,'WINDOW_OBSERVED');
 assert.equal(opened.openedWorkAutomatically,false);
 assert.deepEqual(opened.workRef,f.ref);
 assert.equal(f.getApprovals(),1);
 assert.deepEqual(f.nativeCalls.map(c=>c[0]),['launch','observe']);
 const focus=await f.port.activateAtlas({organizationId:'org-A',hostRef:'center-manager',
   workRef:f.ref,bindingRef:opened.bindingRef});
 assert.equal(focus.status,'WINDOW_FOCUSED');
 assert.equal(focus.focused,true);
 assert.ok(f.nativeCalls.some(c=>c[0]==='focus'));
 const detached=await f.port.detachAtlas({hostRef:'center-manager',bindingRef:opened.bindingRef});
 assert.deepEqual(detached,{status:'BINDING_CLOSED',processTerminated:false});
 assert.equal(f.nativeCalls.some(c=>c[0]==='kill'),false);
});

test('CEN05 never focuses a U04 binding from another organization or host',async()=>{
 const f=make();
 const opened=await f.port.openAtlas({organizationId:'org-A',hostRef:'center-manager',workRef:f.ref});
 assert.equal(opened.status,'WINDOW_OBSERVED');
 const before=f.nativeCalls.length;
 const anotherOrg=await f.port.activateAtlas({organizationId:'org-B',hostRef:'center-manager',
   workRef:f.ref,bindingRef:opened.bindingRef});
 assert.deepEqual(anotherOrg,{status:'CEN05_BINDING_CONTEXT_CHANGED',focused:false});
 const anotherHost=await f.port.activateAtlas({organizationId:'org-A',hostRef:'another-center',
   workRef:f.ref,bindingRef:opened.bindingRef});
 assert.deepEqual(anotherHost,{status:'CEN05_BINDING_CONTEXT_CHANGED',focused:false});
 const alteredRef=await f.port.activateAtlas({organizationId:'org-A',hostRef:'center-manager',
   workRef:{...f.ref,workId:'not-original'},bindingRef:opened.bindingRef});
 assert.deepEqual(alteredRef,{status:'CEN05_BINDING_CONTEXT_CHANGED',focused:false});
 assert.equal(f.nativeCalls.length,before,'no original OS observation/focus on mismatched context');
 assert.deepEqual(await f.port.detachAtlas({hostRef:'another-center',
   bindingRef:opened.bindingRef}),{status:'CEN05_BINDING_CONTEXT_CHANGED',processTerminated:false});
 const focused=await f.port.activateAtlas({organizationId:'org-A',hostRef:'center-manager',
   workRef:f.ref,bindingRef:opened.bindingRef});
 assert.equal(focused.status,'WINDOW_FOCUSED');
 assert.equal(focused.focused,true);
 assert.equal((await f.port.detachAtlas({hostRef:'center-manager',
   bindingRef:opened.bindingRef})).status,'BINDING_CLOSED');
 assert.deepEqual(await f.port.activateAtlas({organizationId:'org-A',hostRef:'center-manager',
   workRef:f.ref,bindingRef:opened.bindingRef}),{status:'CEN05_BINDING_NOT_FOUND',focused:false});
});

test('CEN05 rejects stale Atlas revision before U01 launch or U04 focus',async()=>{
 const f=make();
 const opened=await f.port.openAtlas({organizationId:'org-A',hostRef:'center-manager',workRef:f.ref});
 const before=f.nativeCalls.length,approvals=f.getApprovals();
 f.update(editItem(f.snapshot,f.projectId,f.workId,{state:'done'}));
 const rejected=await f.port.activateAtlas({organizationId:'org-A',hostRef:'center-manager',
   workRef:f.ref,bindingRef:opened.bindingRef});
 assert.deepEqual(rejected,{status:'WORK_SOURCE_NOT_CURRENT',observationStatus:'SOURCE_REVISION_CHANGED'});
 assert.equal(f.nativeCalls.length,before);
 assert.deepEqual(await f.port.openAtlas({organizationId:'org-A',
   hostRef:'center-manager',workRef:f.ref}),rejected);
 assert.equal(f.getApprovals(),approvals);
 assert.equal(f.ref.revision,opened.workRef.revision,'old task reference must not be rewritten');
});

test('CEN05 does not invent launch when no real U04 or U01 owner is available',async()=>{
 const ref={projectId:'project',workId:'work',revision:'4'};
 const absent=createCen05PresentationConsumer();
 assert.deepEqual(await absent.openAtlas({organizationId:'org',hostRef:'center',workRef:ref}),
   {status:'PRESENTATION_NOT_CONNECTED'});
 const f=make();
 const blocked=createCen05PresentationConsumer({u04:f.u04,
   observeWork:async({workRef})=>({status:'SOURCE_REVISION_MATCHES',...workRef}),
   resolveLaunch:async()=>({authorized:false})});
 assert.deepEqual(await blocked.openAtlas({organizationId:'org',hostRef:'center',
   workRef:f.ref}),{status:'ATLAS_LAUNCH_NOT_AUTHORIZED'});
 assert.equal(f.nativeCalls.length,0);
 await assert.rejects(()=>absent.openAtlas({organizationId:'../unsafe',
   hostRef:'center',workRef:{...ref,revision:'bad'}}),/CEN05_WORK_REF_INVALID/);
});

test('CEN05 respects unsupported U04 launch capability without calling the OS adapter',async()=>{
 const calls=[];
 const u04=createPresentationBridge({
   linkedWindow:false,launchAvailable:false,
   async launch(){calls.push('launch');throw Error('should not launch');},
   async observe(){return {observed:false};},async focus(){return {focused:false};}
 });
 const port=createCen05PresentationConsumer({u04,
   observeWork:async({workRef})=>({status:'SOURCE_REVISION_MATCHES',...workRef}),
   resolveLaunch:async()=>{calls.push('resolve');return {authorized:true,launchSpec:{}};}});
 const result=await port.openAtlas({organizationId:'org',hostRef:'center',
   workRef:{projectId:'p',workId:'w',revision:'2'}});
 assert.deepEqual(result,{status:'PRESENTATION_LAUNCH_UNSUPPORTED'});
 assert.deepEqual(calls,[]);
});
