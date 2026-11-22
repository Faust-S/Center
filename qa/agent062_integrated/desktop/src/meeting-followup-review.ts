/** Evidence-only check of the existing meeting Graph result.
 * Recomputed from persisted graph config + committed Graph readback on every reopen.
 * Exact quotations can be checked mechanically; task meaning remains human review.
 */
export type MeetingReviewStatus='PENDING'|'VERIFIED_QUOTES'|'REVIEW_REQUIRED';
export type MeetingAssignment={action:string;assignee:string;due_date:string;quote:string};
export type MeetingReview={status:MeetingReviewStatus;items:number;checked:number;issues:string[];questions:string[];assignments?:MeetingAssignment[]};
export type MeetingStep={node_id:string;node_type:string;depends_on?:string[];operation?:string;text:string;system?:string};
type Obj=Record<string,unknown>;
const object=(x:unknown):x is Obj=>typeof x==='object'&&x!==null&&!Array.isArray(x);
const text=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0;
const pending=():MeetingReview=>({status:'PENDING',items:0,checked:0,issues:[],questions:[]});
const problem=(code:string):MeetingReview=>({status:'REVIEW_REQUIRED',items:0,checked:0,issues:[code],questions:[]});

/** Recognize the exact existing Task starter without classifying arbitrary user documents. */
export function meetingTranscriptFromTask(value:string):string|null {
 const marker=value.startsWith('Разбери протокол совещания и подготовь черновик поручений.')
  ?'\n\nПротокол:\n'
  :value.startsWith('Review the meeting transcript and draft action items.')
   ?'\n\nTranscript:\n':null;
 if(!marker)return null;
 const at=value.indexOf(marker);
 return at<0?null:value.slice(at+marker.length).trim();
}

/** Show an already saved Task's action-item JSON without starting another model.
 * Natural-language summaries are left to the existing Task view, not labelled invalid.
 */
export function reviewMeetingTaskSummary(objective:string,summary:string,draftArtifacts:unknown=null):MeetingReview|null {
 const transcript=meetingTranscriptFromTask(objective);
 if(!transcript?.trim())return null;
 // Core 0.5 stores model JSON within draft_artifacts, while summary is prose.
 // Prefer the existing saved structured draft; no additional model call.
 const candidates=[
  ...(Array.isArray(draftArtifacts)?draftArtifacts.filter((x):x is string=>typeof x==='string'):[]),
  summary,
 ];
 for(const candidate of candidates){
  if(!text(candidate))continue;
  const trimmed=candidate.trim();
  if(!trimmed.startsWith('{')&&!/^```(?:json)?[ \t]*\r?\n/i.test(trimmed))continue;
  const fence=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  let parsed:unknown;
  try{parsed=JSON.parse(fence?fence[1]:trimmed)}catch{
   // Show malformed meeting drafts as review issues, but skip unrelated artifacts.
   if(/"(?:action_items|open_questions)"\s*:/.test(trimmed))
    return verifyMeetingDraft(transcript,candidate);
   continue;
  }
  if(object(parsed)&&('action_items' in parsed||'open_questions' in parsed))
   return verifyMeetingDraft(transcript,candidate);
 }
 return null;
}

export function verifyMeetingDraft(transcript:string,raw:string,truncated=false,requireK04=false):MeetingReview {
 if(!text(transcript))return problem('TRANSCRIPT_REQUIRED');
 if(truncated)return problem('RESULT_TRUNCATED');
 let parsed:unknown;
 // Some models wrap a single JSON object in a Markdown code fence.
 // Accept only a complete fence; surrounding commentary still fails.
 const trimmed=raw.trim();
 const fence=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
 const candidate=fence?fence[1]:trimmed;
 try{parsed=JSON.parse(candidate)}catch{return problem('RESULT_NOT_JSON')}
 if(!object(parsed)||!Array.isArray(parsed.action_items)||!Array.isArray(parsed.open_questions)
  ||parsed.action_items.length>100||parsed.open_questions.length>100
  ||(requireK04&&Object.keys(parsed).some(k=>!['action_items','open_questions'].includes(k))))
  return problem('RESULT_STRUCTURE_INVALID');
 const questions=parsed.open_questions.filter(text);
 const issues:string[]=[];
 if(questions.length!==parsed.open_questions.length)issues.push('QUESTIONS_INVALID');
 const points=Array.from(transcript); // code-point offsets, not JS UTF-16 units
 if(parsed.action_items.length===0&&questions.length===0)issues.push('NO_ACTIONS_REQUIRES_QUESTION');
 const spans=new Set<string>();
 const assignments:MeetingAssignment[]=[];
 let checked=0;
 for(const [i,entry] of parsed.action_items.entries()){
  const n=i+1;
  if(!object(entry)){issues.push('ITEM_'+n+'_INVALID');continue}
  const {action,quote,start,end,assignee,due_date,worker_kind,actual_work_status}=entry;
  if(!text(action)){issues.push('ITEM_'+n+'_ACTION_MISSING');continue}
  if(requireK04&&Object.keys(entry).some(k=>![
    'action','quote','start','end','assignee','due_date','worker_kind','actual_work_status'
   ].includes(k))){issues.push('ITEM_'+n+'_UNRECOGNIZED_FIELD');continue}
  // Models may miscount Unicode offsets. Compute them from the exact quote
  // when its occurrence is unique; never guess between repeated fragments.
  let resolvedStart=start,resolvedEnd=end;
  const claimedSpan=text(quote)&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)
   &&(start as number)>=0&&(end as number)>(start as number)&&(end as number)<=points.length
   &&points.slice(start as number,end as number).join('')===quote;
  if(!claimedSpan&&!requireK04&&text(quote)){
   const first=transcript.indexOf(quote);
   if(first>=0&&transcript.indexOf(quote,first+1)<0){
    resolvedStart=Array.from(transcript.slice(0,first)).length;
    resolvedEnd=(resolvedStart as number)+Array.from(quote).length;
   }
  }
  if(!text(quote)||!Number.isSafeInteger(resolvedStart)||!Number.isSafeInteger(resolvedEnd)
   ||(resolvedStart as number)<0||(resolvedEnd as number)<=(resolvedStart as number)
   ||(resolvedEnd as number)>points.length
   ||points.slice(resolvedStart as number,resolvedEnd as number).join('')!==quote){
   issues.push('ITEM_'+n+'_QUOTE_MISMATCH');continue;
  }
  // One sentence may assign different actions. Reject only repeated identical assignments.
  const assignmentKey=JSON.stringify([resolvedStart,resolvedEnd,action,assignee,due_date]);
  if(spans.has(assignmentKey)){
   issues.push('ITEM_'+n+'_DUPLICATE_ASSIGNMENT');continue;
  }
  spans.add(assignmentKey);
  if(!text(assignee)||!text(due_date)){
   issues.push('ITEM_'+n+'_OWNER_OR_DATE_MISSING');continue;
  }
  if(assignee!=='UNKNOWN'&&!quote.includes(assignee)){
   issues.push('ITEM_'+n+'_OWNER_UNSUPPORTED');continue;
  }
  if(due_date!=='UNKNOWN'&&!quote.includes(due_date)){
   issues.push('ITEM_'+n+'_DATE_UNSUPPORTED');continue;
  }
  // The K04 owner treats an assignment as only PROPOSED. Claiming that a
  // model, program or agent has already completed it is not quote evidence.
  // Legacy Graph/Task results may omit these fields, but explicit false
  // execution claims are never accepted, even in the legacy view.
  if(requireK04||worker_kind!==undefined||actual_work_status!==undefined){
   if(actual_work_status!=='NOT_EXECUTED'
      ||worker_kind!==(assignee==='UNKNOWN'?'unassigned':'human')){
    issues.push('ITEM_'+n+'_UNVERIFIED_EXECUTION_OR_WORKER');continue;
   }
  }
  checked++;
  assignments.push({action,quote,assignee,due_date});
 }
 return {status:issues.length?'REVIEW_REQUIRED':'VERIFIED_QUOTES',items:parsed.action_items.length,checked,issues,questions,assignments};
}

/** Copy-ready human follow-up. No external message is sent or completion verified. */
export function meetingHumanHandoffText(item:MeetingAssignment,language:'ru'|'en'):string {
 const owner=item.assignee==='UNKNOWN'?(language==='ru'?'не указан':'not specified'):item.assignee;
 const due=item.due_date==='UNKNOWN'?(language==='ru'?'не указан':'not specified'):item.due_date;
 return language==='ru'?
  ['Поручение по итогам совещания','Действие: '+item.action,'Исполнитель: '+owner,'Срок: '+due,
   'Основание: «'+item.quote+'»','Пожалуйста, сообщите о результате и предоставьте подтверждение.',
   'Черновик для ручной передачи. Сообщение не отправлено.'].join('\n'):
  ['Meeting follow-up assignment','Action: '+item.action,'Assignee: '+owner,'Due: '+due,
   'Source: “'+item.quote+'”','Please report the outcome and provide supporting evidence.',
   'Draft for manual sharing. No message was sent.'].join('\n');
}

/** Convert a human-accepted meeting Task result to existing Goal plan_steps.
 * A Goal remains a plan, not an assertion that assignments were executed.
 * The original quoted evidence stays in the source Task; no second store.
 */
export type MeetingGoalPlan={objective:string;criteria:string[];steps:string[]};
export function meetingFollowupGoalPlan(review:MeetingReview,language:'ru'|'en'):MeetingGoalPlan|null {
 if(review.status!=='VERIFIED_QUOTES'||!review.assignments?.length
  ||review.assignments.length>100||!['ru','en'].includes(language))return null;
 const steps=review.assignments.map(item=>language==='ru'
  ?item.action+' — исполнитель: '+(item.assignee==='UNKNOWN'?'не указан':item.assignee)
   +'; срок: '+(item.due_date==='UNKNOWN'?'не указан':item.due_date)
   +'; источник: «'+item.quote+'»'
  :item.action+' — assignee: '+(item.assignee==='UNKNOWN'?'not specified':item.assignee)
   +'; due: '+(item.due_date==='UNKNOWN'?'not specified':item.due_date)
   +'; source: “'+item.quote+'”');
 if(steps.some(x=>!x.trim()||x.length>1000))return null;
 return language==='ru'
  ?{objective:'Выполнить поручения принятого протокола',
    criteria:['Поручения выполнены, вопросы и неопределённые сроки уточнены человеком.'],
    steps}
  :{objective:'Complete assignments from the accepted meeting transcript',
    criteria:['Assignments have been completed; open questions and unspecified dates have been clarified by the user.'],
    steps};
}

/** Reconstruct only this built-in flow from Core-validated saved Graph configuration.
 * No catalog import, model invocation, or creation of a second graph definition.
 */
/** K04 host-executed path: one model, two pure Core transformations. */
function meetingHostSteps(graph:Obj,configs:unknown[]):MeetingStep[]|null {
 const graphNodes=Array.isArray(graph.nodes)?graph.nodes:null;
 if(!graphNodes||graphNodes.length!==4||!Array.isArray(graph.edges)
  ||graph.edges.length!==3||graph.entry_node_id!=='input'
  ||!Array.isArray(graph.stop_node_ids)||graph.stop_node_ids.length!==1
  ||graph.stop_node_ids[0]!=='result')return null;
 const names=['input','extract','normalize','result'];
 const types=['DETERMINISTIC_TRANSFORM','MODEL_INVOCATION','DETERMINISTIC_TRANSFORM','DETERMINISTIC_TRANSFORM'];
 const nodes=names.map((name,i)=>graphNodes.find((n:unknown)=>object(n)&&n.node_id===name&&n.node_type===types[i]));
 if(nodes.some(n=>!object(n)))return null;
 const edges=graph.edges.map((e:unknown)=>object(e)&&e.condition==='ALWAYS'
  ?String(e.from)+':'+String(e.to):'');
 if(edges.length!==3||new Set(edges).size!==3||
  !['input:extract','extract:normalize','normalize:result'].every(e=>edges.includes(e)))return null;
 const specs=nodes.map((n:unknown,i)=>{
  if(!object(n))return null;
  const config=configs.find(c=>object(c)&&c.config_ref===n.config_ref&&c.node_type===types[i]);
  return object(config)&&object(config.spec)?config.spec:null;
 });
 const [input,extract,normalize,result]=specs;
 if(!input||!extract||!normalize||!result
  ||input.operation!=='STATIC_TEXT'||!text(input.text)
  ||!text(extract.system)||!text(extract.prompt_template)
  ||!extract.system.startsWith('You extract proposed action items')
  ||!extract.system.includes('K04_SOURCE_EVIDENCE_V1')
  ||!extract.prompt_template.includes('{{node:input}}')
  ||!Array.isArray(extract.input_node_ids)||extract.input_node_ids.join(',')!=='input'
  ||normalize.operation!=='PARSE_JSON_ACTION_DRAFT'
  ||!Array.isArray(normalize.input_node_ids)||normalize.input_node_ids.join(',')!=='extract'
  ||result.operation!=='VERIFY_MEETING_DRAFT'
  ||!Array.isArray(result.input_node_ids)||result.input_node_ids.join(',')!=='input,normalize')return null;
 return [
  {node_id:'input',node_type:'DETERMINISTIC_TRANSFORM',operation:'STATIC_TEXT',text:input.text},
  {node_id:'extract',node_type:'MODEL_INVOCATION',depends_on:['input'],system:extract.system,text:extract.prompt_template},
  {node_id:'normalize',node_type:'DETERMINISTIC_TRANSFORM',depends_on:['extract'],operation:'PARSE_JSON_ACTION_DRAFT',text:''},
  {node_id:'result',node_type:'DETERMINISTIC_TRANSFORM',depends_on:['normalize'],operation:'VERIFY_MEETING_DRAFT',text:''},
 ];
}

export function meetingStepsFromGraph(graph:unknown,configs:unknown):MeetingStep[]|null {
 if(object(graph)&&Array.isArray(graph.nodes)&&graph.nodes.length===4
   &&Array.isArray(configs))return meetingHostSteps(graph,configs);
 if(!object(graph)||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges)
  ||!Array.isArray(configs)||graph.nodes.length!==3||graph.edges.length!==2
  ||graph.entry_node_id!=='input'||!Array.isArray(graph.stop_node_ids)
  ||graph.stop_node_ids.length!==1||graph.stop_node_ids[0]!=='result')return null;
 const nodes=new Map<string,Obj>();
 for(const entry of graph.nodes){
  if(!object(entry)||!text(entry.node_id)||nodes.has(entry.node_id))return null;
  nodes.set(entry.node_id,entry);
 }
 const input=nodes.get('input'),extract=nodes.get('extract'),result=nodes.get('result');
 if(!input||!extract||!result||input.node_type!=='DETERMINISTIC_TRANSFORM'
  ||extract.node_type!=='MODEL_INVOCATION'||result.node_type!=='MODEL_INVOCATION')return null;
 const edges=graph.edges.map(edge=>object(edge)&&edge.condition==='ALWAYS'
  ?String(edge.from)+':'+String(edge.to):'');
 if(!edges.includes('input:extract')||!edges.includes('extract:result'))return null;
 const specs=[input,extract,result].map(node=>{
  const config=configs.find(row=>object(row)&&row.config_ref===node.config_ref
    &&row.node_type===node.node_type);
  return object(config)&&object(config.spec)?config.spec:null;
 });
 const [inputSpec,extractSpec,resultSpec]=specs;
 if(!inputSpec||!extractSpec||!resultSpec
  ||inputSpec.operation!=='STATIC_TEXT'||typeof inputSpec.text!=='string'
  ||typeof extractSpec.system!=='string'||typeof extractSpec.prompt_template!=='string'
  ||typeof resultSpec.system!=='string'||typeof resultSpec.prompt_template!=='string')return null;
 return [
  {node_id:'input',node_type:'DETERMINISTIC_TRANSFORM',operation:'STATIC_TEXT',text:inputSpec.text},
  {node_id:'extract',node_type:'MODEL_INVOCATION',depends_on:['input'],system:extractSpec.system,text:extractSpec.prompt_template},
  {node_id:'result',node_type:'MODEL_INVOCATION',depends_on:['extract'],system:resultSpec.system,text:resultSpec.prompt_template},
 ];
}

export function reviewMeetingGraph(steps:MeetingStep[]|null,readback:unknown,executionState:string):MeetingReview|null {
 if(steps?.length===4){
  const [input,extract,normalize,result]=steps;
  if(input.node_id!=='input'||input.operation!=='STATIC_TEXT'
   ||extract.node_id!=='extract'||extract.node_type!=='MODEL_INVOCATION'
   ||!extract.system?.includes('K04_SOURCE_EVIDENCE_V1')
   ||normalize.node_id!=='normalize'||normalize.operation!=='PARSE_JSON_ACTION_DRAFT'
   ||result.node_id!=='result'||result.operation!=='VERIFY_MEETING_DRAFT')return null;
  if(executionState!=='COMPLETED')return pending();
  if(!object(readback))return problem('FINAL_EVIDENCE_MISSING');
  const output=Array.isArray(readback.results)?readback.results.find(
   (row:unknown)=>object(row)&&row.node_id==='result'):null;
  const final=readback.final_result;
  if(!object(output)||output.status!=='COMPLETED'||!object(final)
   ||final.node_id!=='result'||!text(final.artifact_digest)
   ||final.artifact_digest!==output.artifact_digest||!text(output.text))
   return problem('FINAL_EVIDENCE_MISSING');
  return verifyMeetingDraft(input.text,output.text,
   output.truncated===true||final.truncated===true,true);
 }
 if(!steps||steps.length!==3)return null;
 const [input,extract,result]=steps;
 if(input.node_id!=='input'||input.node_type!=='DETERMINISTIC_TRANSFORM'||input.operation!=='STATIC_TEXT'
  ||extract.node_id!=='extract'||extract.node_type!=='MODEL_INVOCATION'
  ||extract.depends_on?.length!==1||extract.depends_on[0]!=='input'
  ||!extract.system?.startsWith('You extract proposed action items')
  ||!extract.text.includes('{{node:input}}')
  ||result.node_id!=='result'||result.node_type!=='MODEL_INVOCATION'
  ||result.depends_on?.length!==1||result.depends_on[0]!=='extract'
  ||!result.system?.startsWith('You independently check the proposed meeting actions')
  ||!result.text.includes('{{node:input}}')||!result.text.includes('{{node:extract}}'))return null;
 if(executionState!=='COMPLETED')return pending();
 // A marked K04-backed flow must preserve the marker on both owner stages.
 // Older saved Graphs remain readable through the previous quote-only check.
 const marker='K04_SOURCE_EVIDENCE_V1';
 const extractK04=extract.system.includes(marker),auditK04=result.system.includes(marker);
 if(extractK04!==auditK04)return problem('K04_PRESET_MODIFIED');
 if(!object(readback))return problem('FINAL_EVIDENCE_MISSING');
 const output=Array.isArray(readback.results)?readback.results.find((row:unknown)=>object(row)&&row.node_id==='result'):null;
 const final=readback.final_result;
 if(!object(output)||output.status!=='COMPLETED'||!object(final)
  ||final.node_id!=='result'||!text(final.artifact_digest)||final.artifact_digest!==output.artifact_digest
  ||!text(output.text))return problem('FINAL_EVIDENCE_MISSING');
 return verifyMeetingDraft(input.text,output.text,output.truncated===true||final.truncated===true,extractK04&&auditK04);
}
