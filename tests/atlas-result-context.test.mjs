import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOriginalAtlasWorkspaceReadback,validateOriginalAtlasWorkspacePublicationPreview,
 validateOriginalAtlasWorkspacePublicationReceipt} from '../runtime/cen03-d3-owner.mjs';
import {prepareEmployeeDraftTask} from '../src/corporate-draft-task.mjs';
import {signedAssignmentAtlasWork,acceptedAtlasFocus,selectAcceptedAtlasWork,acceptedAtlasReturnPointer,acceptedAtlasScopeMatches,sameAcceptedAtlasSource} from '../src/atlas-result-context.mjs';

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
  actorId:session.actorId,operationId,
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

test('return from plan holds only exact IDs and requires a fresh accepted source in the same live scope',()=>{
 const source=acceptedAtlasFocus(fixture()),pointer=acceptedAtlasReturnPointer(source);
 assert.equal(Object.hasOwn(pointer,'resultExcerpt'),false);
 assert.equal(Object.hasOwn(pointer,'resultTruncated'),false);
 assert.equal(acceptedAtlasScopeMatches(pointer,{...session,contextEpoch:99}),true);
 assert.equal(acceptedAtlasScopeMatches(pointer,{...session,actorId:'person:other'}),false);
 assert.equal(acceptedAtlasScopeMatches(pointer,{...session,workspaceId:'workspace:other'}),false);
 assert.equal(sameAcceptedAtlasSource(pointer,acceptedAtlasFocus(fixture())),true);
 for(const key of ['operationId','acceptanceId','packageSha256','taskRevisionId','resultRevisionId','actorId','draftEditNumber']){
   assert.equal(sameAcceptedAtlasSource(pointer,{...pointer,[key]:'different'}),false);
 }
 assert.equal(sameAcceptedAtlasSource(pointer,{...pointer,workRef:{...pointer.workRef,revision:'13'}}),false);
});


test('corporate Workspace readback is bound to the exact signed Atlas assignment, not D3 acceptance',()=>{
 const task={found:true,taskId:'task:example',recipientId:session.employeePersonId,
  taskRevisionId,packageSha256:sha,atlasReference:{draftId:draft.id,draftEditNumber:3,workRef:ref}};
 const row={objectId:'company:work:'+digest,eventId:'event:result',artifactId:'result:example',
  sha256:digest,mimeType:'text/plain',contentBytes:8,excerpt:'Measured',
  excerptTruncated:false,portableContentAvailable:true};
 const request={taskId:task.taskId,offset:0,resultObjectId:row.objectId};
 const receipt={schema:'IWXA_T3_ADMIN_ATLAS_WORKSPACE_READBACK/1',
  status:'WORKSPACE_RESULTS_FOUND',organizationId:session.organizationId,workspaceId:session.workspaceId,
  executorId:task.recipientId,taskId:task.taskId,taskRevisionId,taskPackageSha256:sha,workRef:ref,
  originalKernelReadback:true,originalSignedTaskVerified:true,signedReceiptVerified:false,
  recipientAcceptance:false,taskObjectId:'company:work:'+acceptanceId,taskEventId:'event:task',
  offset:0,total:1,nextOffset:null,results:[row],selectedResult:{...row,content:'Measured'}};
 assert.deepEqual(validateOriginalAtlasWorkspaceReadback(receipt,task,session,request),receipt);
 for(const patch of [{recipientAcceptance:true},{taskRevisionId:digest},
  {workRef:{...ref,revision:'13'}},{selectedResult:{...row,content:'Altered!'}}]){
  assert.throws(()=>validateOriginalAtlasWorkspaceReadback({...receipt,...patch},task,session,request),
   /CEN_D3_ATLAS_WORKSPACE_SOURCE_CHANGED/);
 }
 const preview={status:'READY_FOR_EXPLICIT_CONSENT',recipientId:'iwxa.atlas',
  sourceKind:'ADMIN_WORKSPACE_RESULT',operationId:'admin:t3:atlas:'+sha,
  previewId:'preview:original',previewDigest:digest,organizationId:session.organizationId,
  workspaceId:session.workspaceId,managerId:session.actorId,taskId:task.taskId,
  resultId:row.artifactId,taskObjectId:receipt.taskObjectId,taskEventId:receipt.taskEventId,
  resultEventId:row.eventId,workRef:ref,sourceObjectRef:{workspace_id:session.workspaceId,
   object_id:row.objectId,schema_id:'iwxa.t3.company-work-record',revision:1},
  selectedAcceptedSummary:'Measured',selectedSummarySha256:row.sha256,
  originalWorkspaceRecordVerified:true,originalKernelApplyVerified:false,
  signedReceiptVerified:false,originalRecipientGrantVerified:true,disclosureScope:'ORIGINAL_RESULT_ONLY'};
 assert.deepEqual(validateOriginalAtlasWorkspacePublicationPreview(preview,receipt,session),preview);
 assert.throws(()=>validateOriginalAtlasWorkspacePublicationPreview({...preview,originalKernelApplyVerified:true},
  receipt,session),/CEN_D3_ATLAS_WORKSPACE_PREVIEW_CHANGED/);
 assert.throws(()=>validateOriginalAtlasWorkspacePublicationPreview({...preview,resultEventId:'event:other'},
  receipt,session),/CEN_D3_ATLAS_WORKSPACE_PREVIEW_CHANGED/);
 const published={...preview,status:'ORIGINAL_ADMIN_RESULT_PUBLISHED',archiveSha256:digest,
  originalArchiveVerified:true,ledgerStatus:'COMMITTED',carrierPrepared:true,
  delivered:false,transferred:false,automaticRetryAllowed:false};
 assert.deepEqual(validateOriginalAtlasWorkspacePublicationReceipt(published,preview),published);
 assert.throws(()=>validateOriginalAtlasWorkspacePublicationReceipt({...published,delivered:true},preview),
  /CEN_D3_ATLAS_WORKSPACE_PUBLICATION_READBACK_CHANGED/);
});
