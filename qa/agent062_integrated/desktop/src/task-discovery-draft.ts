/** Read-only projection of owner-admitted K03 evidence for an existing Task editor.
 * K03/P01 own source replay and selection; this module NEVER verifies source
 * truth, creates a Task, or infers human actions from sensor/time proximity.
 */
export type K03Observation={
 id:string;tag:string;text?:unknown;origin?:unknown;kind?:unknown;
 evidence_kind?:unknown;source_ref?:unknown;source_refs?:unknown;
 source_id?:unknown;source_sha256?:unknown;source_version?:unknown;
 source_epistemic?:unknown;locator?:unknown;time_from?:unknown;
 time_to?:unknown;time_basis?:unknown;relation?:unknown;
};
export type K03Hypothesis={
 id:string;text:string;tag?:string;status:string;independent_field_confirmation?:boolean;
 evidence_links?:Array<{evidence_id:string}>;
};
export type K03DiscoveryBinding={
 workspaceId:string;
 inputText:string;
 /** Asserted ONLY by P01 after its own K03 verifier and exact Workspace/input check. */
 verifiedForCurrentInput:true;
 bundle:{
  schema:string;route:string;accepted_task_count:number;
  source_verified?:boolean;independent_check?:{trace_check?:string};
  task_hypotheses?:K03Hypothesis[];
  activity_observations?:K03Observation[];
  clarification_requests?:Array<{question:string}>;
 };
};

export type EvidenceKind='observation'|'computed'|'inference'|'reported'|'unknown';
export type DiscoveryEvidence={
 id:string;kind:EvidenceKind;detail:string;sourceUrls:string[];
 sourceRefKnown:boolean;metadata:Array<{key:string;value:string}>;
};
export type DiscoveryCandidate={
 id:string;text:string;sources:string[];evidence:DiscoveryEvidence[];
 missingEvidence:boolean;independentHumanConfirmation:boolean;
};
export type DiscoveryView={candidates:DiscoveryCandidate[];question:string;fromK03:boolean};

const asText=(value:unknown):string=>typeof value==='string'?value.trim():'';
const cleanUrl=(value:unknown):string|null=>{
 const raw=asText(value);
 if(!raw||raw.length>2048)return null;
 try{
  const url=new URL(raw);
  return (url.protocol==='https:'&&url.username===''&&url.password==='')?url.href:null;
 }catch{return null;}
};
const asUrls=(row:K03Observation):string[]=>{
 const candidates=[row.source_ref,...(Array.isArray(row.source_refs)?row.source_refs:[])];
 return [...new Set(candidates.map(cleanUrl).filter((x):x is string=>!!x))].slice(0,8);
};
const COMPUTED_KINDS=new Set([
 'COMPUTED','COMPUTED_RELATION','COMPUTED_TEMPORAL_LINK',
 'TEMPORAL_ALIGNMENT','TEMPORAL_PROXIMITY','CROSS_SOURCE_ALIGNMENT',
 'CROSS_SOURCE_COMPUTED_RELATION',
]);

/** A source may assert an observation. It does not establish an actor or cause. */
export function classifyEvidence(row:K03Observation):EvidenceKind{
 const tag=asText(row.tag).toLowerCase();
 const kind=(asText(row.evidence_kind)||asText(row.kind)).toUpperCase();
 if(tag==='unknown'||tag==='unverified'||tag==='unsupported'||tag==='missing')return 'unknown';
 if(tag==='inferred'||tag==='inference'||tag==='hypothesis')return 'inference';
 if(tag==='computed'||COMPUTED_KINDS.has(kind))return 'computed';
 if(tag==='observed')return 'observation';
 if(tag==='reported')return 'reported';
 return 'unknown';
}
function metadata(row:K03Observation):Array<{key:string;value:string}>{
 const fields:[string,unknown][]=[
  ['source_id',row.source_id],['source_sha256',row.source_sha256],
  ['source_version',row.source_version],['source_epistemic',row.source_epistemic],
  ['origin',row.origin],['time_from',row.time_from],['time_to',row.time_to],
  ['time_basis',row.time_basis],['relation',row.relation],
  ['locator',row.locator],
 ];
 return fields.flatMap(([key,value])=>{
  if(value===undefined||value===null)return [];
  let text='';
  if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')text=String(value);
  else try{text=JSON.stringify(value);}catch{return [];}
  return text?[{key,value:text.slice(0,500)}]:[];
 });
}
function projectEvidence(row:K03Observation):DiscoveryEvidence{
 const kind=classifyEvidence(row),sourceUrls=asUrls(row);
 // K03's source marker is provenance, not independent confirmation.
 const sourceRefKnown=sourceUrls.length>0;
 const detail=asText(row.text).slice(0,250);
 return {id:row.id,kind,detail,sourceUrls,sourceRefKnown,metadata:metadata(row)};
}

/** View-only admission. P01 remains responsible for independent source replay.
 * For UNKNOWN observation we show uncertainty but do not offer it for staging.
 */
export function presentK03(binding:K03DiscoveryBinding|undefined,
 workspaceId:string,currentText:string):DiscoveryView{
 const empty:DiscoveryView={candidates:[],question:'',fromK03:false};
 if(!binding||binding.verifiedForCurrentInput!==true||
  !workspaceId||binding.workspaceId!==workspaceId||binding.inputText!==currentText)return empty;
 const b=binding.bundle;
 const desk=b?.schema==='IWXA_K03_DISCOVERY/0.1.0'
  &&b.independent_check?.trace_check==='PASS_REPLAYED_AGAINST_PINNED_SOURCE';
 const issue=b?.schema==='IWXA_K03_PUBLIC_ISSUE_DISCOVERY/0.1.0'
  &&b.source_verified===true;
 if((!desk&&!issue)||b.accepted_task_count!==0)return empty;
 const question=Array.isArray(b.clarification_requests)?
  asText(b.clarification_requests.find(q=>asText(q?.question))?.question).slice(0,1200):'';
 if(b.route==='CLARIFICATION_REQUIRED')return {candidates:[],question,fromK03:true};
 if(b.route!=='QUALIFICATION_REQUIRED'||!Array.isArray(b.task_hypotheses)
  ||!Array.isArray(b.activity_observations))return empty;
 // Upper bounds prevent rendering an unbounded research corpus in the Task UI.
 if(b.task_hypotheses.length>32||b.activity_observations.length>256)return empty;
 const index=new Map<string,K03Observation>();
 for(const obs of b.activity_observations){
  if(!obs||obs.tag==='target'||typeof obs.id!=='string'||!obs.id||index.has(obs.id))continue;
  index.set(obs.id,obs);
 }
 const candidates:DiscoveryCandidate[]=[];
 const seen=new Set<string>();
 for(const h of b.task_hypotheses){
  if(!h||typeof h.id!=='string'||!h.id||seen.has(h.id)
   ||typeof h.text!=='string'||!h.text.trim()
   ||h.status!=='PROPOSED_NOT_QUALIFIED_TASK'
   ||h.tag&&h.tag!=='inferred'
   ||!Array.isArray(h.evidence_links)||!h.evidence_links.length||h.evidence_links.length>32)continue;
  const ids=h.evidence_links.map(x=>x?.evidence_id);
  // Missing link is never replaced with an invented observation.
  if(ids.some(id=>typeof id!=='string'||!index.has(id))||new Set(ids).size!==ids.length)continue;
  const evidence=ids.map(id=>projectEvidence(index.get(id)!));
  const missingEvidence=evidence.some(e=>e.kind==='unknown'||!e.sourceRefKnown);
  candidates.push({id:h.id,text:h.text.slice(0,8000),
   sources:[...new Set(evidence.flatMap(e=>e.sourceUrls))],evidence,missingEvidence,
   independentHumanConfirmation:h.independent_field_confirmation===true});
  seen.add(h.id);
 }
 return {candidates,question,fromK03:true};
}

/** The local, manual fallback supplements the existing draft without replacing
 * its original bytes; the usual Core composer autosave owns persistence. */
export function appendTaskClarification(currentText:string,hypothesis:string,
 expectedResult:string,language:'ru'|'en'):string{
 const extra:string[]=[];
 if(hypothesis.trim())extra.push(language==='ru'
  ?'Возможная задача (требует уточнения): '+hypothesis.trim()
  :'Possible task (needs clarification): '+hypothesis.trim());
 if(expectedResult.trim())extra.push(language==='ru'
  ?'Ожидаемый проверяемый результат: '+expectedResult.trim()
  :'Expected verifiable result: '+expectedResult.trim());
 if(!extra.length)return currentText;
 return currentText+(currentText?(currentText.endsWith('\n')?'\n':'\n\n'):'')+extra.join('\n\n');
}
