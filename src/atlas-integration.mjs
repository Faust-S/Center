// Read-only projection over the ONE Atlas domain model. The canonical source
// is a pinned public Atlas checkout bundled by Vite at build time.
// This is neither an organisational authorization nor a second project store.
import {deserialize, summary} from '../vendor/atlas/src/core.mjs';
import {portfolioNetwork} from '../vendor/atlas/src/portfolio.mjs';

export const ATLAS_SOURCE_REVISION = '97993ad73c9d6a50d9e43335360882cc3ec09c19';
export const ATLAS_SNAPSHOT_LIMIT = 16 * 1024 * 1024;
const fail = code => {throw Object.assign(new Error(code), {code});};

export function readAtlasPortfolio(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > ATLAS_SNAPSHOT_LIMIT)
    fail('ATLAS_SNAPSHOT_SIZE_INVALID');
  let snapshot, network;
  try {
    snapshot = deserialize(raw);
    network = portfolioNetwork(snapshot);
  } catch {
    fail('ATLAS_SNAPSHOT_INVALID');
  }
  const resources=new Map((snapshot.resources??[]).map(r=>[r.id,r]));
  return {
    source: 'atlas.project/1',
    revision: String(snapshot.revision),
    projects: snapshot.projects.map(p => {
      const progress = summary(p);
      return {
        id: p.id, name: p.name, status: p.status,
        owner: p.owner || '', dueDate: p.dueDate || '',
        total: progress.total, done: progress.done, blocked: progress.blocked,
        progress: progress.progress, stages: p.stages.length,
        workItems: p.items.map(i => ({
          id: i.id, title: i.title, state: i.state,
          dueDate: i.dueDate || '', priority: i.priority,
          assignee:i.assignee??'',
          resourceId:i.resourceId??null,
          resourceLabel:resources.get(i.resourceId)?.label??'',
          allocationPct:i.resourceId?(i.allocationPct??100):null
        }))
      };
    }),
    dependencies: network.links.map(d=>({from:d.from,to:d.to,kind:d.kind})),
    // The user-selected file is a source preview only. No membership, grant,
    // freshness guarantee, or project write authority is implied.
    authorization: 'NOT_CHECKED',
    mode: 'READ_ONLY_USER_SELECTED_FILE'
  };
}

export function linkableAtlasProject(view, projectId) {
  if (!view || view.source !== 'atlas.project/1' ||
      !['READ_ONLY_USER_SELECTED_FILE','NATIVE_ATLAS_LOCAL_ORGANIZATION',
        'NATIVE_ATLAS_PUBLIC_READ_ONLY'].includes(view.mode) ||
      view.authorization !== 'NOT_CHECKED') fail('ATLAS_PREVIEW_REQUIRED');
  const p = view.projects.find(p => p.id === projectId);
  if (!p) fail('ATLAS_PROJECT_NOT_IN_PREVIEW');
  return {projectId:p.id,revision:view.revision};
}

// A work link is derived from an existing canonical Atlas item, never from free text.
export function linkableAtlasWork(view, projectId, workId) {
  const link = linkableAtlasProject(view, projectId);
  const project = view.projects.find(p => p.id === projectId);
  const work = project.workItems.find(item => item.id === workId);
  if (!work) fail('ATLAS_WORK_NOT_IN_PREVIEW');
  return {...link, workId: work.id};
}

// An explicit manager choice takes precedence. Never silently link the
// first of several unrelated areas. A unique existing exact link may be
// offered as a default; a sole workspace is unambiguous.
/**
 * @template {{id:string,atlasRef?:{projectId:string,revision:string}|null}} W
 * @param {W[]} workspaces
 * @param {string} selectedId
 * @param {{projectId:string,revision:string}|null} reference
 * @returns {W|null}
 */
export function selectAtlasTargetWorkspace(workspaces,selectedId,reference=null){
 if(!Array.isArray(workspaces)||!workspaces.length)return null;
 if(selectedId)return workspaces.find(w=>w.id===selectedId)??null;
 if(workspaces.length===1)return workspaces[0];
 const matches=reference?workspaces.filter(w=>
   w.atlasRef?.projectId===reference.projectId&&w.atlasRef?.revision===reference.revision):[];
 return matches.length===1?matches[0]:null;
}
export function atlasWorkspaceBindingMatches(workspace,reference){
 return !!workspace&&!!reference&&
   workspace.atlasRef?.projectId===reference.projectId&&
   workspace.atlasRef?.revision===reference.revision;
}

export function atlasLinkReadback(view, link) {
  if (!link || !view) return 'NOT_OBSERVED';
  const p = view.projects.find(p => p.id === link.projectId);
  if (!p) return 'PROJECT_MISSING_IN_SOURCE';
  return String(link.revision) === view.revision ? 'SOURCE_REVISION_MATCHES' : 'SOURCE_REVISION_CHANGED';
}

// Observes only the opened canonical Atlas source; no T3 authority is inferred.
// Historical references are never rewritten by this read-only comparison.
export function atlasWorkReadback(view,ref) {
  if(!ref?.workId)return 'WORK_NOT_LINKED';
  if(!view)return 'NOT_OBSERVED';
  const project=view.projects.find(p=>p.id===ref.projectId);
  if(!project)return 'PROJECT_MISSING_IN_SOURCE';
  if(!project.workItems.some(w=>w.id===ref.workId))return 'WORK_MISSING_IN_SOURCE';
  return String(view.revision)===String(ref.revision) ? 'SOURCE_REVISION_MATCHES' : 'SOURCE_REVISION_CHANGED';
}

/** Compare two explicitly selected Atlas source copies. Informational only:
 * neither the revision count nor a matching WorkRef proves source freshness. */
export function compareAtlasSourceCopies(previous,current){
 if(!previous||!current||previous.source!=="atlas.project/1"||
    current.source!=="atlas.project/1"||
    !Array.isArray(previous.projects)||!Array.isArray(current.projects))
  fail("ATLAS_PREVIEW_REQUIRED");
 const oldById=new Map(previous.projects.map(p=>[p.id,p]));
 const newIds=new Set(current.projects.map(p=>p.id));
 const out={previousRevision:previous.revision,revision:current.revision,
   sharedProjects:0,addedProjects:0,removedProjects:0,changedProjects:0,
   addedWorks:0,removedWorks:0,changedWorks:0,changedDependencies:0,
   revisionRelation:"unrelated",contentChanged:false};
 for(const p of current.projects){
  const old=oldById.get(p.id);
  if(!old){out.addedProjects++;out.addedWorks+=p.workItems.length;continue}
  out.sharedProjects++;
  if(["name","status","owner","dueDate","stages","total","done","blocked","progress"]
   .some(k=>old[k]!==p[k]))out.changedProjects++;
  const oldWorks=new Map(old.workItems.map(w=>[w.id,w]));
  const currentWorkIds=new Set(p.workItems.map(w=>w.id));
  for(const w of p.workItems){
   const prior=oldWorks.get(w.id);
   if(!prior){out.addedWorks++;continue}
   if(["title","state","dueDate","priority","assignee","resourceId","resourceLabel","allocationPct"].some(k=>prior[k]!==w[k]))out.changedWorks++;
  }
  for(const w of old.workItems)if(!currentWorkIds.has(w.id))out.removedWorks++;
 }
 for(const p of previous.projects)if(!newIds.has(p.id)){
  out.removedProjects++;out.removedWorks+=p.workItems.length;
 }
 const id=d=>JSON.stringify([d.from,d.to,d.kind]);
 const beforeLinks=new Set(previous.dependencies.map(id));
 const afterLinks=new Set(current.dependencies.map(id));
 out.changedDependencies=[...beforeLinks].filter(k=>!afterLinks.has(k)).length+
   [...afterLinks].filter(k=>!beforeLinks.has(k)).length;
 out.contentChanged=Boolean(out.addedProjects+out.removedProjects+out.changedProjects+
   out.addedWorks+out.removedWorks+out.changedWorks+out.changedDependencies);
 if(out.sharedProjects||(!previous.projects.length&&!current.projects.length)){
  const a=Number(previous.revision),b=Number(current.revision);
  out.revisionRelation=Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0
   ?b>a?"higher":b<a?"lower":"same":"unknown";
 }
 return out;
}


// Only a user-selected file or the original installed Atlas owner may
// validate an Atlas project/work reference. Center's own preparatory Atlas
// store has separate ownership, even though it shares the domain model.
export function selectAtlasReferenceSource(file,native,preferred='file'){
 const openedFile=file?.mode==='READ_ONLY_USER_SELECTED_FILE'&&
   file?.source==='atlas.project/1'?file:null;
 const installed=native?.mode==='NATIVE_ATLAS_PUBLIC_READ_ONLY'&&
   native?.source==='atlas.project/1'?native:null;
 return preferred==='native'?(installed??openedFile):(openedFile??installed);
}


// A refresh of the same source must not replace a removed selection with
// another project or Work. A deliberate first open or creation may select it.
/** @param {{projects:Array<{id:string,workItems:Array<{id:string}>}>}} view
 * @param {{projectId:string,workId:string}} previous
 * @param {{sameSource?:boolean,createdProjectId?:string,createdWorkId?:string}} [options] */
export function selectAtlasAfterRead(view,previous,{sameSource=false,createdProjectId='',createdWorkId=''}={}){
 const project=createdProjectId?view.projects.find(p=>p.id===createdProjectId):
  sameSource?view.projects.find(p=>p.id===previous.projectId):view.projects[0];
 if(!project)return {projectId:'',workId:''};
 const work=createdWorkId?project.workItems.find(w=>w.id===createdWorkId):
  sameSource&&project.id===previous.projectId?project.workItems.find(w=>w.id===previous.workId):
  project.workItems[0];
 return {projectId:project.id,workId:work?.id??''};
}


// Only the exact selected Work can seed an organizational draft. Atlas's
// free-text assignee and resource label are not employee identities.
/** @param {any} view
 * @param {{projectId:string,workId?:string,revision:string}} ref
 * @param {{participants:Array<{id:string}>,atlasResourceBindings?:Array<{resourceId:string,participantId:string}>}} organization */
export function prepareAtlasAssignmentFields(view,ref,organization){
 if(!ref?.workId)fail('ATLAS_WORK_NOT_IN_PREVIEW');
 const exact=linkableAtlasWork(view,ref.projectId,ref.workId);
 if(exact.revision!==ref.revision)fail('ATLAS_SOURCE_REVISION_CHANGED');
 const item=view.projects.find(p=>p.id===ref.projectId).workItems.find(w=>w.id===ref.workId);
 const resourceBinding=view.mode==='NATIVE_ATLAS_PUBLIC_READ_ONLY'&&item.resourceId
  ?organization.atlasResourceBindings?.find(row=>row.resourceId===item.resourceId):null;
 const assigneeId=resourceBinding&&organization.participants.some(p=>p.id===resourceBinding.participantId)
  ?resourceBinding.participantId:'';
 return {
  // Do not silently truncate the original Work title.
  title:item.title.length<=200?item.title:'',
  dueDate:item.dueDate||'',
  priority:['high','critical'].includes(item.priority)?'high':'normal',
  assigneeId,
  reviewerId:'',
  titleNeedsEdit:item.title.length>200
 };
}

// Bind a real selected resource of the installed owner, not a name or a
// resource identifier supplied independently by the UI.
export function atlasResourceForWork(view,ref){
 if(view?.mode!=='NATIVE_ATLAS_PUBLIC_READ_ONLY')fail('ATLAS_INSTALLED_SOURCE_REQUIRED');
 if(!ref?.workId||atlasWorkReadback(view,ref)!=='SOURCE_REVISION_MATCHES')
  fail('ATLAS_SOURCE_REVISION_CHANGED');
 const work=view.projects.find(p=>p.id===ref.projectId).workItems.find(w=>w.id===ref.workId);
 if(!work.resourceId)fail('ATLAS_WORK_RESOURCE_REQUIRED');
 return work.resourceId;
}
