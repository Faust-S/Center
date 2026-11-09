// Read-only projection over the ONE Atlas domain model. The canonical source
// is a pinned public Atlas checkout bundled by Vite at build time.
// This is neither an organisational authorization nor a second project store.
import {deserialize, summary} from '../vendor/atlas/src/core.mjs';
import {portfolioNetwork} from '../vendor/atlas/src/portfolio.mjs';

export const ATLAS_SOURCE_REVISION = '0de3b6058526021aeecee6f445acf89b956d10c9';
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
          dueDate: i.dueDate || '', priority: i.priority
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
   if(["title","state","dueDate","priority"].some(k=>prior[k]!==w[k]))out.changedWorks++;
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
