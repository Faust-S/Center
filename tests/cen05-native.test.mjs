import test from 'node:test';
import assert from 'node:assert/strict';
import {createCen05NativePort} from '../src/cen05-native.mjs';

test('native U04 uses exact work/organization and never accepts executable or HWND',async()=>{
 const seen=[];
 const port=createCen05NativePort(async(command,params)=>{
   seen.push([command,params]);
   return {schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',status:'WINDOW_OBSERVED',
     openedWorkAutomatically:false,bindingRef:'binding-1'};
 });
 const ref={organizationId:'org-1',projectId:'project-1',workId:'work-1',revision:'3'};
 assert.equal((await port.open(ref)).bindingRef,'binding-1');
 await port.activate({...ref,bindingRef:'binding-1'});
 await port.returnToCenter({...ref,bindingRef:'binding-1'});
 await port.detach({organizationId:'org-1',bindingRef:'binding-1'});
 assert.deepEqual(seen.map(([command])=>command),[
  'center_u04_open','center_u04_activate','center_u04_return','center_u04_detach'
 ]);
 assert.deepEqual(seen[0][1],ref);
 await assert.rejects(()=>port.open({...ref,revision:'03'}),/CEN05_WORK_REF_INVALID/);
 await assert.rejects(()=>port.activate({...ref,bindingRef:''}),/CEN05_BINDING_INVALID/);
});
test('native U04 consumer refuses invented focus, auto-selected work, and invalid receipts',async()=>{
 const ref={organizationId:'org-1',projectId:'p',workId:'w',revision:'1'};
 const invalid=createCen05NativePort(async()=>({schema:'other',status:'WINDOW_FOCUSED'}));
 await assert.rejects(()=>invalid.open(ref),/CEN05_NATIVE_RESPONSE_INVALID/);
 const fakeSelection=createCen05NativePort(async()=>({
   schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',status:'WINDOW_OBSERVED',
   openedWorkAutomatically:true}));
 await assert.rejects(()=>fakeSelection.open(ref),/CEN05_NATIVE_RESPONSE_INVALID/);
});

test('stale Atlas revision after window return is a visible native readback status',async()=>{
 const api=createCen05NativePort(async(command)=>({
  schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',
  status:command==='center_u04_return'?'WORK_SOURCE_NOT_CURRENT':'WINDOW_OBSERVED',
  revisionMatches:false,openedWorkAutomatically:false,centerFocused:true,
  reason:'SOURCE_REVISION_CHANGED'
 }));
 const result=await api.returnToCenter({organizationId:'org',projectId:'p',workId:'w',revision:'1',bindingRef:'b'});
 assert.equal(result.status,'WORK_SOURCE_NOT_CURRENT');
 assert.equal(result.revisionMatches,false);
 assert.equal(result.centerFocused,true);
 assert.equal(result.openedWorkAutomatically,false);
});
