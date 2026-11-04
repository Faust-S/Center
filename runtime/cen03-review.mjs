import {readAppliedResults,verifyAppliedCommitReadback} from './cen03-applied-results.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

// A presentation gate only. The original T3 review owns cryptographic,
// causal, revision and authority decisions; these functions never accept
// or apply a Result and cannot replace owner JIT checks.
export function canDecideReviewedResult(review,packageSha256,decision) {
  const stable=(decision==='ACCEPT'||decision==='REJECT') &&
    typeof packageSha256==='string' &&
    /^[a-f0-9]{64}$/.test(packageSha256) &&
    review?.reviewLedgerConsistent===true &&
    review?.preview?.packageSha256===packageSha256 &&
    typeof review?.preview?.previewDigest==='string' &&
    review.preview.previewDigest.length>0 &&
    !['ACCEPTED','REJECTED'].includes(review?.receipt?.acceptanceState);
  // REJECT may be needed specifically because a package is untrusted or
  // otherwise ineligible for ACCEPT. The original T3 reconciliation decides
  // whether the rejection itself is authorized and records its reason.
  return stable && (decision==='REJECT'||(
    review?.verificationState==='VERIFIED' &&
    review?.preview?.allowedAction==='EXPLICIT_ACCEPT_ONLY'));
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

// UI-only session identity over the existing organization-owner readback.
// It never creates authority. A different operator, workspace, epoch or
// activation status invalidates all transient manager decisions.
export function ownerSessionFingerprint(view,organizationId) {
  const s=view?.snapshot;
  if(view?.status!=='OWNER_READY' || s?.product!=='admin' ||
    s.organizationId!==organizationId ||
    typeof s.workspaceId!=='string' || !s.workspaceId ||
    typeof s.personId!=='string' || !s.personId ||
    !Number.isSafeInteger(s.contextEpoch) ||
    s.productionActivation!==true || s.T3_READY!==true) return null;
  return JSON.stringify([s.organizationId,s.workspaceId,s.personId,
    s.contextEpoch,s.selectedOperatorId??null]);
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
    commitApplication({previewId,previewDigest,acceptanceId,revisionIds,binding}) {
      const current=bind(binding);
      requireValue(typeof runtime.commitApplication==='function','T3_APPLY_NOT_CONNECTED');
      requireValue(typeof acceptanceId==='string' && /^[a-f0-9]{64}$/.test(acceptanceId) &&
        Array.isArray(revisionIds) && revisionIds.length>0 && revisionIds.length<=32 &&
        revisionIds.every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)) &&
        new Set(revisionIds).size===revisionIds.length,'T3_APPLICATION_EXPECTED_SOURCE_REQUIRED');
      // The original T3 owns the sole write and the sealed receipt.
      // Re-read the same confirmed effect and selected revisions from its
      // Store/Journal; an uncertain commit must never be silently retried.
      const receipt=runtime.commitApplication(previewId,previewDigest);
      const observed=snapshot();
      const verifiedReadback=verifyAppliedCommitReadback({receipt,snapshot:observed,
        organizationId:current.organizationId,workspaceId:current.workspaceId,
        acceptanceId,revisionIds});
      bind(binding);
      return {...receipt,verifiedReadback};
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
