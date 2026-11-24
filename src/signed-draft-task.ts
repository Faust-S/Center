// One shared manager-side draft projection. Both signing routes consume
// existing native authorities; this module creates no Task, grant, or Store.
import {readOriginalAppliedResult} from '../runtime/cen03-d3-owner.mjs';
export type SourceResultRef={organizationId:string;workspaceId:string;taskId:string;
 taskRevisionId:string;resultRevisionId:string;acceptanceId:string};
export type AssignmentDraft={id:string;title:string;workspaceId:string;assigneeId:string;
 editNumber:number;description:string;criteria:string;dueDate:string;
 sourceResultRef?:SourceResultRef|null;
 atlasRef:{projectId:string;revision:string;workId?:string}|null};
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<any>;
type Exec=(operation:string,input?:Record<string,unknown>)=>Promise<any>;
type Scope={organizationId:string;workspaceId:string;d3ApplyRecoverAvailable?:boolean};

export function draftTaskText(selected:AssignmentDraft){
 const atlas=selected.atlasRef;
 return [selected.title,selected.description,
   selected.criteria&&'Критерии приёмки: '+selected.criteria,
   selected.dueDate&&'Срок: '+selected.dueDate,
   atlas&&'Ссылка на проект Atlas (из черновика, не доказательство полномочий): '+
     atlas.projectId+' @ '+atlas.revision+(atlas.workId?', работа: '+atlas.workId:'')
 ].filter(Boolean).join('\n\n');
}

export async function verifyDraftSigningSources(draft:AssignmentDraft|undefined,
 session:Scope,invoke:Invoke,execute:Exec){
 if(!draft)return;
 if(draft.workspaceId!==session.workspaceId)
   throw Error('CEN_D3_DRAFT_CHANGED_BEFORE_SIGNING');
 const atlas=draft.atlasRef;
 if(atlas){
   const [{createNativeAtlasPort},{atlasLinkReadback,atlasWorkReadback}]=
     await Promise.all([import('./atlas-native.mjs'),import('./atlas-integration.mjs')])
       .catch(()=>{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');});
   const port=createNativeAtlasPort(invoke);
   let original;
   try{original=await port.openPublicAtlas(session.organizationId);}
   catch{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');}
   const fresh=port.view(original);
   const current=atlas.workId?atlasWorkReadback(fresh,atlas):atlasLinkReadback(fresh,atlas);
   if(current!=='SOURCE_REVISION_MATCHES')
     throw Error('CEN_D3_ATLAS_SOURCE_REVISION_STALE');
 }
 if(draft.sourceResultRef){
   if(session.d3ApplyRecoverAvailable!==true)
     throw Error('CEN_D3_REUSE_ORIGINAL_RESULT_NOT_CONFIRMED');
   await readOriginalAppliedResult(execute,session,draft.sourceResultRef);
 }
}
