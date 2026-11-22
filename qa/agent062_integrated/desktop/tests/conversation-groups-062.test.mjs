import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const raw=readFileSync(new URL('../src/dialog-conversation.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(raw,{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
assert.deepEqual(compiled.diagnostics||[],[]);
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));
const key='dialog-'+'a'.repeat(32),gid='grp-'+'b'.repeat(32);
function groupedPort(){
 let groups=[],assigned=null;const calls=[];
 return {calls,query:async(name)=>{
  assert.equal(name,'session_catalog');
  return {groups,active_conversation_key:key,conversations:[
   {conversation_key:key,session_id:'SES-1',group_id:assigned,title:'Talk'}]};
 },command:async(name,input)=>{
  calls.push({name,input});
  if(name==='conversation_group_create'){
   groups=[...groups,{group_id:gid,name:input.name}];return {group_id:gid,name:input.name};
  }
  if(name==='conversation_group_rename'){
   groups=groups.map(g=>({...g,name:input.name}));return {group_id:gid,name:input.name};
  }
  if(name==='conversation_group_pin'){
   groups=groups.map(group=>group.group_id===input.group_id?{...group,pinned:input.pinned}:group);
   return {group_id:input.group_id,pinned:input.pinned};
  }
  if(name==='conversation_group_assign'){
   assigned=input.group_id;return {conversation_key:key,group_id:assigned,session_id:'SES-1'};
  }
  if(name==='conversation_group_delete'){
   groups=[];assigned=null;return {group_id:gid,ungrouped_count:1};
  }
  throw Error('unexpected command '+name);
 }};
}
test('grouping and ungrouping retain original conversation identity',async()=>{
 const port=groupedPort();
 const group=await api.createConversationGroup(port,'Work');
 assert.deepEqual(group,{group_id:gid,name:'Work',pinned:false});
 await api.assignConversationGroup(port,key,gid);
 const selected=await api.readGroupedConversationCatalog(port);
 assert.equal(selected.conversations[0].session_id,'SES-1');
 assert.equal(selected.conversations[0].group_id,gid);
 await api.pinConversationGroup(port,gid,true);
 assert.equal((await api.readGroupedConversationCatalog(port)).groups[0].pinned,true);
 await api.pinConversationGroup(port,gid,false);
 assert.equal((await api.readGroupedConversationCatalog(port)).groups[0].pinned,false);
 await api.renameConversationGroup(port,gid,'New work');
 assert.equal((await api.readGroupedConversationCatalog(port)).groups[0].name,'New work');
 await api.deleteConversationGroup(port,gid);
 assert.equal((await api.readGroupedConversationCatalog(port)).conversations[0].group_id,null);
 assert.equal(port.calls.filter(x=>x.name==='conversation_group_delete').length,1);
});
test('readback rejects a stale or unknown group assignment',async()=>{
 const port=groupedPort();
 port.query=async()=>({groups:[],conversations:[
  {conversation_key:key,session_id:'SES-1',group_id:gid}]});
 await assert.rejects(()=>api.readGroupedConversationCatalog(port),/membership_invalid/);
});
test('invalid group name is not submitted to Core',async()=>{
 const port=groupedPort();
 await assert.rejects(()=>api.createConversationGroup(port,' '),/name_invalid/);
 await assert.rejects(()=>api.createConversationGroup(port,'a'.repeat(61)),/name_invalid/);
 assert.equal(port.calls.length,0);
});
test('group menu stays hidden and operations use one contextual popover',()=>{
 const ui=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 for(const name of ['iwxa-chat-folders-new','iwxa-chat-folder-more','iwxa-chat-entry-more',
  'iwxa-chat-context-menu','iwxa-chat-popup-submenu','createPortal(', 'pinConversationGroup']){
  assert.ok(ui.includes(name),name);
 }
 assert.ok(!ui.includes('<select value={groupId'), 'no native select permanently visible beside every chat');
 for(const selector of ['.iwxa-chat-folder-entry:hover .iwxa-chat-entry-more',
  '.iwxa-chat-folder-head:focus-within .iwxa-chat-folder-more',
  '@media (hover:none),(pointer:coarse)']){
  assert.ok(css.includes(selector),selector);
 }
});
test('grouped chat React controls remain present without replacing chat',()=>{
 const raw=readFileSync(new URL('../src/product-controls.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('product-controls.tsx',raw,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 for(const s of ['iwxa-chat-with-folders','iwxa-chat-folders','createConversationGroup',
  'renameConversationGroup','deleteConversationGroup','assignConversationGroup',
  'ConversationWorkspace key={key}','setGroupToDelete']){
  assert.ok(raw.includes(s),s);
 }
});
