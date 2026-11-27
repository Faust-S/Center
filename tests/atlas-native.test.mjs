import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAtlasPort,readNativeAtlasPlan} from '../src/atlas-native.mjs';
import {empty,createProject,createItem,editProject,connect,serialize} from '../vendor/atlas/src/core.mjs';
import {readFileSync} from 'node:fs';

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
 await assert.rejects(async()=>port.addProject(await port.open('org-corrupt'),{name:'Actual project'}),/ATLAS_NATIVE_READBACK_MISMATCH/);
 assert.equal(ipc.calls.filter(x=>x==='center_atlas_commit').length,1);
});


test('same-user public Atlas reader observes the actual owner revision without copying or mutating the source',async()=>{
 const project=createProject(empty(),{name:'Owner public project',type:'business',owner:'private owner'});
 const work=createItem(project.state,project.id,{title:'Personal assignment'});
 const original=work.state;
 let owner={generation:'atlas-generation-1',snapshot:original};
 const calls=[];
 const invoke=async(name,args)=>{
   calls.push(name);
   if(name==='center_atlas_public_open') {
     assert.deepEqual(args,{});
     return {...owner,needsConfirmation:false,restoredFromBackup:false};
   }
   throw Error('PUBLIC_ATLAS_NO_WRITE_OR_LOCAL_FALLBACK');
 };
 const port=createNativeAtlasPort(invoke);
 const session=await port.openPublicAtlas('org-one');
 const view=port.view(session);
 assert.equal(view.mode,'NATIVE_ATLAS_PUBLIC_READ_ONLY');
 assert.equal(view.revision,String(original.revision));
 assert.equal(view.projects[0].workItems[0].id,work.id);
 await assert.rejects(()=>port.addProject(session,{name:'Not authorized'}),/ATLAS_PUBLIC_SOURCE_READ_ONLY/);
 await assert.rejects(()=>port.addWork(session,{projectId:project.id,title:'Not authorized'}),/ATLAS_PUBLIC_SOURCE_READ_ONLY/);
 await assert.rejects(()=>port.commit(session,{...original,revision:original.revision+1}),/ATLAS_PUBLIC_SOURCE_READ_ONLY/);
 assert.deepEqual(calls,['center_atlas_public_open']);
 const revised=createItem(original,project.id,{title:'Another owner work'});
 owner={generation:'atlas-generation-2',snapshot:revised.state};
 const fresh=await port.openPublicAtlas('org-one');
 assert.equal(port.view(fresh).revision,String(revised.state.revision));
 assert.equal(port.view(fresh).projects[0].workItems[0].id,work.id);
 assert.equal(view.revision,String(original.revision));
 assert.deepEqual(calls,['center_atlas_public_open','center_atlas_public_open']);
});
test('public owner absent, damaged or requesting recovery never falls back to local Center Atlas',async()=>{
 const missing=createNativeAtlasPort(async()=>{throw Error('ATLAS_PUBLIC_SOURCE_NOT_FOUND');});
 await assert.rejects(()=>missing.openPublicAtlas('org-one'),/ATLAS_PUBLIC_SOURCE_NOT_FOUND/);
 const damaged=createNativeAtlasPort(async()=>({generation:'g1',needsConfirmation:false,snapshot:{schema:'fake'}}));
 await assert.rejects(()=>damaged.openPublicAtlas('org-one'),/Invalid Atlas snapshot/);
 const recovery=createNativeAtlasPort(async()=>({generation:'g1',needsConfirmation:true,snapshot:empty()}));
 await assert.rejects(()=>recovery.openPublicAtlas('org-one'),/ATLAS_PUBLIC_RECOVERY_REQUIRED/);
 await assert.rejects(()=>recovery.openPublicAtlas('../escape'),/ATLAS_ORGANIZATION_INVALID/);
});

test("installed Atlas observation callback cannot present a local Center plan as the owner",()=>{
 const panel=readFileSync(new URL("../src/NativeAtlasPanel.tsx",import.meta.url),"utf8");
 assert.match(panel,/s\.sourceKind==='PUBLIC_ATLAS_READ_ONLY'\?next:null/);
 assert.match(panel,/Локальные планы Center — отдельная подготовительная область/);
});

test('Center reads selected readiness from original Atlas without mutating its snapshot',async()=>{
 const p=createProject(empty(),{name:'Assembly',type:'engineering'});
 const dated=editProject(p.state,p.id,{startDate:'2026-11-23',status:'active'});
 const a=createItem(dated,p.id,{title:'Prepare'});
 const b=createItem(a.state,p.id,{title:'Install'});
 const snapshot=connect(b.state,p.id,a.id,b.id);
 const before=serialize(snapshot);
 const calls=[];
 const port=createNativeAtlasPort(async(name)=>{
  calls.push(name);
  assert.equal(name,'center_atlas_public_open');
  return {generation:'owner-1',snapshot,needsConfirmation:false};
 });
 const session=await port.openPublicAtlas('org-a');
 const plan=readNativeAtlasPlan(session,p.id);
 assert.equal(plan.revision,String(snapshot.revision));
 assert.equal(plan.totals.ready,1);
 assert.equal(plan.totals.waiting,1);
 assert.equal(plan.works.find(w=>w.id===b.id).status,'waiting');
 assert.deepEqual(calls,['center_atlas_public_open']);
 assert.equal(serialize(snapshot),before);
 assert.equal(port.view(session).authorization,'NOT_CHECKED');
});

test('Center preparation export uses the canonical .iwxa writer and exact local generation',async()=>{
 const {readIwxaPortfolio,fromBase64}=await import('../vendor/atlas/desktop/src/iwxa-portfolio.mjs');
 const ipc=transport();
 const calls=[];
 let exported=null;
 const port=createNativeAtlasPort(async(name,args)=>{
   calls.push(name);
   if(name==='center_atlas_export_iwxa'){
     const stored=ipc.stores.get(args.organizationId);
     assert.equal(stored.generation,args.expectedGeneration);
     exported=await readIwxaPortfolio(fromBase64(args.archiveBase64));
     return 'saved.iwxa';
   }
   return ipc.invoke(name,args);
 });
 const p=await port.addProject(await port.open('org-export'),{name:'Prepared project'});
 const w=await port.addWork(p.session,{projectId:p.projectId,title:'Prepared Work'});
 assert.equal(await port.exportPreparation(w.session),'saved.iwxa');
 assert.deepEqual(exported.snapshot,w.session.snapshot);
 const {prepareAddedSnapshot}=await import('../vendor/atlas/desktop/src/import-snapshot.mjs');
 const existing=createProject(empty(),{name:'Already in installed Atlas'});
 const existingWork=createItem(existing.state,existing.id,{title:'Existing Work'});
 const before=serialize(existingWork.state);
 const added=prepareAddedSnapshot(existingWork.state,exported.snapshot);
 assert.equal(added.addedProjects,1);
 assert.equal(added.addedWorks,1);
 assert.deepEqual(added.snapshot.projects,[...existingWork.state.projects,...w.session.snapshot.projects]);
 assert.equal(serialize(existingWork.state),before);
 assert.equal(calls.filter(x=>x==='center_atlas_export_iwxa').length,1);
 await assert.rejects(()=>port.exportPreparation(p.session),/ATLAS_PREPARATION_CHANGED_BEFORE_EXPORT/);
 assert.equal(calls.filter(x=>x==='center_atlas_export_iwxa').length,1);
 await assert.rejects(()=>port.exportPreparation({...w.session,sourceKind:'PUBLIC_ATLAS_READ_ONLY'}),/ATLAS_PUBLIC_SOURCE_READ_ONLY/);
});
