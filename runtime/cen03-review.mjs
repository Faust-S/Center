import {readAppliedResults} from './cen03-applied-results.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

// A presentation gate only. The original T3 review owns cryptographic,
// causal, revision and authority decisions; these functions never accept
// or apply a Result and cannot replace owner JIT checks.
export function canDecideReviewedResult(review,packageSha256,decision) {
  return (decision==='ACCEPT'||decision==='REJECT') &&
    typeof packageSha256==='string' &&
    /^[a-f0-9]{64}$/.test(packageSha256) &&
    review?.verificationState==='VERIFIED' &&
    review?.reviewLedgerConsistent===true &&
    review?.preview?.packageSha256===packageSha256 &&
    typeof review?.preview?.previewDigest==='string' &&
    review.preview.previewDigest.length>0 &&
    review.preview.allowedAction==='EXPLICIT_ACCEPT_ONLY' &&
    !['ACCEPTED','REJECTED'].includes(review?.receipt?.acceptanceState);
}

// The owner must first persist ACCEPT and then be reviewed again.
// No preview or stale decision can be represented as an applied result.
export function acceptedApplicationSelection(review,packageSha256) {
  if(review?.verificationState!=='VERIFIED' ||
    review?.reviewLedgerConsistent!==true ||
    review?.taskBinding?.proven!==true ||
    review?.preview?.packageSha256!==packageSha256 ||
    review?.receipt?.packageSha256!==packageSha256 ||
    review?.receipt?.acceptanceState!=='ACCEPTED' ||
    typeof review?.receipt?.acceptanceId!=='string' ||
    !Array.isArray(review?.changes)) return null;
  const revisions=review.changes.filter(x=>x?.operation==='UPSERT');
  if(revisions.length===0 || revisions.length>32 ||
    !revisions.every(x=>typeof x.revisionId==='string'&&/^[a-f0-9]{64}$/.test(x.revisionId)))
    return null;
  const revisionIds=revisions.map(x=>x.revisionId);
  if(new Set(revisionIds).size!==revisionIds.length) return null;
  if(!revisionIds.every(id=>{
    const records=review.revisionCurrentness?.filter(x=>x.revisionId===id);
    return records?.length===1 && records[0].currentness==='CURRENT_BOUNDED' &&
      records[0].eligibleForLocalInterpretation===true &&
      records[0].protectedActionAuthorized===false;
  })) return null;
  return {acceptanceId:review.receipt.acceptanceId,revisionIds};
}

// CEN03: UI-facing delegation over existing T3 Reconciliation. No local
// conflict classifier, no acceptance state machine, no independent Store.
export function createCen03Review({runtime,snapshot,bind}) {
  return Object.freeze({
    inspect({packageSha256,binding}) {
      bind(binding);
      requireValue(typeof packageSha256==='string' &&
        /^[a-f0-9]{64}$/.test(packageSha256),'T3_PACKAGE_SHA_REQUIRED');
      requireValue(typeof runtime.review==='function','T3_REVIEW_NOT_CONNECTED');
      return runtime.review(packageSha256);
    },
    decide({packageSha256,previewDigest,decision,reason='',binding}) {
      bind(binding);
      requireValue(decision!=='CHANGES_REQUESTED','T3_RETURN_OPERATION_NOT_AVAILABLE');
      requireValue(['ACCEPT','REJECT'].includes(decision),'DECISION_INVALID');
      requireValue(typeof runtime.decide==='function','T3_DECISION_NOT_CONNECTED');
      return runtime.decide(packageSha256,{previewDigest,decision,reason});
    },
    previewApplication({acceptanceId,revisionIds,binding}) {
      bind(binding);
      requireValue(typeof runtime.previewApplication==='function','T3_APPLY_NOT_CONNECTED');
      return runtime.previewApplication({acceptanceId,revisionIds});
    },
    decideApplication({previewId,previewDigest,binding}) {
      bind(binding);
      requireValue(typeof runtime.decideApplication==='function','T3_APPLY_NOT_CONNECTED');
      return runtime.decideApplication(previewId,previewDigest);
    },
    commitApplication({previewId,previewDigest,binding}) {
      bind(binding);
      requireValue(typeof runtime.commitApplication==='function','T3_APPLY_NOT_CONNECTED');
      // Owner returns a durable receipt. Do not relabel a local commit as
      // application inside an external Personal Agent or Atlas host.
      return runtime.commitApplication(previewId,previewDigest);
    },
    applicationState({binding}) {
      bind(binding);
      return snapshot().application??null;
    },
    reusableResults({binding}) {
      const current=bind(binding);
      const view=readAppliedResults(snapshot(),current.organizationId,current.workspaceId);
      bind(binding);
      return view;
    }
  });
}
