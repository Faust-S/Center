// Ephemeral D2 management view over the ORIGINAL signed T3 + original T2.
// Neither this file nor React creates an Index, IAM, Store, Knowledge Graph,
// Kernel or authoritative Result. Never copy Object.data or Event.payload.
import {signedD3SessionFingerprint} from '../runtime/cen03-review.mjs';
import {managerSignedInboxArgs} from './manager-owner-context.mjs';
import {managerSearchRow} from './manager-context.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const fail=code=>{throw Error(code);};
const need=(yes,code)=>{if(!yes)fail(code);};
const same=(a,b)=>a===b;
// Native T3 failures can arrive as Error, Tauri string or typed error.
// Expose ONLY one bounded uppercase machine code to the user and Windows UIA,
// never exception messages, stack traces, file paths or source material.
const SAFE_SOURCE_CODE=/^(?:CEN_D2|CEN_D3|T3_D1|T3_D2|T3_D3|T3_OWNER|T3_SUBJECT|T3_ACCESS|T3_KERNEL|T3_HOST|WORKSPACE|SOURCE|OPERATION)_[A-Z0-9_]{4,90}$/;
export function managerActivityFailureCode(error){
 const raw=typeof error==='string'?error:
   typeof error?.code==='string'?error.code:
   typeof error?.message==='string'?error.message:'';
 const code=raw.startsWith('Error: ')?raw.slice(7):raw;
 return SAFE_SOURCE_CODE.test(code)?code:'CEN_D2_SOURCE_READ_FAILED';
}
export function managerActivityArgs(view,organizationId){
 need(signedD3SessionFingerprint(view,organizationId)!==null&&
   view?.snapshot?.d2ActivityReaderConnected===true,
   'CEN_D2_ORIGINAL_SIGNED_READER_REQUIRED');
 return {...managerSignedInboxArgs(view,organizationId),
   operation:'d2ActivityReadback'};
}
export function managerActivityMatchesSignedOwner(activity,owner){
 return !!(activity&&owner&&
   owner.status==='SIGNED_D3_READBACK'&&
   activity.organizationId===owner.organizationId&&
   activity.workspaceId===owner.workspaceId&&
   activity.actorId===owner.actorId&&
   activity.contextId===owner.contextId&&
   activity.contextEpoch===owner.contextEpoch);
}
export function readManagerActivity(view,organizationId,original){
 need(signedD3SessionFingerprint(view,organizationId)!==null&&
   view?.snapshot?.d2ActivityReaderConnected===true,
   'CEN_D2_ORIGINAL_SIGNED_READER_REQUIRED');
 const s=view.snapshot,v=original?.view;
 need(original?.schema==='IWXA_T3_ORIGINAL_ADMIN_ACTIVITY_READBACK/1'&&
   original.organizationId===organizationId&&
   same(original.workspaceId,s.workspaceId)&&
   same(original.actorId,s.actorId)&&
   original.source==='ORIGINAL_T2_KERNEL_D1_ACTIVITY_DATA'&&
   original.evidenceScope==='METADATA_ONLY_NOT_BUSINESS_COMPLETION_PROOF'&&
   v?.workspace_id===s.workspaceId&&
   Array.isArray(v.nodes)&&v.nodes.length<=256&&
   Array.isArray(v.events)&&v.events.length<=2000&&
   Array.isArray(v.relations)&&v.relations.length<=10000&&
   Array.isArray(v.unresolved)&&v.unresolved.length<=10000&&
   Array.isArray(v.unmapped?.object_ids)&&
   Array.isArray(v.unmapped?.event_ids)&&
   Array.isArray(v.unmapped?.relation_ids)&&
   v.unmapped.object_ids.length<=256&&
   v.unmapped.event_ids.length<=2000&&
   v.unmapped.relation_ids.length<=10000,
   'CEN_D2_ORIGINAL_ACTIVITY_INVALID');
 const uniq=new Set(),entries=[];
 for(const node of v.nodes){
   need(node&&ID.test(node.object_id)&&
     typeof node.schema_id==='string'&&ID.test(node.schema_id)&&
     typeof node.schema_version==='string'&&node.schema_version.length<=40&&
     ['Result','Evidence','Entity','Activity','State','Process','Decision','Observation'].includes(node.semantic_kind)&&
     Number.isSafeInteger(node.revision)&&node.revision>=1,
     'CEN_D2_ORIGINAL_OBJECT_INVALID');
   const id='object:'+node.object_id;need(!uniq.has(id),'CEN_D2_ORIGINAL_SOURCE_DUPLICATE');uniq.add(id);
   entries.push({...managerSearchRow('d2-object',node.object_id,
     'Объект Kernel · '+node.object_id,
     'Редакция '+node.revision+'. Тип '+node.schema_id+
       '. Запись в Kernel не доказывает хозяйственное исполнение.',
     'Оригинальный T2 Kernel / подписанное DATA activity.read',
     [node.schema_id,node.schema_version,node.semantic_kind].join(' ')),
     revision:node.revision,schemaId:node.schema_id,semanticKind:node.semantic_kind});
 }
 for(const event of v.events){
   need(event&&ID.test(event.event_id)&&ID.test(event.event_type)&&
     event.semantic_kind==='Event'&&
     ['observed','reported','declared','inferred','proposed'].includes(event.epistemic_status)&&
     typeof event.occurred_at==='string'&&
     Number.isFinite(Date.parse(event.occurred_at))&&
     (event.object_ref==null||
       (ID.test(event.object_ref.object_id)&&Number.isSafeInteger(event.object_ref.revision)&&
        event.object_ref.revision>0)),
     'CEN_D2_ORIGINAL_EVENT_INVALID');
   const id='event:'+event.event_id;need(!uniq.has(id),'CEN_D2_ORIGINAL_SOURCE_DUPLICATE');uniq.add(id);
   entries.push({...managerSearchRow('d2-event',event.event_id,
     'Событие Kernel · '+event.event_type,
     'Записано: '+event.occurred_at+'. Статус источника: '+event.epistemic_status+
     '. Это не доказательство выполнения внешнего действия.',
     'Оригинальный T2 Kernel / подписанное DATA activity.read',
     [event.event_type,event.object_ref?.object_id].filter(Boolean).join(' ')),
     eventType:event.event_type,occurredAt:event.occurred_at,
     epistemicStatus:event.epistemic_status,
     objectRef:event.object_ref??null});
 }
 for(const rel of v.relations){
   need(rel&&ID.test(rel.source_id)&&ID.test(rel.target_id)&&
     typeof rel.relation==='string'&&ID.test(rel.relation)&&
     (!rel.relation_id||ID.test(rel.relation_id)),
     'CEN_D2_ORIGINAL_RELATION_INVALID');
 }
 for(const item of v.unresolved){
   need(item&&typeof item.source_id==='string'&&
     item.source_id.length<=160&&typeof item.reason==='string'&&
     item.reason.length<=80,'CEN_D2_ORIGINAL_UNRESOLVED_INVALID');
 }
 return Object.freeze({
   status:'ORIGINAL_T2_D2_METADATA',organizationId,workspaceId:s.workspaceId,
   actorId:s.actorId,contextId:s.contextId,contextEpoch:s.contextEpoch,
   counts:{objects:v.nodes.length,events:v.events.length,
     relations:v.relations.length,unresolved:v.unresolved.length,
     unmappedObjects:v.unmapped.object_ids.length,
     unmappedEvents:v.unmapped.event_ids.length,
     unmappedRelations:v.unmapped.relation_ids.length},
   entries,
   scope:'Только метаданные исходного T2 Kernel; DATA право подписано в оригинальном T3. Не доказательство бизнес-исполнения.',
 });
}
