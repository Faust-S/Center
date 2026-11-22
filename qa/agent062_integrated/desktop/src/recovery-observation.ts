/** Read-only presentation guard for a single Core recovery observation. */
export type RecoveryObservationLevel='INVALID'|'UNKNOWN_ONLY'|'READABLE';
type Row=Record<string,unknown>;
const row=(value:unknown):Row|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:null;
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const readableStates=['MATCHES_PROPOSAL','MATCHES_PREVIOUS','OTHER_CONTENT'];
const unavailableStates=['NOT_FOUND','UNAVAILABLE','WORKSPACE_CHANGED','WORKSPACE_UNAVAILABLE'];

/** A matching live file never proves whether a past write happened.
 * READABLE permits inspection of current content and an independent
 * historical evidence statement before the person makes a terminal decision.
 */
export function recoveryObservationLevel(value:unknown,caseId:string,planId:string):RecoveryObservationLevel{
 const v=row(value);
 if(!v||!/^REPAIR-[A-Za-z0-9_-]+$/.test(caseId)||!/^TPLAN-[A-Za-z0-9-]+$/.test(planId)
    ||v.case_id!==caseId||v.plan_id!==planId||v.authority!=='READ_ONLY_OBSERVATION'
    ||v.outcome_proven!==false||v.retry_authorized!==false||v.provider_invoked_for_write!==false
    ||typeof v.path!=='string'||!v.path||!['create','replace'].includes(String(v.mode))
    ||typeof v.planned_text!=='string'||!sha(v.planned_sha256)
    ||(v.mode==='replace'&&!sha(v.previous_sha256)))return 'INVALID';
 const state=String(v.current_state);
 if(unavailableStates.includes(state))return v.current_sha256===null?'UNKNOWN_ONLY':'INVALID';
 if(!readableStates.includes(state)||!sha(v.current_sha256)||typeof v.current_text!=='string')return 'INVALID';
 if(state==='MATCHES_PROPOSAL'&&v.current_sha256!==v.planned_sha256)return 'INVALID';
 if(state==='MATCHES_PREVIOUS'&&(v.mode!=='replace'||v.current_sha256!==v.previous_sha256))return 'INVALID';
 if(state==='OTHER_CONTENT'&&(v.current_sha256===v.planned_sha256||v.current_sha256===v.previous_sha256))return 'INVALID';
 return 'READABLE';
}
