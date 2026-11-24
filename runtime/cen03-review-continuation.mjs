// Local continuation IDs are only a no-replay aid. They contain no package,
// signed receipt, result text, license, grant, or independent owner state.
// Original Reconciliation and Kernel are the sole sources of truth.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const validId=v=>typeof v==='string'&&ID.test(v);
const validSha=v=>typeof v==='string'&&SHA.test(v);
const fail=()=>{throw Error('CEN_D3_REVIEW_CONTINUATION_HOLD')};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const scopeKey=(scope,kind,source)=>{
 if(![scope?.organizationId,scope?.workspaceId,scope?.actorId].every(validId)||
    !['decision','apply'].includes(kind)||!validSha(source))fail();
 return 'iwxa.center.review-continuation.v1:'+JSON.stringify([
   scope.organizationId,scope.workspaceId,scope.actorId,kind,source]);
};
function normalize(kind,value){
 if(kind==='decision'){
   if(!exact(value,['operationId','decision'])||!validId(value.operationId)||
      !['ACCEPT','REJECT'].includes(value.decision))fail();
   return {operationId:value.operationId,decision:value.decision};
 }
 if(kind==='apply'){
   if(!Array.isArray(value)||value.length<1||value.length>32||
      !value.every(validSha)||new Set(value).size!==value.length)fail();
   return [...value];
 }
 fail();
}
/** @returns {any} */
export function readReviewContinuation(storage,scope,kind,source){
 const key=scopeKey(scope,kind,source),raw=storage.getItem(key);
 if(raw===null)return null;
 if(typeof raw!=='string'||raw.length>4096)fail();
 let value;
 try{value=JSON.parse(raw)}catch{fail()}
 return normalize(kind,value);
}
/** @returns {any} */
export function mergeReviewContinuations(kind,local,live){
 if(local==null&&live==null)return null;
 if(local!=null&&live!=null&&JSON.stringify(normalize(kind,local))!==JSON.stringify(normalize(kind,live)))fail();
 return normalize(kind,local??live);
}
// Must be absent before a consequential call. A previously recovered
// marker may only be remembered idempotently during read-only recovery.
export function rememberReviewContinuation(storage,scope,kind,source,value,allowExisting=false){
 const key=scopeKey(scope,kind,source),next=normalize(kind,value);
 const previous=readReviewContinuation(storage,scope,kind,source);
 if(previous!==null){
   if(!allowExisting)fail();
   mergeReviewContinuations(kind,previous,next);
   return;
 }
 const raw=JSON.stringify(next);
 storage.setItem(key,raw);
 if(storage.getItem(key)!==raw)fail();
}
// Only a proven refusal before original dispatch may erase a marker.
export function clearUndispatchedReviewContinuation(storage,scope,kind,source,value){
 const key=scopeKey(scope,kind,source),previous=readReviewContinuation(storage,scope,kind,source);
 if(previous===null)fail();
 mergeReviewContinuations(kind,previous,value);
 storage.removeItem(key);
 if(storage.getItem(key)!==null)fail();
}
// Additional exact scope check, never a signature verifier.
/** @param {'ACCEPT'|'REJECT'|null} decision */
export function validateReviewDecisionReceipt(result,scope,packageSha256,operationId,decision=null){
 if(!validId(scope?.actorId)||!validSha(packageSha256)||!validId(operationId)||
    result?.kernelApplication!=='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'||
    typeof result.found!=='boolean')throw Error('CEN_D3_RECEIPT_INVALID');
 if(!result.found)return result;
 const row=result.receipt,state=row?.acceptanceState;
 if(!row||row.operationId!==operationId||row.packageSha256!==packageSha256||
    row.decisionBy!==scope.actorId||!['ACCEPTED','REJECTED'].includes(state)||
    row.schema!==(state==='ACCEPTED'?'IWXA_T3_ACCEPTANCE_RECEIPT/1':'IWXA_T3_REJECTION_RECEIPT/1')||
    (state==='ACCEPTED'&&!validSha(row.acceptanceId))||
    (decision!==null&&state!==(decision==='ACCEPT'?'ACCEPTED':'REJECTED')))
   throw Error('CEN_D3_RECEIPT_INVALID');
 return result;
}
