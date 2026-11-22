import test from 'node:test';
import assert from 'node:assert/strict';
import {answerManagerQuestion,MANAGER_QUESTIONS} from '../src/manager-answers.mjs';
import {readManagerSignedContext} from '../src/manager-owner-context.mjs';
const sha=c=>c.repeat(64);
const signed={status:'D3_OWNER_READY',snapshot:{
 product:'admin',organizationId:'org:north',workspaceId:'workspace:north',
 actorId:'person:manager',contextId:'context:one',contextEpoch:7,
 d3RecipientAvailable:true,productionActivation:false,T3_READY:false,
 totalTasks:1,tasks:[{taskId:'task:one',taskRevisionId:sha('a'),
 packageSha256:sha('b'),summary:'Поставка завершена?',deliveryState:'NOT_CONFIRMED'}]
}};
const inbox={
 schema:'IWXA_T3_ORIGINAL_RECIPIENT_INBOX/1',
 organizationId:'org:north',workspaceId:'workspace:north',
 total:2,truncated:false,items:[
 {packageSha256:sha('c'),status:'REVIEW_REQUIRED',operationId:null,acceptanceId:null},
 {packageSha256:sha('d'),status:'ACCEPTED',operationId:'decision:one',acceptanceId:sha('e')}]
};
const organization={id:'org:north',name:'Производство',workspaces:[],assignments:[],participants:[]};
const owner=readManagerSignedContext(signed,'org:north',inbox);
test('questions are bounded known management inquiries',()=>{
 assert.equal(MANAGER_QUESTIONS.length,4);
 assert.throws(()=>answerManagerQuestion('rewrite-grants',{}),/QUESTION_UNKNOWN/);
});
test('source absence is unknown, not zero or accepted Result',()=>{
 const answer=answerManagerQuestion('review',{organization});
 assert.equal(answer.status,'SOURCE_REQUIRED');
 assert.equal(answer.items.length,0);
 assert.match(answer.summary,/вручную прочитать/);
 assert.match(answer.scope,/Неизвестно/);
});
test('original Reconciliation supplies exact review evidence with actionable SHA',()=>{
 const answer=answerManagerQuestion('review',{organization,owner});
 assert.equal(answer.status,'SOURCE_SUMMARY');
 assert.equal(answer.items.length,1);
 assert.equal(answer.items[0].id,sha('c'));
 assert.equal(answer.items[0].source,'Оригинальный T3 Reconciliation');
 assert.doesNotMatch(answer.summary,/Kernel Apply подтверждён/);
 const signedTask=answerManagerQuestion('signed',{organization,owner});
 assert.equal(signedTask.items[0].id,'task:one');
 assert.match(signedTask.summary,/доставка сотрудникам не подтверждается/);
});
test('another organization cannot inherit signed findings or source answers',()=>{
 const south={...organization,id:'org:south'};
 assert.equal(answerManagerQuestion('review',{organization:south,owner}).status,'SOURCE_REQUIRED');
 assert.equal(answerManagerQuestion('signed',{organization:south,owner}).items.length,0);
});
test('partial source and optional Atlas observation are explicitly labelled',()=>{
 const partialOwner={...owner,inboxTruncated:true};
 assert.match(answerManagerQuestion('review',{organization,owner:partialOwner}).scope,/часть пакетов/);
 const emptyAtlas=answerManagerQuestion('atlas',{organization});
 assert.equal(emptyAtlas.status,'SOURCE_REQUIRED');
 const view={projects:[{id:'prj:one',name:'Станок'}]};
 const rows=[{kind:'atlas-project',id:'prj:one',title:'Станок',summary:'Наблюдение',
  source:'Открытая копия Atlas'}];
 const answer=answerManagerQuestion('atlas',{organization,atlasView:view,rows});
 assert.equal(answer.items.length,1);
 assert.match(answer.scope,/не подтверждает права T3/);
});
test('attention distinguishes draft observations and signed Review',()=>{
 const alerts=[...owner.attention,{key:'date:task:one',title:'Проверить срок черновика',
   detail:'Дата в черновике',destination:'work'}];
 const a=answerManagerQuestion('attention',{organization,owner,alerts});
 assert.equal(a.items.length,2);
 assert.equal(a.items[0].source,'Оригинальный T3 Reconciliation');
 assert.equal(a.items[1].source,'Локальный черновик');
});
