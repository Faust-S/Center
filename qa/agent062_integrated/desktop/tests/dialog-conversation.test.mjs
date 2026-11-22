import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const file=fileURLToPath(new URL('../src/dialog-conversation.ts',import.meta.url));
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
 reportDiagnostics:true
});
assert.deepEqual(compiled.diagnostics||[],[]);
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));
const KEY='dialog-'+'a'.repeat(32);
const OTHER='dialog-'+'b'.repeat(32);
const pin={name:'locally-chosen:7b',digest:'f'.repeat(64)};
function port(){
 const calls=[];
 let activeKey=KEY;
 return {calls,
  query:async(name,params={})=>{
   calls.push(['query',name,params]);
   if(name==='session_catalog')return {active_conversation_key:activeKey,conversations:[
    {conversation_key:KEY,session_id:'SES-1',title:''},
    {conversation_key:OTHER,session_id:'SES-2',title:'Separate'},
    {conversation_key:'bad key',session_id:'SES-3'}]};
   if(name==='session_status')return {session:{session_id:'SES-1',state:'ACTIVE'},recent_linked_tasks:[{task_id:'TASK-1'}]};
   if(name==='interactive_submission_status')return {task_id:'TASK-1',submission_id:params.submission_id,job_id:'JOB-CHAT-1'};
   if(name==='session_search')return {results:[{task_id:'TASK-1'}]};
   if(name==='composer_draft')return {text:'Saved',local_model:pin};
   if(name==='task')return {task_id:'TASK-1'};
   throw Error('unexpected query '+name);
  },
  command:async(name,input)=>{
   calls.push(['command',name,input]);
   if(name==='session_bind')return {created:true,session:{session_id:'SES-1'}};
   if(name==='session_select'){
    activeKey=input.conversation_key;
    return {active_conversation_key:activeKey,session_id:activeKey===OTHER?'SES-2':'SES-1'};
   }
   if(name==='submit_task')return {task_id:'TASK-1',job_id:'JOB-CHAT-1'};
   if(name==='composer_draft_save')return {text:input.text,local_model:input.local_model};
   throw Error('unexpected command '+name);
  },
 };
}
test('new keys are strict UUID v4 and legacy draft context remains readable',()=>{
 assert.equal(api.newConversationKey(()=>'12345678-1234-4234-8234-123456789abc'),'dialog-12345678123442348234123456789abc');
 assert.equal(api.conversationDraftContext(api.LEGACY_CONVERSATION),'dialogue');
 assert.equal(api.conversationDraftContext(KEY),'dialogue:'+KEY);
 assert.throws(()=>api.newConversationKey(()=>'insecure'),/secure_conversation_uuid/);
 assert.throws(()=>api.conversationDraftContext('dialog-../task'),/invalid_desktop_conversation_key/);
});
test('selected contextual dialogue uses quick chat and never creates Task',async()=>{
 const p=port();
 const topics=await api.listConversations(p);
 assert.deepEqual(topics.map(x=>x.conversation_key),[KEY,OTHER]);
 p.command=async(name,input)=>{
  p.calls.push(['command',name,input]);
  if(name==='quick_chat_submit')return {accepted:true,submission_id:input.submission_id,state:'RUNNING',reused:false};
  throw Error('unexpected command '+name);
 };
 const options={skill_id:null,use_memory:false,use_obsidian:true,use_web:false};
 const selected=[{path:'notes/a.md',expected_sha256:'a'.repeat(64),title:'A',
  provider_id:'OBSIDIAN_LOCAL',binding_digest:'b'.repeat(64)}];
 const attachments=[{name:'notes.txt',text:'Local text'}];
 const ack=await api.submitQuickMessage(p,OTHER,' My message ',pin,'c'.repeat(32),options,selected,attachments);
 assert.deepEqual(ack,{submissionId:'c'.repeat(32),state:'RUNNING',reused:false});
 const req=p.calls.find(x=>x[1]==='quick_chat_submit')[2];
 assert.equal(req.message,'My message');
 assert.equal(req.conversation_key,OTHER);
 assert.deepEqual(req.options,{use_memory:false,use_obsidian:true,use_web:false});
 assert.deepEqual(req.knowledge_sources,selected);
 assert.deepEqual(req.attachments,attachments);
 assert.equal(p.calls.filter(x=>x[1]==='submit_task').length,0);
});

test('drafts and model identities remain independent by key through Core commands',async()=>{
 const p=port();
 await api.saveConversationDraft(p,KEY,'Alpha',pin);
 await api.saveConversationDraft(p,OTHER,'Beta',null);
 const saves=p.calls.filter(x=>x[1]==='composer_draft_save');
 assert.deepEqual(saves.map(x=>x[2].context),['dialogue:'+KEY,'dialogue:'+OTHER]);
 assert.deepEqual(saves.map(x=>x[2].local_model),[pin,null]);
 assert.deepEqual(await api.readConversationDraft(p,KEY),{text:'Saved',local_model:pin});
 assert.equal(p.calls.at(-1)[2].context,'dialogue:'+KEY);
});
test('bind is one durable owner command plus exact session readback',async()=>{
 const p=port();await api.bindConversation(p,KEY);
 assert.deepEqual(p.calls.map(x=>x[1]),['session_bind','session_status']);
 const wrong=port();wrong.query=async()=>({session:{session_id:'SES-not-mine',state:'ACTIVE'}});
 await assert.rejects(()=>api.bindConversation(wrong,KEY),/readback_mismatch/);
});

test('last selected conversation is restored from Core instead of browser fallback',async()=>{
 const p=port();
 const initial=await api.readConversationCatalog(p);
 assert.equal(initial.activeKey,KEY);
 await api.selectConversation(p,OTHER);
 const next=await api.readConversationCatalog(p);
 assert.equal(next.activeKey,OTHER);
 assert.deepEqual(next.conversations.map(x=>x.conversation_key),[KEY,OTHER]);
 assert.deepEqual(p.calls.filter(x=>x[1]==='session_select').map(x=>x[2].conversation_key),[OTHER]);
});
test('conversation selection refuses mismatched owner readback',async()=>{
 const p=port();
 p.command=async()=>({active_conversation_key:KEY,session_id:'SES-1'});
 await assert.rejects(()=>api.selectConversation(p,OTHER),/selection_unconfirmed/);
});

test('switching waits for exact saved draft and model readback',async()=>{
 const p=port();
 p.query=async(name,params)=>{
  if(name==='composer_draft')return {state:'SAVED',text:'Unsent',local_model:pin};
  throw Error('unexpected query '+name);
 };
 await api.verifyConversationDraft(p,KEY,'Unsent',pin);
 await assert.rejects(()=>api.verifyConversationDraft(p,KEY,'Different',pin),/conversation_draft_readback_mismatch/);
 await assert.rejects(()=>api.verifyConversationDraft(p,KEY,'Unsent',null),/conversation_draft_readback_mismatch/);
});

test('idempotent complete chat response is never treated as running',async()=>{
 const p=port();
 p.command=async(name,input)=>({accepted:true,submission_id:input.submission_id,state:'COMPLETED',reused:true});
 const ack=await api.submitQuickMessage(p,KEY,'Already done',null,'e'.repeat(32),
  {skill_id:null,use_memory:false,use_obsidian:false,use_web:false});
 assert.equal(ack.state,'COMPLETED');
 assert.equal(ack.reused,true);
});


test('chat progress reads same submission without issuing commands',async()=>{
 const p=port();
 p.query=async(name,params)=>{
  p.calls.push(['query',name,params]);
  if(name==='quick_chat_status')return {submission_id:params.submission_id,
   message_id:params.submission_id,state:'RUNNING',partial_text:'частичный ответ',error_code:null};
  throw Error('unexpected query '+name);
 };
 const sid='a'.repeat(32);
 const result=await api.readQuickChatProgress(p,KEY,sid);
 assert.deepEqual(result,{submissionId:sid,state:'RUNNING',partialText:'частичный ответ',errorCode:''});
 assert.deepEqual(p.calls.map(x=>x[1]),['quick_chat_status']);
});
test('chat progress refuses cross-submission or malformed Core readback',async()=>{
 const p=port(),sid='a'.repeat(32);
 p.query=async()=>({submission_id:'b'.repeat(32),message_id:sid,state:'COMPLETED'});
 await assert.rejects(()=>api.readQuickChatProgress(p,KEY,sid),/readback_mismatch/);
 await assert.rejects(()=>api.readQuickChatProgress(p,KEY,'invalid'),/chat_submission_id_invalid/);
 p.query=async()=>({submission_id:sid,message_id:sid,state:'RUNNING',partial_text:'x'.repeat(16001)});
 await assert.rejects(()=>api.readQuickChatProgress(p,KEY,sid),/progress_out_of_bounds/);
});


test('recovered unsent draft checks only the last submitted chat turn',()=>{
 const turn=(id,objective)=>({message_id:id,objective,status:'COMPLETED'});
 const first='a'.repeat(32),second='b'.repeat(32);
 assert.equal(api.restoredDraftMatchesLastSubmission(' Same prompt ',[
  turn(first,'Previous prompt'),turn(second,'Same prompt')]),true);
 assert.equal(api.restoredDraftMatchesLastSubmission('Different prompt',[
  turn(first,'Previous prompt'),turn(second,'Same prompt')]),false);
 assert.equal(api.restoredDraftMatchesLastSubmission('Previous prompt',[
  turn(first,'Previous prompt'),turn(second,'Same prompt')]),false);
 assert.equal(api.restoredDraftMatchesLastSubmission('Unsent',[
  {task_id:'TASK-1',objective:'Unsent'}]),false);
 assert.equal(api.restoredDraftMatchesLastSubmission(' ',[
  turn(first,'Previous prompt')]),false);
});
test('readback of a restored completed submission is query-only and scoped',async()=>{
 const p=port(),sid='c'.repeat(32);
 p.query=async(name,params)=>{
  p.calls.push(['query',name,params]);
  if(name!=='quick_chat_status'||params.conversation_key!==KEY)throw Error('unexpected read');
  return {submission_id:sid,message_id:sid,state:'COMPLETED',text:'Saved reply',error_code:null};
 };
 const status=await api.readQuickChatProgress(p,KEY,sid);
 assert.equal(status.state,'COMPLETED');
 assert.equal(p.calls.length,1);
 assert.equal(p.calls[0][1],'quick_chat_status');
 assert.equal(p.calls.filter(x=>x[0]==='command').length,0);
});


test('pending chat intent is verified from the Core-owned draft',async()=>{
 const id='a'.repeat(32),digest='c'.repeat(64);
 const options={skill_id:null,use_memory:false,use_obsidian:false,use_web:false};
 const state={text:'Original',local_model:null,knowledge_sources:[],attachments:[],state:'SAVED',draft_digest:digest,pending_submission:null};
 const calls=[];
 const p={query:async(name)=>name==='session_options'?{options}:({...state}),command:async(name,input)=>{
  calls.push([name,input]);
  if(input.pending_submission!==undefined)state.pending_submission=input.pending_submission;
  state.text=input.clear_submitted_draft?'':input.text;
  return {accepted:true};
 }};
 const pending=await api.reserveConversationSubmission(p,KEY,id,'Original',null,[],[],options);
 assert.deepEqual(pending,{submission_id:id,draft_digest:digest,context_options:options});
 assert.deepEqual(api.readPendingConversationSubmission(state),pending);
 await assert.rejects(()=>api.reserveConversationSubmission(p,KEY,'b'.repeat(32),'Original',null,[],[],options),
  /chat_pending_submission_unresolved/);
 const resolved=await api.resolveConversationSubmission(p,KEY,id);
 assert.equal(resolved.text,'');
 assert.equal(api.readPendingConversationSubmission(state),null);
 assert.equal(calls[1][1].clear_submitted_draft,true);
 assert.equal(calls[1][1].expected_draft_digest,digest);
 assert.equal(calls.length,2);
 assert.equal(calls[1][1].expected_pending_submission_id,id);
});

test('prepared local chat turn is a valid read-only state',async()=>{
 const sid='a'.repeat(32);
 const p={query:async()=>({submission_id:sid,message_id:sid,state:'PREPARED'})};
 assert.equal((await api.readQuickChatProgress(p,KEY,sid)).state,'PREPARED');
});



test('claimed submission preserves a newer edited draft instead of wiping it',async()=>{
 const sid='a'.repeat(32),oldDigest='a'.repeat(64),newDigest='b'.repeat(64);
 const state={text:'Edited',local_model:pin,knowledge_sources:[],attachments:[],
  state:'SAVED',draft_digest:newDigest,
  pending_submission:{submission_id:sid,draft_digest:oldDigest}};
 const commands=[];
 const p={query:async()=>({...state}),command:async(name,input)=>{
  commands.push(input);state.pending_submission=null;return {accepted:true};
 }};
 const after=await api.resolveConversationSubmission(p,KEY,sid);
 assert.equal(after.text,'Edited');
 assert.equal(commands[0].text,'Edited');
 assert.equal(commands[0].expected_draft_digest,newDigest);
 assert.equal(commands[0].clear_submitted_draft,true);
});

test('prepared submission cancellation is explicit and leaves the typed draft intact',async()=>{
 const sid='a'.repeat(32),digest='a'.repeat(64);
 const state={text:'Unsent',local_model:null,knowledge_sources:[],attachments:[],
  state:'SAVED',draft_digest:digest,pending_submission:{submission_id:sid,draft_digest:digest}};
 let cancelled=false;
 const p={query:async()=>({...state}),command:async(name,input)=>{
  assert.equal(name,'composer_draft_save');
  assert.equal(input.cancel_prepared_submission,true);
  assert.equal(input.expected_pending_submission_id,sid);
  cancelled=true;state.pending_submission=null;return {accepted:true};
 }};
 const result=await api.cancelPreparedConversationSubmission(p,KEY,sid);
 assert.equal(cancelled,true);
 assert.equal(result.text,'Unsent');
 assert.equal(result.pending_submission,null);
});


test('settlement detects model, source and attachment edits even with unchanged text',()=>{
 const saved={text:'Same',local_model:pin,knowledge_sources:[],attachments:[]};
 assert.equal(api.conversationDraftMatches(saved,'Same',pin,[],[]),true);
 assert.equal(api.conversationDraftMatches(saved,'Same',null,[],[]),false);
 assert.equal(api.conversationDraftMatches(saved,'Same',pin,[{path:'new.md'}],[]),false);
 assert.equal(api.conversationDraftMatches(saved,'Same',pin,[],[{name:'new.txt',text:'new'}]),false);
 assert.equal(api.conversationDraftMatches(saved,'Changed',pin,[],[]),false);
});



test('prepared submission context survives recovery without relying on active defaults',()=>{
 const options={skill_id:'comparison-and-decision',use_memory:true,use_obsidian:false,use_web:false};
 const pending={submission_id:'a'.repeat(32),draft_digest:'b'.repeat(64),context_options:options};
 assert.deepEqual(api.readPendingConversationSubmission({pending_submission:pending}),pending);
 assert.throws(()=>api.readPendingConversationSubmission({pending_submission:{
  ...pending,context_options:{...options,use_web:'false'}}}),/chat_pending_context_invalid/);
});

test('changed Core context options refuse preparation before any write',async()=>{
 const state={text:'Original',local_model:null,knowledge_sources:[],attachments:[],
  state:'SAVED',draft_digest:'f'.repeat(64),pending_submission:null};
 let writes=0;
 const p={query:async(name)=>name==='session_options'
  ?{options:{skill_id:null,use_memory:true,use_obsidian:false,use_web:false}}:state,
  command:async()=>{writes++;return {accepted:true}}};
 await assert.rejects(()=>api.reserveConversationSubmission(p,KEY,'a'.repeat(32),
  'Original',null,[],[],{skill_id:null,use_memory:false,use_obsidian:false,use_web:false}),
  /chat_context_options_changed/);
 assert.equal(writes,0);
});

test('explicit note selection preserves provider and digest across Core roundtrip',()=>{
 const search={path:'notes/a.md',sha256:'a'.repeat(64),title:'A',
  provenance:{provider_id:'OBSIDIAN_LOCAL',binding_digest:'b'.repeat(64)}};
 const selected=api.chatSourceFromSearch(search);
 assert.deepEqual(selected,{path:'notes/a.md',expected_sha256:'a'.repeat(64),
  title:'A',provider_id:'OBSIDIAN_LOCAL',binding_digest:'b'.repeat(64)});
 const response={path:selected.path,sha256:selected.expected_sha256,
  content:'verified local note',provider_id:'OBSIDIAN_LOCAL',
  binding_ref:{binding_digest:'b'.repeat(64)}};
 assert.deepEqual(api.confirmChatSourceReadback(selected,response),selected);
 assert.deepEqual(api.storedChatSource({...selected}),selected);
 assert.throws(()=>api.confirmChatSourceReadback(selected,{
  ...response,binding_ref:{binding_digest:'c'.repeat(64)}}),/chat_source_verified_readback_mismatch/);
 assert.throws(()=>api.confirmChatSourceReadback(selected,{
  ...response,provider_id:'JOPLIN_LOCAL'}),/chat_source_verified_readback_mismatch/);
 assert.throws(()=>api.chatSourceFromSearch({...search,provenance:{}}),/chat_source_binding_invalid/);
});

test('unbound restored notes remain readable but cannot silently move to another vault',async()=>{
 const p=port(),options={skill_id:null,use_memory:false,use_obsidian:false,use_web:false};
 const old={path:'notes/legacy.md',expected_sha256:'a'.repeat(64),title:'Old note'};
 assert.deepEqual(api.storedChatSource(old),old);
 assert.throws(()=>api.storedChatSource({...old,provider_id:'OBSIDIAN_LOCAL'}),
  /chat_source_binding_invalid/);
 await assert.rejects(()=>api.submitQuickMessage(p,KEY,'Read that note',null,
  'd'.repeat(32),options,[old],[]),/chat_source_reselection_required/);
 await assert.rejects(()=>api.reserveConversationSubmission(p,KEY,
  'd'.repeat(32),'Read that note',null,[old],[],options),/chat_source_reselection_required/);
 assert.equal(p.calls.length,0);
});

test('same path and digest with changed vault binding replaces stale selector',()=>{
 const original={path:'notes/a.md',expected_sha256:'a'.repeat(64),title:'A',provider_id:'OBSIDIAN_V1',binding_digest:'b'.repeat(64)};
 const changed={...original,provider_id:'JOPLIN_V1',binding_digest:'c'.repeat(64)};
 assert.equal(api.sameVerifiedChatSource(original,changed),false);
 const current=[original,{...original,path:'notes/b.md'}];
 const updated=api.upsertVerifiedChatSource(current,changed);
 assert.equal(updated.length,2);assert.deepEqual(updated[0],changed);
 assert.deepEqual(current[0],original);
 assert.strictEqual(api.upsertVerifiedChatSource(updated,changed),updated);
 const full=Array.from({length:8},(_,i)=>({...original,path:'notes/'+i+'.md'}));
 assert.strictEqual(api.upsertVerifiedChatSource(full,{...original,path:'new.md'}),full);
 assert.equal(api.upsertVerifiedChatSource(full,{...changed,path:'notes/3.md'}).length,8);
 assert.throws(()=>api.upsertVerifiedChatSource([],{path:'legacy.md',title:'Legacy',expected_sha256:'a'.repeat(64)}),/chat_source_binding_invalid/);
});

test('terminal status is confirmed only by durable history for same submission',()=>{
 const id='a'.repeat(32),other='b'.repeat(32);
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:id,status:'RUNNING',summary:''}]),null);
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:other,status:'COMPLETED',summary:'ok'}]),null);
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:id,status:'COMPLETED',summary:''}]),null);
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:id,status:'COMPLETED',summary:'Verified answer'}]),'COMPLETED');
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:id,status:'FAILED',summary:''}]),'FAILED');
 assert.equal(api.terminalQuickChatTurn(id,[{message_id:id,status:'INTERRUPTED',summary:''}]),'INTERRUPTED');
});

test('terminal history reconciliation requires exact saved completion',()=>{
 const sid='a'.repeat(32);
 assert.equal(api.terminalQuickChatTurn(sid,[
  {message_id:sid,status:'RUNNING',summary:''}]),null);
 assert.equal(api.terminalQuickChatTurn(sid,[
  {message_id:sid,status:'COMPLETED',summary:'Verified answer'}]),'COMPLETED');
 assert.equal(api.terminalQuickChatTurn(sid,[
  {message_id:'b'.repeat(32),status:'COMPLETED',summary:'Wrong identity'}]),null);
});

test('dialogue startup never mounts an unverified conversation and permits read-only retry',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('product-controls.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 assert.match(ui,/!loading&&catalogReady&&<ConversationWorkspace/);
 assert.match(ui,/setCatalogReady\(false\);setError\(failure\(e\)\)/);
 assert.match(ui,/setCatalogAttempt\(attempt=>attempt\+1\)/);
 assert.match(ui,/\[conversationKey,initialLoadAttempt\]/);
 assert.match(ui,/setInitialLoadAttempt\(n=>n\+1\)/);
});

test('recovered submission settles only from exact durable history',()=>{
 const id='a'.repeat(32),other='b'.repeat(32);
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,objective:'hello',status:'RUNNING'}]),'RUNNING');
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,objective:'hello',status:'COMPLETED',summary:'reply'}]),'COMPLETED');
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,objective:'hello',status:'FAILED'}]),'FAILED');
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:other,objective:'hello',status:'COMPLETED',summary:'reply'}]),null);
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,objective:'hello',status:'COMPLETED',summary:''}]),null);
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,objective:'hello',status:'RUNNING'},{message_id:id,objective:'hello',status:'RUNNING'}]),null);
 assert.equal(api.verifiedRecoveredChatState(id,[{message_id:id,status:'RUNNING'}]),null);
});
test('quick history refuses unrelated conversation identity',async()=>{
 const id='a'.repeat(32);
 const p={query:async()=>({conversation_key:OTHER,turns:[{message_id:id,status:'COMPLETED',summary:'reply'}]})};
 await assert.rejects(()=>api.readConversationQuick(p,KEY),/chat_history_conversation_mismatch/);
});

test('bounded quick read never hides linked Tasks and older displayed messages',()=>{
 const task={task_id:'TASK-accepted',status:'closed',created_at:'2026-01-01T00:00:00Z'};
 const older={message_id:'a'.repeat(32),objective:'first',summary:'Earlier reply',status:'COMPLETED',created_at:'2026-01-02T00:00:00Z'};
 const newer={message_id:'b'.repeat(32),objective:'second',summary:'Verified answer',status:'COMPLETED',created_at:'2026-01-03T00:00:00Z'};
 const stale={...newer,summary:'',status:'RUNNING'};
 const rows=api.mergeConversationTurns([task,older,newer],[stale]);
 assert.equal(rows.length,3);
 assert.equal(rows[0].task_id,task.task_id);
 assert.equal(rows[1].summary,'Earlier reply');
 assert.equal(rows[2].summary,'Verified answer');
 assert.equal(rows[2].status,'COMPLETED');
 const updated=api.mergeConversationTurns(rows,[{...newer,summary:'New verified answer'}]);
 assert.equal(updated.length,3);
 assert.equal(updated[2].summary,'New verified answer');
 assert.throws(()=>api.mergeConversationTurns(rows,{}),/chat_history_merge_invalid/);
});
test('automatic restart settlement persists edits before releasing a saved chat marker',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const start=ui.indexOf('const stored=await readConversationQuick(runtime,conversationKey);');
 const save=ui.indexOf('await saveNow();',start);
 const before=ui.indexOf('const before=await readConversationDraft(runtime,conversationKey);',start);
 const release=ui.indexOf('const after=await resolveConversationSubmission(runtime,conversationKey,id);',start);
 assert.ok(start>=0&&save>start&&before>save&&release>before);
 assert.match(ui,/acceptHistory\(stored.status,stored.turns\)/);
 assert.match(ui,/reconnectInFlight\.current\|\|reconnectError\|\|reconnectConflict\|\|reconnectResolving/);
});

test('reconnected Core reads only the original dialogue and original submission',async()=>{
 const id='a'.repeat(32),row={message_id:id,status:'COMPLETED',objective:'User question',summary:'Saved answer'};
 const calls=[];
 const p={query:async(name,args)=>{
  calls.push(name);
  if(name==='session_catalog')return {active_conversation_key:KEY,
   conversations:[{conversation_key:KEY,session_id:'SES-1',generation:1}]};
  if(name==='composer_draft')return {state:'SAVED',text:'New unsent edit',pending_submission:{
   submission_id:id,draft_digest:'e'.repeat(64)}};
  if(name==='quick_chat_history')return {conversation_key:KEY,turns:[row],session:{session_id:'SES-1',generation:1,state:'ACTIVE'}};
  if(name==='quick_chat_status')return {submission_id:id,message_id:id,state:'COMPLETED'};
  throw Error('unrecognized '+name);
 },command:async()=>{throw Error('Reconnect must not mutate or invoke model')}};
 const result=await api.readConversationAfterCoreReconnect(p,KEY,id);
 assert.equal(result.pendingState,'COMPLETED');
 assert.equal(result.pendingId,id);
 assert.equal(result.draft.text,'New unsent edit');
 assert.equal(result.history.turns[0].summary,'Saved answer');
 assert.equal(calls.filter(x=>x==='session_catalog').length,2);
 assert.equal(calls.filter(x=>x==='quick_chat_status').length,1);
});
test('J1 accepts a completed model reply when history was read during inference',async()=>{
 const id='c'.repeat(32),calls=[],pin={name:'installed-model',digest:'a'.repeat(64)};
 const base={message_id:id,objective:'What did I ask?',local_model:pin};
 let reads=0;
 const p={
  query:async(name)=>{
   calls.push(name);
   if(name==='session_catalog')return {active_conversation_key:KEY,
    conversations:[{conversation_key:KEY,session_id:'SES-1',generation:1}]};
   if(name==='composer_draft')return {state:'SAVED',text:'Later unsent edit',
    local_model:pin,knowledge_sources:[],attachments:[]};
   if(name==='quick_chat_history')return {conversation_key:KEY,
    session:{session_id:'SES-1',generation:1},
    turns:[reads++===0?{...base,status:'RUNNING',summary:''}
      :{...base,status:'COMPLETED',summary:'Persisted model reply'}]};
   if(name==='quick_chat_status')return {submission_id:id,message_id:id,state:'COMPLETED'};
   throw Error('unexpected query '+name);
  },
  command:async()=>{throw Error('A readback must never invoke inference');}
 };
 const read=await api.readConversationAfterCoreReconnect(p,KEY,id);
 assert.equal(read.pendingState,'COMPLETED');
 assert.equal(read.history.turns[0].summary,'Persisted model reply');
 assert.deepEqual(read.history.turns[0].local_model,pin);
 assert.equal(read.draft.text,'Later unsent edit');
 assert.equal(reads,2);
 assert.equal(calls.filter(x=>x==='quick_chat_status').length,2);
});
test('J1 never merges a race-retried reply from a recycled session generation',async()=>{
 const id='d'.repeat(32);
 let reads=0;
 const p={query:async(name)=>{
  if(name==='session_catalog')return {active_conversation_key:KEY,
   conversations:[{conversation_key:KEY,session_id:'SES-1',generation:1}]};
  if(name==='composer_draft')return {state:'SAVED',text:'Draft'};
  if(name==='quick_chat_history')return {conversation_key:KEY,
   session:{session_id:'SES-1',generation:++reads},
   turns:[{message_id:id,objective:'Question',summary:reads===1?'':'Answer',
    status:reads===1?'RUNNING':'COMPLETED'}]};
  if(name==='quick_chat_status')return {submission_id:id,message_id:id,state:'COMPLETED'};
  throw Error('unexpected '+name);
 },command:async()=>{throw Error('No model retry allowed');}};
 await assert.rejects(()=>api.readConversationAfterCoreReconnect(p,KEY,id),
  /chat_reconnect_session_changed_during_read/);
 assert.equal(reads,2);
});
test('J1 reconnect rejects a cleared or recycled generation with the same active topic',async()=>{
 const key=KEY;
 let catalogs=0,commands=0;
 const port={query:async(name)=>{
  if(name==='session_catalog')return {active_conversation_key:key,
   conversations:[{conversation_key:key,session_id:'SES-1',generation:++catalogs}]};
  if(name==='composer_draft')return {state:'SAVED',text:'Unsent notes',local_model:pin};
  if(name==='quick_chat_history')return {conversation_key:key,
   session:{session_id:'SES-1',generation:1},
   turns:[{message_id:'f'.repeat(32),objective:'Old question',status:'COMPLETED',summary:'Old answer'}]};
  throw Error('Unexpected query '+name);
 },command:async()=>{commands++;throw Error('Core mutation prohibited during readback')}};
 await assert.rejects(()=>api.readConversationAfterCoreReconnect(port,key),
  /chat_reconnect_session_changed_during_read/);
 assert.equal(catalogs,2);
 assert.equal(commands,0);
});
test('J1 reconnect refuses history belonging to an earlier Session identity',async()=>{
 let catalogs=0,commands=0;
 const port={query:async(name)=>{
  if(name==='session_catalog'){catalogs++;return {active_conversation_key:KEY,
   conversations:[{conversation_key:KEY,session_id:'SES-2',generation:1}]};}
  if(name==='composer_draft')return {state:'SAVED',text:'New draft'};
  if(name==='quick_chat_history')return {conversation_key:KEY,
   session:{session_id:'SES-1',generation:1},turns:[]};
  throw Error('Unexpected '+name);
 },command:async()=>{commands++;throw Error('No model execution')}};
 await assert.rejects(()=>api.readConversationAfterCoreReconnect(port,KEY),
  /chat_reconnect_session_changed_during_read/);
 assert.equal(catalogs,1);
 assert.equal(commands,0);
});
test('J1 clears stale composer reservation after Core owns an unreserved running turn',()=>{
 const view=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const start=view.indexOf("}else if(result.pendingId&&result.pendingState==='RUNNING'){");
 const end=view.indexOf("}else if(result.pendingId){",start);
 assert.ok(start>=0&&end>start);
 const branch=view.slice(start,end);
 assert.match(branch,/recoveredPending\.current='';pendingAttempt\.current=null/);
 assert.match(branch,/setRecoveryState\('RUNNING'\)/);
 assert.match(view,/if\(result\.pendingState==='RUNNING'\)setQuickPending\(result\.pendingId\)/);
});
test('reconnect blocks changed conversation and missing durable terminal evidence',async()=>{
 const id='a'.repeat(32);
 const p={query:async name=>{
  if(name==='session_catalog')return {active_conversation_key:OTHER,
   conversations:[{conversation_key:OTHER,session_id:'SES-2'}]};
  throw Error('should not read other conversation');
 },command:async()=>{throw Error('No mutation allowed')}};
 await assert.rejects(()=>api.readConversationAfterCoreReconnect(p,KEY,id),
  /chat_reconnect_active_conversation_changed/);
 let reads=0;
 const empty={query:async name=>{
  if(name==='session_catalog'){reads++;return {active_conversation_key:KEY,
   conversations:[{conversation_key:KEY,session_id:'SES-1',generation:1}]};}
  if(name==='composer_draft')return {state:'SAVED',text:'Draft'};
  if(name==='quick_chat_history')return {conversation_key:KEY,session:{session_id:'SES-1',generation:1},turns:[]};
  if(name==='quick_chat_status')return {submission_id:id,message_id:id,state:'COMPLETED'};
  throw Error('unexpected '+name);
 }};
 await assert.rejects(()=>api.readConversationAfterCoreReconnect(empty,KEY,id),
  /chat_reconnect_history_not_verified/);
 assert.equal(reads,1);
});
test('J1 React reconnect passes authenticated epoch and keeps unsent draft',()=>{
 const app=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 assert.match(app,/<DialogControl readbackEpoch=\{sessionReadbackEpoch\}/);
 assert.match(ui,/readConversationAfterCoreReconnect\(runtime,conversationKey,previousId\)/);
 assert.match(ui,/acceptHistory\(result.history.status,result.history.turns\)/);
 const effect=ui.slice(ui.indexOf('// A renewed Core session is a readback boundary'),
  ui.indexOf('useEffect(()=>{\n  if(!quickPending||reconnectInFlight.current'));
 assert.doesNotMatch(effect,/setDraft\(|setLocalPin\(|submitQuickMessage\(|runtime\.command/);
 assert.match(ui,/reconnectInFlight\.current\|\|reconnectError\|\|reconnectConflict\|\|reconnectResolving\|\|!draft\.trim/);
 assert.match(ui,/setReconnectReadAttempt\(n=>n\+1\)/);
});


test('J1 reconnect compares every editable field before allowing a new Core write',()=>{
 const local={text:'Visible draft',model:pin,sources:[],attachments:[]};
 const saved={state:'SAVED',text:local.text,local_model:pin,knowledge_sources:[],attachments:[]};
 assert.deepEqual(api.conversationReconnectDraftDifferences(saved,local),[]);
 assert.deepEqual(api.conversationReconnectDraftDifferences({...saved,text:'Other text'},local),['text']);
 assert.deepEqual(api.conversationReconnectDraftDifferences({...saved,local_model:null},local),['model']);
 assert.deepEqual(api.conversationReconnectDraftDifferences({...saved,knowledge_sources:[{path:'selected'}]},local),['sources']);
 assert.deepEqual(api.conversationReconnectDraftDifferences({...saved,attachments:[{name:'note.txt',text:'Other'}]},local),['attachments']);
 assert.throws(()=>api.conversationReconnectDraftDifferences({...saved,state:'BROKEN'},local),
  /chat_reconnect_draft_unverified/);
});

test('J1 recovered local draft is saved once with Core compare-and-save',async()=>{
 const id=KEY,digest='a'.repeat(64);
 const stored={state:'SAVED',draft_digest:digest,text:'Saved on Core',local_model:null,
  knowledge_sources:[],attachments:[],pending_submission:null};
 const local={text:'Edited during outage',model:pin,sources:[],attachments:[]};
 const actions=[];
 const p={
  query:async(name)=>{
   if(name==='session_catalog')return {active_conversation_key:id,
    conversations:[{conversation_key:id,session_id:'SES-1',generation:1}]};
   if(name==='composer_draft')return {...stored};
   if(name==='quick_chat_history')return {conversation_key:id,turns:[],session:{session_id:'SES-1',generation:1}};
   throw Error('unexpected '+name);
  },
  command:async(name,input)=>{
   assert.equal(name,'composer_draft_save');
   assert.equal(input.expected_draft_digest,digest);
   assert.equal(input.context,api.conversationDraftContext(id));
   actions.push(input);
   stored.text=input.text;stored.local_model=input.local_model;
   stored.knowledge_sources=input.knowledge_sources;stored.attachments=input.attachments;
   stored.draft_digest='b'.repeat(64);
   return {accepted:true};
  }
 };
 const saved=await api.resolveConversationReconnectDraft(p,id,{...stored},'local',local);
 assert.equal(saved.text,local.text);
 assert.deepEqual(saved.local_model,pin);
 assert.equal(actions.length,1);
});

test('J1 autosave preserves a concurrent Core draft instead of overwriting it',async()=>{
 const saved={state:'SAVED',draft_digest:'b'.repeat(64),text:'Edited in another window',
  local_model:null,knowledge_sources:[],attachments:[]};
 let commandCount=0;
 const p={query:async(name)=>{assert.equal(name,'composer_draft');return {...saved}},
  command:async(name,input)=>{
   assert.equal(name,'composer_draft_save');
   commandCount++;
   assert.equal(input.expected_draft_digest,'a'.repeat(64));
   throw Error('composer_draft_changed');
  }};
 await assert.rejects(()=>api.saveCheckedConversationDraft(p,KEY,'a'.repeat(64),
  {text:'Old local draft',model:null,sources:[],attachments:[]}),/composer_draft_changed/);
 assert.equal(commandCount,1);
 assert.equal(saved.text,'Edited in another window');
});
test('J1 autosave readback resolves a lost ACK without resending the write',async()=>{
 const saved={state:'SAVED',draft_digest:'a'.repeat(64),text:'Original',
  local_model:null,knowledge_sources:[],attachments:[]};
 const newDraft={text:'Unsaved user text',model:pin,sources:[],attachments:[]};
 let calls=0;
 const p={query:async()=>({...saved}),command:async(name,input)=>{
  assert.equal(name,'composer_draft_save');
  assert.equal(input.expected_draft_digest,'a'.repeat(64));
  calls++;
  saved.text=input.text;saved.local_model=input.local_model;
  saved.draft_digest='b'.repeat(64);
  throw Error('LOST_ACK');
 }};
 const result=await api.saveCheckedConversationDraft(p,KEY,'a'.repeat(64),newDraft);
 assert.equal(calls,1);assert.equal(result.text,newDraft.text);
 assert.deepEqual(result.local_model,pin);
 assert.equal(result.draft_digest,'b'.repeat(64));
});
test('J1 first unsent dialogue write is compare-and-saved and read back',async()=>{
 const initial='a'.repeat(64),completed='b'.repeat(64);
 const saved={state:'EMPTY_OR_UNREADABLE',draft_digest:initial,text:'',
  local_model:null,knowledge_sources:[],attachments:[]};
 let calls=0;
 const p={query:async()=>({...saved}),command:async(_name,input)=>{
  assert.equal(input.expected_draft_digest,initial);
  calls++;
  Object.assign(saved,{state:'SAVED',draft_digest:completed,text:input.text,
   local_model:input.local_model,knowledge_sources:input.knowledge_sources,
   attachments:input.attachments});
  return {...saved};
 }};
 const draft={text:'Ask about the installed model',model:pin,sources:[],attachments:[]};
 const read=await api.saveCheckedConversationDraft(p,KEY,initial,draft);
 assert.equal(calls,1);
 assert.deepEqual(read.local_model,pin);
 assert.equal(read.text,draft.text);
 const reopened=await p.query('composer_draft');
 assert.deepEqual(reopened,read);
});
test('J1 editor updates Core draft revision after chat and tool write paths',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 assert.match(ui,/saveCheckedConversationDraft\(runtime,conversationKey,draftRevision\.current/);
 assert.match(ui,/draftSaveBlocked\.current=true/);
 assert.match(ui,/draftRevision\.current=str\(after\.draft_digest\)/);
 assert.match(ui,/draftRevision\.current=str\(restored\.draft_digest\)/);
});
test('J1 saved draft selection is read-only and a newer Core revision rejects stale edit',async()=>{
 const digest='a'.repeat(64),key=KEY;
 const state={state:'SAVED',text:'Persisted draft',draft_digest:digest,local_model:null,
  knowledge_sources:[],attachments:[],pending_submission:null};
 let writes=0;
 const p={
  query:async name=>{
   if(name==='session_catalog')return {active_conversation_key:key,
    conversations:[{conversation_key:key,session_id:'SES-1',generation:1}]};
   if(name==='composer_draft')return {...state};
   if(name==='quick_chat_history')return {conversation_key:key,session:{session_id:'SES-1',generation:1},turns:[]};
   throw Error('unexpected '+name);
  },
  command:async()=>{writes++;throw Error('mutation not allowed')}
 };
 const local={text:'New local input',model:null,sources:[],attachments:[]};
 assert.equal((await api.resolveConversationReconnectDraft(p,key,{...state},'saved',local)).text,'Persisted draft');
 assert.equal(writes,0);
 const previous={...state};
 state.draft_digest='c'.repeat(64);
 await assert.rejects(()=>api.resolveConversationReconnectDraft(p,key,previous,'local',local),
  /chat_reconnect_draft_changed/);
 assert.equal(writes,0);
});

test('J1 lost write acknowledgment reconciles without a duplicate command',async()=>{
 const digest='a'.repeat(64),key=KEY;
 const state={state:'SAVED',draft_digest:digest,text:'Original',local_model:null,
  knowledge_sources:[],attachments:[],pending_submission:null};
 let mutations=0;
 const p={
  query:async name=>{
   if(name==='session_catalog')return {active_conversation_key:key,
    conversations:[{conversation_key:key,session_id:'SES-1',generation:1}]};
   if(name==='composer_draft')return {...state};
   if(name==='quick_chat_history')return {conversation_key:key,session:{session_id:'SES-1',generation:1},turns:[]};
   throw Error('unexpected '+name);
  },
  command:async(_name,input)=>{
   mutations++;
   if(input.expected_draft_digest!==digest)throw Error('wrong_revision');
   state.text=input.text;state.draft_digest='b'.repeat(64);
   throw Error('ACK_LOST');
  }
 };
 const result=await api.resolveConversationReconnectDraft(p,key,{...state},'local',
  {text:'Local text',model:null,sources:[],attachments:[]});
 assert.equal(result.text,'Local text');
 assert.equal(mutations,1);
});

test('J1 conflict UI blocks autosave, inference and leaving until user resolves revisions',()=>{
 const view=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 assert.match(view,/conversationReconnectDraftDifferences\(result\.draft,local\)/);
 assert.match(view,/resolveConversationReconnectDraft\(/);
 assert.match(view,/reconnectConflict\|\|reconnectResolving\)return/);
 assert.match(view,/\!reconnectConflict\&\&\!reconnectResolving/);
 assert.match(view,/onClick=\{\(\)=>void resolveReconnectConflict\('local'\)\}/);
 assert.match(view,/onClick=\{\(\)=>void resolveReconnectConflict\('saved'\)\}/);
});


test('J1 history enrichment and search never apply an obsolete Core response',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const startup=ui.slice(ui.indexOf('const bootHistoryRevision=revision.current;'),
  ui.indexOf('},[conversationKey,initialLoadAttempt]);'));
 assert.match(startup,/if\(active&&bootHistoryRevision===revision\.current\)/);
 assert.match(startup,/acceptHistory\(full.status,full.turns\)/);
 const search=ui.slice(ui.indexOf(' async function search(){'),ui.indexOf(' async function ',ui.indexOf(' async function search(){')+8));
 assert.match(search,/const token=\+\+revision\.current/);
 assert.match(search,/live\.current&&token===revision\.current/);
 const loader=ui.slice(ui.indexOf('const load=useCallback'),ui.indexOf('useEffect(()=>{',ui.indexOf('const load=useCallback')));
 assert.match(loader,/acceptHistory\(quick.status,quick.turns\)/);
 const poll=ui.slice(ui.indexOf('useEffect(()=>{\n  if(!quickPending'),ui.indexOf('const \{run,busy,message\}',ui.indexOf('useEffect(()=>{\n  if(!quickPending')));
 assert.match(poll,/reconnectReading\|\|reconnectError/);
 assert.match(poll,/reconnectConflict\|\|reconnectResolving/);
 assert.match(ui,/str\(record\(entry\.local_model\)\.name\)/);
});


test('J1 history treats a new Session generation as a new display scope',()=>{
 const first={session:{session_id:'SES-abc',generation:1,state:'ACTIVE'}};
 const next={session:{session_id:'SES-abc',generation:2,state:'ACTIVE'}};
 const other={session:{session_id:'SES-other',generation:1,state:'ACTIVE'}};
 const id='a'.repeat(32),id2='b'.repeat(32);
 const previous=[{message_id:id,objective:'old request',status:'COMPLETED',summary:'old answer'}];
 const newer=[{message_id:id2,objective:'new request',status:'COMPLETED',summary:'new answer'}];
 assert.equal(api.conversationSessionIdentity(first),'SES-abc:1');
 assert.deepEqual(api.mergeScopedConversationHistory(first,previous,first,newer).map(x=>x.message_id),[id,id2]);
 assert.deepEqual(api.mergeScopedConversationHistory(first,previous,next,newer),newer);
 assert.deepEqual(api.mergeScopedConversationHistory(first,previous,other,newer),newer);
 assert.deepEqual(api.mergeScopedConversationHistory(first,previous,first,newer,true),newer);
 assert.throws(()=>api.conversationSessionIdentity({session:{session_id:'SES-abc'}}),/chat_session_identity_invalid/);
 assert.throws(()=>api.mergeScopedConversationHistory(first,previous,{},newer),/chat_history_session_unverified/);
});

test('J1 combined history rejects cross-generation readback before presentation',async()=>{
 const key=KEY,mid='a'.repeat(32);
 const turn={message_id:mid,objective:'old question',summary:'old answer',status:'COMPLETED'};
 const old={session_id:'SES-abc',generation:1,state:'ACTIVE'};
 const next={session_id:'SES-abc',generation:2,state:'ACTIVE'};
 const calls=[];
 const port={query:async(name)=>{
  calls.push(name);
  if(name==='quick_chat_history')return {conversation_key:key,session:old,turns:[turn]};
  if(name==='session_status')return {session:next,recent_linked_tasks:[]};
  throw Error('unexpected '+name);
 }};
 await assert.rejects(()=>api.readConversation(port,key),/chat_history_session_changed_during_read/);
 assert.deepEqual(calls,['quick_chat_history','session_status']);
});

test('J1 search rejects generation change during late search',async()=>{
 const key=KEY,old={session_id:'SES-abc',generation:1,state:'ACTIVE'};
 const newer={session_id:'SES-abc',generation:2,state:'ACTIVE'};
 let statuses=0;
 const port={query:async(name)=>{
  if(name==='quick_chat_history')return {conversation_key:key,session:old,turns:[]};
  if(name==='session_status')return {session:++statuses===1?old:newer,recent_linked_tasks:[]};
  if(name==='session_search')return {results:[]};
  throw Error('unexpected '+name);
 }};
 await assert.rejects(()=>api.readConversation(port,key,'question'),/chat_history_session_changed_during_search/);
 assert.equal(statuses,2);
});

test('J1 context reset is blocked while inference or a prepared draft is pending',()=>{
 const view=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const modify=view.slice(view.indexOf(' async function modify(action:string,input:Row){'),
  view.indexOf(' async function updateOptions(',view.indexOf(' async function modify(action:string,input:Row){')));
 assert.match(modify,/sendingRef\.current\|\|quickPending\|\|recoveredPending\.current/);
 assert.match(modify,/pendingAttempt\.current\|\|reconnectReading/);
 assert.match(modify,/acceptHistory\(\{session:confirmedSession\},\[\],true\)/);
 assert.match(modify,/await load\(\)/);
 assert.match(modify,/await onCatalogChanged\(\)/);
 assert.match(view,/onOpenModels=\{onOpenModels\}/);
});
test('J1 React history projections reset session scope without replaying messages',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 assert.match(ui,/const historyStatus=useRef<Row>\(\{\}\)/);
 assert.match(ui,/mergeScopedConversationHistory\(previous,current,observed,rows,replace\)/);
 assert.match(ui,/previousIdentity&&previousIdentity!==nextIdentity/);
 assert.match(ui,/setQuickPending\(''\);setPartialAnswer\(''\)/);
 assert.match(ui,/acceptHistory\(response.status,response.turns,true\)/);
 assert.doesNotMatch(ui,/setHistory\(previous=>mergeConversationTurns\(/);
});

test('Failed local Qwen dialogue explains only known, actionable failure states',()=>{
 const tr=(ru,en)=>en;
 assert.match(api.chatFailureMessage('basic_runtime_busy',tr),/busy with another task/);
 assert.match(api.chatFailureMessage('basic_runtime_timeout',tr),/timed out/);
 assert.match(api.chatFailureMessage('basic_runtime_model_pin_changed',tr),/selected model changed/);
 assert.match(api.chatFailureMessage('basic_runtime_generation_failed',tr),/did not produce a completed reply/);
 assert.match(api.chatFailureMessage('basic_runtime_model_not_active',tr),/stopped or its component changed/);
 assert.match(api.chatFailureMessage('C:/private/model.gguf',tr),/No reply was received/);
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 assert.ok(ui.includes('chatFailureMessage(entry.error_code,tr)'));
 assert.ok(!ui.includes('SafeMarkdown text={entry.error_code'));
});

test('context overflow in normal dialogue explains the real reason, not generic failure',()=>{
 const tr=(ru,en)=>en;
 for(const code of ['basic_runtime_context_window_insufficient',
  'basic_runtime_context_budget_too_large']){
  const message=api.chatFailureMessage(code,tr);
  assert.match(message,/do not fit the selected model context/);
  assert.match(message,/larger context/);
 }
 assert.match(api.chatFailureMessage('basic_runtime_busy',tr),/busy/);
});
