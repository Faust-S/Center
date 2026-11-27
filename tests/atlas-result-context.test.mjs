import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEmployeeDraftTask} from '../src/corporate-draft-task.mjs';
import {signedAssignmentAtlasWork,acceptedAtlasFocus,selectAcceptedAtlasWork} from '../src/atlas-result-context.mjs';

const session={organizationId:'org:example',workspaceId:'workspace:example',actorId:'person:manager',
 contextId:'context:example',contextEpoch:7,employeePersonId:'person:employee',enrollmentId:'enrollment:example'};
const ref={projectId:'project:one',workId:'work:one',revision:'12'};
const sha='a'.repeat(64),digest='b'.repeat(64),resultRevisionId='c'.repeat(64),taskRevisionId='d'.repeat(64),acceptanceId='e'.repeat(64);
const operationId='operation:accepted';
const draft={status:'DRAFT',id:'draft:source',workspaceId:session.workspaceId,editNumber:3,title:'Inspect motor',
 description:'Check installation',criteria:'Report the actual gap',dueDate:'2026-12-01',assigneeId:null,reviewerId:null,atlasRef:ref};
function originalText(extra={}){return prepareEmployeeDraftTask({...draft,...extra},session).text;}
function fixture(assignmentText=originalText(),resultText='Measured and accepted'){
 const preview={schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',packageSha256:sha,previewDigest:digest,
   entries:[{revisionId:resultRevisionId}],resultInspection:{
   schema:'IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1',packageSha256:sha,previewDigest:digest,
   signatureVerified:true,taskBindingProven:true,taskCatalogVerified:true,
   organizationId:session.organizationId,workspaceId:session.workspaceId,executorId:session.employeePersonId,
   taskId:'task:example',taskRevisionId,resultRevisionId,assignmentText,
   resultText,resultLength:resultText.length,offset:0,nextOffset:resultText.length,hasMore:false}};
 const receipt={found:true,kernelApplication:'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT',receipt:{
   schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',operationId,packageSha256:sha,
   decisionBy:session.actorId,acceptanceState:'ACCEPTED',acceptanceId}};
 return {preview,receipt,session,packageSha256:sha,operationId};
}

test('existing signed assignment footer supplies exact historical WorkRef, including chained Result source',()=>{
 const plain=signedAssignmentAtlasWork(originalText());
 assert.deepEqual(plain,{draftId:draft.id,draftEditNumber:3,workRef:ref});
 const chain=originalText({sourceResultRef:{organizationId:session.organizationId,workspaceId:session.workspaceId,
 taskId:'task:prior',taskRevisionId,resultRevisionId,acceptanceId}});
 assert.deepEqual(signedAssignmentAtlasWork(chain),plain);
});

test('ordinary signed Task, project-only link and malformed footer do not invent a work',()=>{
 for(const text of [originalText({atlasRef:null}),originalText({atlasRef:{projectId:ref.projectId,revision:ref.revision}}),
 originalText().replace(' @ 12,',' @ 012,'),originalText().replace(' @ 12,',' @ 9007199254740992,'),
 originalText()+'\n\nextra description',originalText().replace('Черновик Center:','Some summary:'),'Inspect motor']){
   assert.equal(signedAssignmentAtlasWork(text),null);
 }
});

test('accepted original owner readbacks yield a scoped navigation projection without application',()=>{
 const input=fixture(),before=JSON.stringify(input),view=acceptedAtlasFocus(input);
 assert.deepEqual(view,{draftId:draft.id,draftEditNumber:3,workRef:ref,organizationId:session.organizationId,
  workspaceId:session.workspaceId,taskId:'task:example',taskRevisionId,resultRevisionId,acceptanceId,packageSha256:sha,
  resultExcerpt:'Measured and accepted',resultTruncated:false});
 assert.equal(JSON.stringify(input),before);
 assert.equal(acceptedAtlasFocus(fixture(originalText({atlasRef:null}))),null);
 const missing=fixture();missing.receipt.found=false;
 assert.equal(acceptedAtlasFocus(missing),null);
});

test('wrong scope, digest, decision, operation or unproven original Task refuses navigation',()=>{
 for(const mutate of [
  x=>x.preview.resultInspection.signatureVerified=false,
  x=>x.preview.resultInspection.taskBindingProven=false,
  x=>x.preview.resultInspection.taskCatalogVerified=false,
  x=>x.preview.resultInspection.organizationId='org:other',
  x=>x.preview.resultInspection.workspaceId='workspace:other',
  x=>x.preview.resultInspection.packageSha256='f'.repeat(64),
  x=>x.preview.entries=[],
  x=>x.receipt.receipt.decisionBy='person:other',
  x=>x.receipt.receipt.operationId='operation:other',
  x=>x.receipt.receipt.packageSha256='f'.repeat(64),
  x=>{x.receipt.receipt.acceptanceState='REJECTED';x.receipt.receipt.schema='IWXA_T3_REJECTION_RECEIPT/1'},
 ]){
   const input=fixture();mutate(input);
   assert.throws(()=>acceptedAtlasFocus(input));
 }
});

test('excerpt does not truncate a Unicode character and indicates remaining original text',()=>{
 const text='x'.repeat(499)+'😀'+'y'.repeat(10);
 const view=acceptedAtlasFocus(fixture(originalText(),text));
 assert.equal(view.resultExcerpt,'x'.repeat(499)+'😀');
 assert.equal(view.resultTruncated,true);
});

test('later plan edition selects only the historical work identity and preserves its issued revision',()=>{
 const portfolio={revision:'13',projects:[{id:'project:other',workItems:[{id:'work:one'}]},
 {id:ref.projectId,workItems:[{id:'work:other'},{id:ref.workId}]}]};
 assert.deepEqual(selectAcceptedAtlasWork(portfolio,ref),{projectId:ref.projectId,workId:ref.workId,status:'SOURCE_REVISION_CHANGED'});
 assert.equal(selectAcceptedAtlasWork({...portfolio,revision:'12'},ref).status,'SOURCE_REVISION_MATCHES');
 assert.deepEqual(selectAcceptedAtlasWork({...portfolio,projects:[portfolio.projects[0]]},ref),
  {projectId:'',workId:'',status:'PROJECT_MISSING_IN_SOURCE'});
 assert.deepEqual(selectAcceptedAtlasWork({...portfolio,projects:[{id:ref.projectId,workItems:[{id:'work:other'}]}]},ref),
  {projectId:ref.projectId,workId:'',status:'WORK_MISSING_IN_SOURCE'});
 assert.equal(ref.revision,'12');
});
