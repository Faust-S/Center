import {readAppliedResults} from './cen03-applied-results.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

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
