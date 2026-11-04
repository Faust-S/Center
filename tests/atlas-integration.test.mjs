import test from 'node:test';
import assert from 'node:assert/strict';
import {empty,createProject,createItem,editItem,serialize} from '../vendor/atlas/src/core.mjs';
import {addPortfolioLink} from '../vendor/atlas/src/portfolio.mjs';
import {readAtlasPortfolio,linkableAtlasProject,linkableAtlasWork,atlasLinkReadback,atlasWorkReadback,ATLAS_SOURCE_REVISION} from '../src/atlas-integration.mjs';
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
 assert.equal(ATLAS_SOURCE_REVISION,'e5cc6ff593aa12eec3da8e8940ad5af5819b66fd');
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
