import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAtlasPort} from '../src/atlas-native.mjs';
import {empty} from '../vendor/atlas/src/core.mjs';

// Fake IPC transport only; domain mutations/readback use actual Atlas core.
// Native filesystem itself is tested by Rust and Windows Actions.
function transport() {
  const stores=new Map(),calls=[];
  const invoke=async(name,args)=>{
    calls.push(name);
    const {organizationId}=args;
    const observed=stores.get(organizationId)||{generation:'none',snapshot:empty()};
    if(name==='center_atlas_open')
      return {...observed,needsConfirmation:false,restoredFromBackup:false};
    if(name==='center_atlas_commit') {
      if(args.expectedGeneration!==observed.generation)throw Error('CAS_CONFLICT');
      const next={generation:'generation-'+(calls.filter(c=>c==='center_atlas_commit').length),snapshot:structuredClone(args.snapshot)};
      stores.set(organizationId,next);
      return {generation:next.generation,revision:next.snapshot.revision,projectBlocksWritten:1};
    }
    throw Error('UNKNOWN_COMMAND');
  };
  return {invoke,stores,calls};
}
test('canonical Atlas project and work write, readback, restart and organization isolation',async()=>{
 const ipc=transport(),p=createNativeAtlasPort(ipc.invoke);
 let session=await p.open('org-one');
 const made=await p.addProject(session,{name:'Manufacturing plan'});
 session=made.session;
 const work=await p.addWork(session,{projectId:made.projectId,title:'Inspect supplier'});
 session=work.session;
 const reopened=await createNativeAtlasPort(ipc.invoke).open('org-one');
 assert.deepEqual(reopened.snapshot,session.snapshot);
 assert.equal(p.view(reopened).projects[0].total,1);
 assert.equal(p.view(reopened).authorization,'NOT_CHECKED');
 assert.equal(p.view(reopened).mode,'NATIVE_ATLAS_LOCAL_ORGANIZATION');
 assert.equal((await p.open('org-two')).snapshot.projects.length,0);
 assert.ok(ipc.calls.filter(x=>x==='center_atlas_commit').length===2);
});
test('stale editor may not overwrite another native generation',async()=>{
 const ipc=transport(),p=createNativeAtlasPort(ipc.invoke);
 const stale=await p.open('org-a');
 await p.addProject(stale,{name:'First'});
 await assert.rejects(()=>p.addProject(stale,{name:'Second'}),/CAS_CONFLICT/);
 assert.equal((await p.open('org-a')).snapshot.projects.length,1);
});
test('lost commit acknowledgement is reconciled from readback without resubmission',async()=>{
 const ipc=transport();
 const invoke=async(name,args)=>{
   const result=await ipc.invoke(name,args);
   if(name==='center_atlas_commit')throw Error('IPC_RECEIPT_LOST');
   return result;
 };
 const p=createNativeAtlasPort(invoke);
 const a=await p.open('org-a');
 const written=await p.addProject(a,{name:'Confirmed once'});
 assert.equal(written.session.snapshot.projects.length,1);
 assert.equal(ipc.calls.filter(x=>x==='center_atlas_commit').length,1);
});
test('damaged native response is never shown as an empty project',async()=>{
 const p=createNativeAtlasPort(async()=>({generation:'g1',needsConfirmation:false,snapshot:{schema:'bad'}}));
 await assert.rejects(()=>p.open('org-a'),/Invalid Atlas snapshot/);
 await assert.rejects(()=>p.open('../other'),/ATLAS_ORGANIZATION_INVALID/);
});

test('native Rust JSON key reordering must not falsely reject a persisted project and work',async()=>{
 const ipc=transport();
 const rekey=value=>JSON.parse(JSON.stringify(value,(_,entry)=>
   entry && typeof entry==='object' && !Array.isArray(entry)
     ? Object.fromEntries(Object.keys(entry).sort().map(k=>[k,entry[k]]))
     : entry));
 const invoke=async(name,args)=>{
   const result=await ipc.invoke(name,args);
   if(name==='center_atlas_open')return {...result,snapshot:rekey(result.snapshot)};
   return result;
 };
 const port=createNativeAtlasPort(invoke);
 let session=await port.open('org-reordered');
 const created=await port.addProject(session,{name:'Windows Atlas project'});
 session=created.session;
 assert.equal(session.snapshot.projects[0].name,'Windows Atlas project');
 const worked=await port.addWork(session,{projectId:created.projectId,title:'Windows Atlas work'});
 assert.equal(worked.session.snapshot.projects[0].items[0].title,'Windows Atlas work');
 assert.equal((await port.open('org-reordered')).generation,worked.session.generation);
 assert.equal(ipc.calls.filter(x=>x==='center_atlas_commit').length,2);
});
test('native readback with changed values must still reject a successful commit receipt',async()=>{
 const ipc=transport();
 const invoke=async(name,args)=>{
   const result=await ipc.invoke(name,args);
   if(name==='center_atlas_open'&&result.snapshot.projects.length){
     const changed=structuredClone(result.snapshot);
     changed.projects[0].name='Wrong project';
     return {...result,snapshot:changed};
   }
   return result;
 };
 const port=createNativeAtlasPort(invoke);
 await assert.rejects(()=>port.addProject(await port.open('org-corrupt'),{name:'Actual project'}),/ATLAS_NATIVE_READBACK_MISMATCH/);
 assert.equal(ipc.calls.filter(x=>x==='center_atlas_commit').length,1);
});
