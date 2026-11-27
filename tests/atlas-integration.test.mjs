import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,createProject,createItem,editItem,serialize} from '../vendor/atlas/src/core.mjs';
import {addPortfolioLink} from '../vendor/atlas/src/portfolio.mjs';
import {addPlanningResource} from '../vendor/atlas/src/resource-planning.mjs';
import {readAtlasPortfolio,linkableAtlasProject,linkableAtlasWork,atlasLinkReadback,atlasWorkReadback,compareAtlasSourceCopies,selectAtlasReferenceSource,ATLAS_SOURCE_REVISION} from '../src/atlas-integration.mjs';
import {emptyDraft,applyDraftCommand} from '../src/organization.mjs';

function sample() {
  const a = createProject(empty(), {name:'First project',type:'business'});
  const b = createProject(a.state, {name:'Second project',type:'team'});
  const item = createItem(b.state,a.id,{title:'Inspect delivery'});
  let snapshot = editItem(item.state,a.id,item.id,{state:'in_progress'});
  snapshot = addPortfolioLink(snapshot,{from:a.id,to:b.id});
  return {snapshot,a:a.id,b:b.id,item:item.id};
}
test('Atlas actual owner model is imported, validated and summarized without rewriting projects',()=>{
 const {snapshot,a,b,item}=sample();
 const before=serialize(snapshot);
 const view=readAtlasPortfolio(before);
 assert.equal(view.source,'atlas.project/1');
 assert.equal(view.revision,String(snapshot.revision));
 assert.equal(view.projects.length,2);
 assert.equal(view.dependencies.length,1);
 assert.deepEqual(view.dependencies[0],{from:a,to:b,kind:'blocks'});
 assert.deepEqual(view.projects[0].workItems[0].id,item);
 assert.equal(view.projects[0].total,1);
 assert.equal(view.projects[0].progress,0);
 assert.equal(view.authorization,'NOT_CHECKED');
 assert.equal(view.mode,'READ_ONLY_USER_SELECTED_FILE');
 assert.equal(serialize(snapshot),before);
 assert.equal(ATLAS_SOURCE_REVISION,'4b062e3d92d118385843cc81f65902b11393506c');
});
test('only a project from current Atlas preview can be linked with exact portfolio revision',()=>{
 const {snapshot,a}=sample(),view=readAtlasPortfolio(serialize(snapshot));
 const link=linkableAtlasProject(view,a);
 assert.deepEqual(link,{projectId:a,revision:String(snapshot.revision)});
 assert.equal(atlasLinkReadback(view,link),'SOURCE_REVISION_MATCHES');
 assert.equal(atlasLinkReadback(view,{...link,revision:'0'}),'SOURCE_REVISION_CHANGED');
 assert.equal(atlasLinkReadback(view,{...link,projectId:'missing'}),'PROJECT_MISSING_IN_SOURCE');
 assert.equal(atlasLinkReadback(null,link),'NOT_OBSERVED');
 assert.throws(()=>linkableAtlasProject(view,'unknown'),/ATLAS_PROJECT_NOT_IN_PREVIEW/);
 assert.throws(()=>linkableAtlasProject(null,a),/ATLAS_PREVIEW_REQUIRED/);
});
test('read-only Atlas cannot turn an arbitrary JSON file into a trusted portfolio',()=>{
 for(const raw of ['{}','{bad','[]',JSON.stringify({schema:'atlas.project/1',revision:0,projects:[{id:'a'}]})])
   assert.throws(()=>readAtlasPortfolio(raw),/ATLAS_SNAPSHOT_INVALID/);
 assert.throws(()=>readAtlasPortfolio('a'.repeat(16*1024*1024+1)),/ATLAS_SNAPSHOT_SIZE_INVALID/);
});
test('Center stores Atlas reference only, never a competing project snapshot',()=>{
 const {snapshot,a}=sample(),view=readAtlasPortfolio(serialize(snapshot));
 const id=()=> 'id-'+Math.random().toString(36).slice(2,12);
 let draft=applyDraftCommand(emptyDraft(),{type:'CREATE_ORGANIZATION',name:'Team'}, {id});
 const organizationId=draft.activeOrganizationId;
 draft=applyDraftCommand(draft,{type:'ADD_WORKSPACE',organizationId,name:'Delivery'},{id});
 const workspaceId=draft.organizations[0].workspaces[0].id;
 draft=applyDraftCommand(draft,{type:'LINK_ATLAS_WORKSPACE',organizationId,workspaceId,
    atlasRef:linkableAtlasProject(view,a)},{id});
 const saved=draft.organizations[0].workspaces[0].atlasRef;
 assert.equal(saved.projectId,a);
 assert.equal(saved.revision,String(snapshot.revision));
 assert.equal('projects' in draft.organizations[0],false);
 assert.equal('workItems' in draft.organizations[0],false);
 assert.equal(JSON.stringify(draft).includes('Inspect delivery'),false);
});

test('canonical Atlas work reference binds exact item and portfolio revision',()=>{
 const {snapshot,a,b,item}=sample(),view=readAtlasPortfolio(serialize(snapshot));
 const ref=linkableAtlasWork(view,a,item);
 assert.deepEqual(ref,{projectId:a,workId:item,revision:String(snapshot.revision)});
 assert.throws(()=>linkableAtlasWork(view,b,item),/ATLAS_WORK_NOT_IN_PREVIEW/);
 assert.throws(()=>linkableAtlasWork(view,a,'missing'),/ATLAS_WORK_NOT_IN_PREVIEW/);
 assert.throws(()=>linkableAtlasWork(null,a,item),/ATLAS_PREVIEW_REQUIRED/);
});

test('work link observation detects revision drift but retains previous reference',()=>{
 const {snapshot,a,item}=sample();
 const current=readAtlasPortfolio(serialize(snapshot)),ref=linkableAtlasWork(current,a,item);
 assert.equal(atlasWorkReadback(current,ref),'SOURCE_REVISION_MATCHES');
 assert.equal(atlasWorkReadback(current,{...ref,revision:'0'}),'SOURCE_REVISION_CHANGED');
 assert.equal(atlasWorkReadback(current,{...ref,workId:'not-existing'}),'WORK_MISSING_IN_SOURCE');
 assert.equal(atlasWorkReadback(current,{...ref,projectId:'not-existing'}),'PROJECT_MISSING_IN_SOURCE');
 assert.equal(atlasWorkReadback(null,ref),'NOT_OBSERVED');
 assert.equal(atlasWorkReadback(current,{projectId:a,revision:current.revision}),'WORK_NOT_LINKED');
 assert.equal(atlasWorkReadback(current,null),'WORK_NOT_LINKED');
 assert.deepEqual(ref,linkableAtlasWork(current,a,item));
});


test('canonical desktop owner projection permits exact work links but never confers T3 grants',()=>{
 const {snapshot,a,item}=sample();
 const view={...readAtlasPortfolio(serialize(snapshot)),mode:'NATIVE_ATLAS_PUBLIC_READ_ONLY'};
 const reference=linkableAtlasWork(view,a,item);
 assert.deepEqual(reference,{projectId:a,workId:item,revision:String(snapshot.revision)});
 assert.equal(atlasWorkReadback(view,reference),'SOURCE_REVISION_MATCHES');
 assert.equal(view.authorization,'NOT_CHECKED');
 assert.equal(view.projects.length,2);
});

test('reopening an Atlas file compares source contents, never rewrites historical WorkRef',()=>{
 const {snapshot,a,item}=sample();
 const original=readAtlasPortfolio(serialize(snapshot));
 const ref=linkableAtlasWork(original,a,item);
 const same=compareAtlasSourceCopies(original,original);
 assert.equal(same.contentChanged,false);
 assert.equal(same.revisionRelation,'same');
 const edited=editItem(snapshot,a,item,{title:'Updated delivery'});
 const newer=readAtlasPortfolio(serialize(edited));
 const delta=compareAtlasSourceCopies(original,newer);
 assert.equal(delta.revisionRelation,'higher');
 assert.equal(delta.changedWorks,1);
 assert.equal(delta.contentChanged,true);
 assert.equal(atlasWorkReadback(newer,ref),'SOURCE_REVISION_CHANGED');
 assert.equal(ref.revision,String(snapshot.revision));
 assert.equal(compareAtlasSourceCopies(newer,original).revisionRelation,'lower');
});
test('copy with same revision and changed work is not silently considered identical',()=>{
 const {snapshot}=sample(),original=readAtlasPortfolio(serialize(snapshot));
 const modified=structuredClone(original);
 modified.projects[0].workItems[0].title='Changed without revision';
 const delta=compareAtlasSourceCopies(original,modified);
 assert.equal(delta.revisionRelation,'same');
 assert.equal(delta.contentChanged,true);
 assert.equal(delta.changedWorks,1);
 const unrelated=structuredClone(original);
 unrelated.projects.forEach(p=>{p.id='other-'+p.id});
 assert.equal(compareAtlasSourceCopies(original,unrelated).revisionRelation,'unrelated');
 assert.throws(()=>compareAtlasSourceCopies(null,original),/ATLAS_PREVIEW_REQUIRED/);
});

test("reference checks reject local Center plans as proof of original installed Atlas",()=>{
 const {snapshot}=sample();
 const preview=readAtlasPortfolio(serialize(snapshot));
 const file={...preview,mode:'READ_ONLY_USER_SELECTED_FILE'};
 const installed={...preview,mode:'NATIVE_ATLAS_PUBLIC_READ_ONLY'};
 const local={...preview,mode:'NATIVE_ATLAS_LOCAL_ORGANIZATION'};
 assert.equal(selectAtlasReferenceSource(null,local,'native'),null);
 assert.equal(selectAtlasReferenceSource(file,local,'native'),file);
 assert.equal(selectAtlasReferenceSource(file,installed,'file'),file);
 assert.equal(selectAtlasReferenceSource(file,installed,'native'),installed);
 assert.equal(selectAtlasReferenceSource(null,installed,'file'),installed);
 assert.equal(selectAtlasReferenceSource(null,null,'file'),null);
});

test('Atlas draft link target requires explicit selection when several workspaces compete',async()=>{
 const {selectAtlasTargetWorkspace:select,atlasWorkspaceBindingMatches:matches}=await import('../src/atlas-integration.mjs');
 const ref={projectId:'project:one',revision:'8',workId:'work:one'};
 const plain={id:'workspace:a',name:'A',atlasRef:null};
 const linked={id:'workspace:b',name:'B',atlasRef:{projectId:ref.projectId,revision:ref.revision}};
 const other={id:'workspace:c',name:'C',atlasRef:linked.atlasRef};
 assert.equal(select([plain],'',ref),plain);
 assert.equal(select([plain,{...linked,atlasRef:null}],'',ref),null);
 assert.equal(select([plain,linked],'',ref),linked);
 assert.equal(select([plain,linked,other],'',ref),null);
 assert.equal(select([plain,linked],'workspace:a',ref),plain);
 assert.equal(select([plain,linked],'workspace:foreign',ref),null);
 assert.equal(matches(linked,ref),true);
 assert.equal(matches(plain,ref),false);
 assert.equal(matches(linked,{...ref,revision:'9'}),false);
});

test('refresh keeps exact project and Work, never substitutes removed selection',async()=>{
 const {selectAtlasAfterRead:select}=await import('../src/atlas-integration.mjs');
 const view={projects:[{id:'p1',workItems:[{id:'w1'},{id:'w2'}]},{id:'p2',workItems:[{id:'w3'}]}]};
 assert.deepEqual(select(view,{projectId:'',workId:''}),{projectId:'p1',workId:'w1'});
 assert.deepEqual(select(view,{projectId:'p1',workId:'w2'},{sameSource:true}),{projectId:'p1',workId:'w2'});
 assert.deepEqual(select(view,{projectId:'p1',workId:'gone'},{sameSource:true}),{projectId:'p1',workId:''});
 assert.deepEqual(select(view,{projectId:'gone',workId:'w3'},{sameSource:true}),{projectId:'',workId:''});
 assert.deepEqual(select(view,{projectId:'p1',workId:'w1'},{sameSource:true,createdWorkId:'w2'}),{projectId:'p1',workId:'w2'});
});

test('a selected exact Atlas Work prefills title, due date and priority without guessing people',async()=>{
 const {prepareAtlasAssignmentFields:prepare,atlasResourceForWork}=await import('../src/atlas-integration.mjs');
 const p=createProject(empty(),{name:'Assembly',type:'engineering'});
 const r=addPlanningResource(p.state,{label:'Alex',capacityPct:100});
 const w=createItem(r.state,p.id,{title:'Fit parts',resourceId:r.id,assignee:'Alex',dueDate:'2026-12-01'});
 const state=editItem(w.state,p.id,w.id,{priority:'critical'});
 const local=readAtlasPortfolio(serialize(state)),native={...local,mode:'NATIVE_ATLAS_PUBLIC_READ_ONLY'};
 const ref=linkableAtlasWork(native,p.id,w.id);
 const org={participants:[{id:'employee-a',name:'Alex'},{id:'employee-b',name:'Alex'}]};
 const fields=prepare(native,ref,org);
 assert.deepEqual(fields,{title:'Fit parts',dueDate:'2026-12-01',priority:'high',assigneeId:'',reviewerId:'',titleNeedsEdit:false});
 assert.equal(atlasResourceForWork(native,ref),r.id);
 assert.throws(()=>atlasResourceForWork(local,ref),/ATLAS_INSTALLED_SOURCE_REQUIRED/);
 const mapped={...org,atlasResourceBindings:[{resourceId:r.id,participantId:'employee-b'}]};
 assert.equal(prepare(native,ref,mapped).assigneeId,'employee-b');
 assert.equal(prepare(local,ref,mapped).assigneeId,'');
 assert.equal(prepare(native,ref,{...mapped,participants:org.participants.slice(0,1)}).assigneeId,'');
 assert.throws(()=>prepare(native,{...ref,revision:'0'},mapped),/ATLAS_SOURCE_REVISION_CHANGED/);
});
