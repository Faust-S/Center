/** A historical file-write receipt and a live file readback are different evidence.
 * The Core owns both observations. This helper only interprets their verified
 * projection for the desktop UI; it never grants write authority.
 */
export type DocumentReadbackOutcome = 'CURRENT_VERIFIED'|'HISTORY_ONLY';
type Row = Record<string,unknown>;
const row = (value:unknown):Row => value!==null&&typeof value==='object'&&!Array.isArray(value)
 ? value as Row:{};
const digest = (value:unknown):value is string => typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

/** A freshly authenticated Core does not revive document write actions until
 * the editor's exact saved revision and Task/Workspace have been re-admitted.
 * Read-only history and receipt inspection remain available independently.
 */
export function documentMutationReady(
 historyReady:boolean,editorRequired:boolean,editorLoaded:boolean,
 reconnectState:'idle'|'checking'|'conflict'|'unavailable',
 admittedSession:number,currentSession:number,
):boolean{
 return historyReady&&(!editorRequired||
  (editorLoaded&&reconnectState==='idle'&&admittedSession===currentSession));
}

export function documentReadbackOutcome(value:unknown,taskId:string,receiptId:string):DocumentReadbackOutcome{
 const saved=row(value);
 if(saved.task_id!==taskId||saved.receipt_id!==receiptId||!digest(saved.sha256)
   ||typeof saved.path!=='string'||!saved.path||typeof saved.text!=='string'
   ||saved.read_only!==true||saved.receipt_confirmed!==true)
  throw Error('saved_document_receipt_identity_mismatch');
 if(saved.current_state==='MATCHES_APPROVED'){
  if(saved.matches_approved_text!==true||saved.current_sha256!==saved.sha256)
   throw Error('saved_document_current_readback_inconsistent');
  return 'CURRENT_VERIFIED';
 }
 if(!['MODIFIED','NOT_FOUND','UNAVAILABLE','WORKSPACE_CHANGED','WORKSPACE_UNAVAILABLE'].includes(String(saved.current_state))
   ||saved.matches_approved_text!==false)
  throw Error('saved_document_current_readback_inconsistent');
 return 'HISTORY_ONLY';
}


/** Verify a Core-owned, read-only draft projection before restoring it or
 * treating a persisted edit as acknowledged. This does not create storage,
 * change a file or derive a new draft digest.
 */

/** Ephemeral consent for the exact editable document. This is not a
 * ToolRuntime approval and is never persisted or exported.
 */
export function documentEditorConsentKey(taskId:string,value:{
 active:boolean;path:string;mode:'create'|'replace';text:string;expected_sha256:string|null;
}):string|null{
 if(!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(taskId)||value.active!==true
    ||typeof value.path!=='string'||typeof value.text!=='string'
    ||!['create','replace'].includes(value.mode)
    ||value.text.trim().length===0
    ||new TextEncoder().encode(value.text).length>128*1024
    ||(value.mode==='create'&&value.expected_sha256!==null)
    ||(value.mode==='replace'&&!digest(value.expected_sha256)))return null;
 return JSON.stringify([taskId,value.path,value.mode,value.text,value.expected_sha256]);
}

export function documentEditorReadbackMatches(value:unknown,sourceTaskId:string):boolean{
 const v=row(value);
 if(!sourceTaskId||v.source_task_id!==sourceTaskId||v.read_only!==true||!digest(v.draft_digest)
   ||typeof v.active!=='boolean'||!['create','replace'].includes(String(v.mode))
   ||typeof v.text!=='string'||new TextEncoder().encode(v.text).length>128*1024
   ||typeof v.path!=='string'||v.path.length>160||v.path!==v.path.normalize('NFC')
   ||/[\u0000-\u001f]/.test(v.path)
   ||(v.expected_sha256!==null&&!digest(v.expected_sha256)))return false;
 if(v.active===true)return v.state==='SAVED'
  &&(v.mode==='replace'||v.expected_sha256===null);
 return v.state==='EMPTY'&&v.mode==='create'&&v.path==='action-plan.md'
  &&v.text===''&&v.expected_sha256===null;
}


/** UI only: a historical Task navigation link must come from a verified
 * Core projection, not from mutable React state or a guessed Task ID.
 */
export function verifiedDocumentOrigin(value:unknown,documentTaskId:string):string|null{
 const v=row(value);
 if(v.verified!==true||v.read_only!==true||v.document_task_id!==documentTaskId
  ||typeof v.source_task_id!=='string'
  ||!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(v.source_task_id)
  ||v.source_task_id===documentTaskId
  ||typeof v.target_path!=='string'||!v.target_path
  ||!['create','replace'].includes(String(v.write_mode)))return null;
 return v.source_task_id;
}

/** A lost approval reply can be reconciled only against the exact,
 * immutable plan digest and Core-verified approval record. This only reads
 * existing authority and NEVER grants permission to execute a write.
 *
 * Without an ACK we require an approval ID absent from the pre-dispatch
 * readback. Historical approvals must not masquerade as a new decision.
 */
export function verifiedPlanApproval(
  planId:string,planDigest:string,decision:'approve'|'reject',
  approvals:unknown,priorIds:readonly string[],ackId:string|null,
):string|null{
 if(!planId||!digest(planDigest)||!Array.isArray(approvals)
    ||!Array.isArray(priorIds)||(ackId!==null&&!/^TEAPR-[0-9a-f]{18}$/.test(ackId)))
  return null;
 const matched=approvals.map(row).filter(record=>{
  const ref=row(record.plan_ref),id=record.approval_id;
  if(typeof id!=='string'||!/^TEAPR-[0-9a-f]{18}$/.test(id)
    ||!digest(record.approval_digest)||record.plan_id!==planId
    ||ref.kind!=='tool_execution_plan'||ref.ref_id!==planId
    ||ref.digest_sha256!==planDigest||record.binding_valid!==true
    ||(ackId!==null&&id!==ackId)||record.decision!==decision)return false;
  return decision==='approve'
   ?record.state==='APPROVED'&&record.active===true
   :record.state==='REJECTED'&&record.active===false;
 });
 if(matched.length!==1)return null;
 const id=matched[0].approval_id as string;
 return ackId===null&&priorIds.includes(id)?null:id;
}



/** Read-only UI preflight. This never creates approval authority:
 * ToolRuntime remains the final execution gate. It prevents a previously
 * displayed approval/plan from being dispatched after an asynchronous delay.
 */
export function verifiedDocumentExecutionAdmission(
 value:unknown,taskId:string,planId:string,planDigest:string,approvalId:string,
 nowMs:number=Date.now()
):boolean{
 if(!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(taskId)
   ||!/^TPLAN-[A-Za-z0-9_-]{1,100}$/.test(planId)
   ||!/^TEAPR-[0-9a-f]{18}$/.test(approvalId)
   ||!digest(planDigest)||!Number.isFinite(nowMs))return false;
 const snapshot=row(value);
 if(snapshot.task_id!==taskId||snapshot.read_only!==true
   ||!Array.isArray(snapshot.plans)||!Array.isArray(snapshot.approvals))return false;
 const plans=snapshot.plans.map(row).filter(p=>p.plan_id===planId);
 if(plans.length!==1)return false;
 const plan=plans[0];
 const expiry=typeof plan.expires_at==='string'?Date.parse(plan.expires_at):NaN;
 if(plan.plan_digest!==planDigest||plan.tool_id!=='files.write_text'
   ||row(plan.task_ref).ref_id!==taskId||!Number.isFinite(expiry)||expiry<=nowMs)
  return false;
 if(row(row(snapshot.execution_by_plan)[planId]).state!=='NOT_STARTED')return false;
 const related=snapshot.approvals.map(row).filter(a=>
  a.plan_id===planId||row(a.plan_ref).ref_id===planId);
 if(related.some(a=>a.decision==='reject'||a.state==='REJECTED'))return false;
 const active=related.filter(a=>{
  const ref=row(a.plan_ref);
  const expires=typeof a.expires_at==='string'?Date.parse(a.expires_at):NaN;
  return a.decision==='approve'&&a.state==='APPROVED'
   &&a.active===true&&a.binding_valid===true
   &&ref.kind==='tool_execution_plan'&&ref.ref_id===planId
   &&ref.digest_sha256===planDigest
   &&Number.isFinite(expires)&&expires>nowMs;
 });
 return active.length===1&&active[0].approval_id===approvalId;
}

/** User-facing document journey, derived entirely from existing verified Task
 * and ToolRuntime projections. Never interpret a receipt as live file proof.
 * This is presentation state; it owns no authority, history or execution.
 */
export type DocumentJourneyStatus=
 'UNVERIFIED'|'ANALYSIS_ACCEPTED'|'CANDIDATE_REVIEW'|'PREPARE_PLAN'|
 'REVIEW_PLAN'|'READY_TO_WRITE'|'PLAN_EXPIRED'|'PLAN_REJECTED'|
 'OUTCOME_UNKNOWN'|'VERIFY_FILE'|'LIVE_VERIFIED'|'HISTORY_ONLY'|'NO_ACTION';
export type DocumentJourney={status:DocumentJourneyStatus;receiptId:string|null};
export function documentJourneyState(input:{
 taskId:string;verified:boolean;historyReady:boolean;
 acceptedSource:boolean;candidatePresent:boolean;candidateAccepted:boolean;
 plans:unknown;approvals:unknown;executionByPlan:unknown;saved:unknown;
}):DocumentJourney{
 const done=(status:DocumentJourneyStatus,receiptId:string|null=null):DocumentJourney=>({status,receiptId});
 if(!input.taskId||!input.verified||!input.historyReady)return done('UNVERIFIED');
 if(!Array.isArray(input.plans)||!Array.isArray(input.approvals))
  return done('UNVERIFIED');
 const plans=input.plans.map(row).filter(plan=>
  plan.tool_id==='files.write_text'&&row(plan.task_ref).ref_id===input.taskId);
 const states=row(input.executionByPlan);
 // An unresolved file effect takes precedence over any historical success
 // or a second candidate: no UI state may recommend replaying the write.
 if(plans.some(plan=>['OUTCOME_UNKNOWN','ATTEMPTED'].includes(String(row(states[String(plan.plan_id)]).state))))
  return done('OUTCOME_UNKNOWN');
 // A newer pending revision supersedes the display of an older successful
 // receipt. Do not call old success "current document verified" for a new plan.
 const sorted=plans.sort((a,b)=>(Date.parse(String(b.prepared_at))||0)-
   (Date.parse(String(a.prepared_at))||0)||String(b.plan_id).localeCompare(String(a.plan_id)));
 const selected=sorted[0];
 if(selected&&(!digest(selected.plan_digest)||typeof selected.plan_id!=='string'))
  return done('UNVERIFIED');
 if(selected&&row(states[String(selected.plan_id)]).state==='SUCCEEDED'){
  const receiptId=row(states[String(selected.plan_id)]).receipt_id;
  if(typeof receiptId!=='string'||!receiptId)return done('VERIFY_FILE');
  const saved=row(input.saved);
  if(saved.receipt_id!==receiptId||saved.task_id!==input.taskId)return done('VERIFY_FILE',receiptId);
  try{
   return done(documentReadbackOutcome(saved,input.taskId,receiptId)==='CURRENT_VERIFIED'
    ?'LIVE_VERIFIED':'HISTORY_ONLY',receiptId);
  }catch{return done('VERIFY_FILE',receiptId)}
 }
 if(selected){
  // Core plans are immutable and have an explicit expiry. An absent or
  // malformed expiry cannot be presented as valid write authority.
  const execution=row(states[String(selected.plan_id)]);
  if(execution.state!=='NOT_STARTED')return done('UNVERIFIED');
  const expiry=typeof selected.expires_at==='string'?Date.parse(selected.expires_at):NaN;
  if(!Number.isFinite(expiry))return done('UNVERIFIED');
  const related=input.approvals.map(row).filter(approval=>
   approval.plan_id===selected.plan_id||row(approval.plan_ref).ref_id===selected.plan_id);
  if(related.some(approval=>approval.decision==='reject'||approval.state==='REJECTED'))
   return done('PLAN_REJECTED');
  if(expiry<=Date.now())return done('PLAN_EXPIRED');
  const approved=related.some(approval=>{
   const ref=row(approval.plan_ref);
   const expires=typeof approval.expires_at==='string'?Date.parse(approval.expires_at):NaN;
   return approval.decision==='approve'&&approval.state==='APPROVED'
    &&approval.active===true&&approval.binding_valid===true
    &&ref.kind==='tool_execution_plan'&&ref.ref_id===selected.plan_id
    &&ref.digest_sha256===selected.plan_digest
    &&Number.isFinite(expires)&&expires>Date.now();
  });
  return done(approved?'READY_TO_WRITE':'REVIEW_PLAN');
 }
 if(input.candidateAccepted)return done('PREPARE_PLAN');
 if(input.candidatePresent)return done('CANDIDATE_REVIEW');
 if(input.acceptedSource)return done('ANALYSIS_ACCEPTED');
 return done('NO_ACTION');
}

/** Presentation only: acceptance of another action does not accept this
 * file-write candidate. Human Review and ToolRuntime still own authority.
 */
export function documentWriteCandidateProgress(task:unknown):{present:boolean;accepted:boolean}{
 const value=row(task);
 const candidates=Array.isArray(value.action_candidates)?value.action_candidates.map(row):[];
 const acceptedIds=Array.isArray(value.accepted_action_candidate_ids)?
  value.accepted_action_candidate_ids:[];
 const writes=candidates.filter(candidate=>candidate.operation==='files.write_text');
 return {present:writes.length>0,
  accepted:value.status==='closed'&&writes.some(candidate=>{
   const id=candidate.candidate_id??candidate.ref_id;
   return typeof id==='string'&&id.length>0&&acceptedIds.includes(id);
  })};
}

/** UI-only guard for actions linked to a saved Task. A Task ID alone does not
 * establish Workspace membership: callers must also perform the existing
 * Core-backed active-Workspace admission before relying on this comparison.
 */
export function documentActionTaskMatches(
 taskId:string,kind:'draft'|'write',displayed:unknown,current:unknown,candidateId?:string
):boolean{
 const shown=row(displayed),fresh=row(current);
 if(!/^TASK-[A-Za-z0-9_-]{1,120}$/.test(taskId)||shown.task_id!==taskId||fresh.task_id!==taskId
    ||shown.status!=='closed'||fresh.status!=='closed'
    ||typeof shown.run_seq!=='number'||!Number.isSafeInteger(shown.run_seq)||shown.run_seq<1
    ||fresh.run_seq!==shown.run_seq||!digest(shown.accepted_artifact_digest)
    ||fresh.accepted_artifact_digest!==shown.accepted_artifact_digest)return false;
 const same=['objective','summary','claims','uncertainties','draft_artifacts','provider',
  'local_document_mode','action_candidates','accepted_action_candidate_ids'];
 if(!same.every(key=>JSON.stringify(shown[key]??null)===JSON.stringify(fresh[key]??null)))
  return false;
 if(kind==='draft')return !candidateId&&shown.local_document_mode===true
  &&['OLLAMA_LOCAL_V1','IWXA_BASIC_RUNTIME_V1'].includes(String(row(shown.provider).id));
 if(kind!=='write'||typeof candidateId!=='string'||!candidateId)return false;
 const accepted=shown.accepted_action_candidate_ids,proposed=shown.action_candidates;
 if(!Array.isArray(accepted)||!Array.isArray(proposed)
    ||accepted.some(id=>typeof id!=='string'||!id)
    ||new Set(accepted).size!==accepted.length||!accepted.includes(candidateId))
  return false;
 const ids=proposed.map(item=>{const value=row(item);return value.candidate_id??value.ref_id;});
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)return false;
 const selected=proposed.map(row).find(item=>(item.candidate_id??item.ref_id)===candidateId);
 const args=row(selected?.arguments);
 // Action candidates use operation; tool_id belongs to the ToolRuntime plan.
 // Bind the accepted candidate to the exact Personal Files write payload.
 return !!selected&&selected.operation==='files.write_text'
  &&args.root_id==='personal'&&typeof args.path==='string'
  &&args.path.length>0&&selected.target===args.path
  &&(args.mode==='create'||args.mode==='replace')
  &&typeof args.text==='string'&&!!args.text.trim()
  &&(args.mode==='create'
   ?args.expected_sha256===undefined||args.expected_sha256===null
   :digest(args.expected_sha256));
}


/** Convert one *Core-extracted text window* to the existing Task attachment
 * contract. This is presentation of source evidence, not a new document
 * registry, analysis engine, or file authority.
 */
export function documentTextAttachment(value:unknown):
 {name:string;text:string;sourcePath:string}|null{
 const source=row(value);
 const path=source.path,sha=source.sha256,content=source.text;
 const offset=source.offset_chars,total=source.total_chars;
 // Python text_window offsets are Unicode code points, not JS UTF-16 units.
 const contentChars=typeof content==='string'?Array.from(content).length:0;
 if(typeof path!=='string'||!path||path.length>2048||!digest(sha)
    ||typeof content!=='string'||!content.trim()
    ||typeof offset!=='number'||typeof total!=='number'
    ||!Number.isSafeInteger(offset)||offset<0
    ||!Number.isSafeInteger(total)||total<offset+contentChars
    ||typeof source.format!=='string'
    ||typeof source.text_bytes!=='number'
    ||new TextEncoder().encode(content).length!==source.text_bytes)return null;
 const originalName=path.split('/').pop()||'';
 const match=/\.(txt|md|markdown|csv|json|pdf|docx|xlsx|pptx)$/i.exec(originalName);
 if(!match)return null;
 const ext=match[1].toLowerCase();
 // The existing file reader is the only source of Office projections.
 // Never relabel an unrelated read as a workbook or presentation.
 if((ext==='xlsx'||ext==='pptx')&&source.format.toLowerCase()!==ext)return null;
 const converted=['pdf','docx','xlsx','pptx'].includes(ext);
 const suffix=converted?'.'+ext+'.txt':ext==='markdown'?'.md':'.'+ext;
 let stem=originalName.slice(0,-match[0].length).normalize('NFC')
  .replace(/[^\p{L}\p{N}_ .()-]/gu,'_')
  .replace(/\.{2,}/g,'.').trim().replace(/[. ]+$/g,'');
 if(!stem)stem='document';
 if(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem))stem='document-'+stem;
 const name=stem.slice(0,120-suffix.length).replace(/[. ]+$/g,'')+suffix;
 const partial=offset>0||offset+contentChars<total;
 const missingPdfPages=ext==='pdf'&&typeof source.missing_pdf_pages==='number'
  &&Number.isSafeInteger(source.missing_pdf_pages)&&source.missing_pdf_pages>0
  ?source.missing_pdf_pages:0;
 const header=[
  'Source: '+path,
  'Source SHA-256: '+sha,
  'Source format: '+ext.toUpperCase(),
  'Text characters: '+(offset+1)+'-'+(offset+contentChars)+' / '+total,
  'Scope: '+(partial?'EXCERPT_ONLY':'EXTRACTED_TEXT'),
  ...(ext==='xlsx'?[
   'Projection limits: raw cells; formulas not evaluated and date formatting not applied.',
  ]:[]),
  ...(ext==='pptx'?[
   'Projection limits: slide text only; charts, notes and images not interpreted.',
  ]:[]),
  ...(missingPdfPages>0?[
   'PDF text coverage warning: '+missingPdfPages+
   ' page(s) have no extractable text (blank/scanned; OCR unavailable).',
   'Do not treat those pages as analyzed content.'
  ]:[]),
 ].join('\n')+'\n\n';
 const text=header+content;
 if(new TextEncoder().encode(text).length>48000)return null;
 return {name,text,sourcePath:path};
}


/** Convert a freshly read *whole* document to one existing Task attachment.
 * Unlike a preview window, this must never silently forward a partial text.
 */
export function wholeDocumentTextAttachment(
 observed:unknown,opened:unknown
):{name:string;text:string;sourcePath:string}|null{
 const source=row(observed),current=row(opened);
 const text=source.text;
 if(typeof text!=='string'||source.root_id!=='personal'||current.root_id!=='personal'
    ||source.path!==current.path||!digest(source.sha256)
    ||source.sha256!==current.sha256||source.format!==current.format
    ||source.offset_chars!==0||source.next_offset_chars!==null
    ||source.partial!==false||!Number.isSafeInteger(source.total_chars)
    ||source.total_chars!==Array.from(text).length)return null;
 return documentTextAttachment(source);
}


/** Exact back-navigation for existing file text windows. Holds only offsets,
 * never content; Core remains the reader for all document pages.
 */
export function documentHistoryAfterRead(
 previous:unknown,current:unknown,history:readonly number[],
 direction:'next'|'back'|'jump'
):number[]{
 const old=row(previous),fresh=row(current);
 const oldOffset=old.offset_chars,newOffset=fresh.offset_chars;
 // Validate types before numeric comparisons; isSafeInteger does not narrow unknown.
 if(typeof oldOffset!=='number'||typeof newOffset!=='number')return [];
 const same=old.root_id==='personal'&&fresh.root_id==='personal'
  &&typeof old.path==='string'&&old.path===fresh.path
  &&digest(old.sha256)&&old.sha256===fresh.sha256
  &&Number.isSafeInteger(oldOffset)&&Number.isSafeInteger(newOffset)
  &&(oldOffset as number)>=0&&(newOffset as number)>=0
  &&Array.isArray(history)&&history.every(value=>Number.isSafeInteger(value)&&value>=0);
 if(!same)return [];
 if(direction==='next'&&old.next_offset_chars===newOffset&&newOffset>oldOffset)
  return [...history,oldOffset as number];
 if(direction==='back'&&history[history.length-1]===newOffset&&newOffset<oldOffset)
  return history.slice(0,-1);
 return [];
}
