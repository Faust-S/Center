// Center calls the original Atlas native CAS store, never a second project
// database. The selected organization is only a local scope until T3 admits it.
import {deserialize, serialize, createProject, createItem} from '../vendor/atlas/src/core.mjs';
import {readAtlasPortfolio} from './atlas-integration.mjs';
import {organizationPlanProjection,organizationWorkEditionComparison} from '../vendor/atlas/src/organization-plan-projection.mjs';

// Read the actual observed native head. Calculation belongs to Atlas, not Center.
export function readNativeAtlasPlan(session,projectId){
 if(!['CENTER_LOCAL_PREPARATION','PUBLIC_ATLAS_READ_ONLY'].includes(session?.sourceKind))
  fail('ATLAS_NATIVE_SESSION_INVALID');
 return organizationPlanProjection(session.snapshot,projectId);
}

const fail = code => {throw Error(code);};
const validOrganizationId = id => typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const row = x => x!==null&&typeof x==='object'&&!Array.isArray(x)?x:null;
// serde_json::Value in the original Atlas Rust store sorts JSON object keys.
// The Rust roundtrip is semantically lossless but may reorder every object,
// so textual JSON.stringify equality creates false write failures in WebView2.
// Arrays and values remain order-sensitive. This is readback comparison only:
// generation, revision, and native content validation remain mandatory.
const canonicalJson = value => JSON.stringify(value, (_, entry) =>
  row(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])) : entry
);

export function createNativeAtlasPort(invoke) {
  if(typeof invoke!=='function')fail('ATLAS_NATIVE_INVOKE_REQUIRED');
  async function open(organizationId) {
    if(!validOrganizationId(organizationId))fail('ATLAS_ORGANIZATION_INVALID');
    const result=row(await invoke('center_atlas_open',{organizationId}));
    if(!result||typeof result.generation!=='string'||typeof result.needsConfirmation!=='boolean')
      fail('ATLAS_NATIVE_READBACK_INVALID');
    const snapshot=deserialize(JSON.stringify(result.snapshot));
    if(result.needsConfirmation)fail('ATLAS_NATIVE_REQUIRES_RECOVERY');
    return {organizationId,generation:result.generation,snapshot,sourceKind:'CENTER_LOCAL_PREPARATION'};
  }
  // Same-user, fixed-path Atlas Desktop source, with no commit capability.
  async function openPublicAtlas(organizationId) {
    if(!validOrganizationId(organizationId))fail('ATLAS_ORGANIZATION_INVALID');
    const result=row(await invoke('center_atlas_public_open',{}));
    if(!result||typeof result.generation!=='string'||result.generation==='none'||
       typeof result.needsConfirmation!=='boolean')fail('ATLAS_PUBLIC_READBACK_INVALID');
    if(result.needsConfirmation)fail('ATLAS_PUBLIC_RECOVERY_REQUIRED');
    const snapshot=deserialize(JSON.stringify(result.snapshot));
    return {organizationId,generation:result.generation,snapshot,
      sourceKind:'PUBLIC_ATLAS_READ_ONLY'};
  }
  // The history request is read-only and tied to the very same observed
  // installed Atlas generation; never use Center preparation as history.
  /** @param {any} session
   * @param {{projectId:string,workId:string,revision:string}} ref */
  async function comparePublicAtlasWork(session,ref){
    if(session?.sourceKind!=='PUBLIC_ATLAS_READ_ONLY')
      fail('ATLAS_PUBLIC_SOURCE_READ_ONLY');
    if(!validOrganizationId(session.organizationId)||typeof session.generation!=='string'||
      !session.generation||session.generation==='none'||typeof ref?.revision!=='string'||
      !/^(0|[1-9][0-9]*)$/.test(ref.revision)||!Number.isSafeInteger(Number(ref.revision)))
      fail('ATLAS_HISTORY_REQUEST_INVALID');
    const current=session.snapshot;
    if(String(current.revision)===ref.revision)
      return organizationWorkEditionComparison(current,current,ref);
    const result=await invoke('center_atlas_public_revision',{
      expectedGeneration:session.generation,revision:Number(ref.revision)});
    if(result===null)return organizationWorkEditionComparison(current,null,ref);
    if(!row(result)||typeof result.generation!=='string'||!result.generation||
      result.generation===session.generation||result.generation==='none'||
      result.needsConfirmation!==false||result.restoredFromBackup!==false)
      fail('ATLAS_HISTORY_READBACK_INVALID');
    const original=deserialize(JSON.stringify(result.snapshot));
    if(String(original.revision)!==ref.revision)fail('ATLAS_HISTORY_EDITION_MISMATCH');
    return organizationWorkEditionComparison(current,original,ref);
  }
  async function commit(session,nextSnapshot) {
    if(session?.sourceKind!=='CENTER_LOCAL_PREPARATION')
      fail('ATLAS_PUBLIC_SOURCE_READ_ONLY');
    if(!session||!validOrganizationId(session.organizationId)||typeof session.generation!=='string')
      fail('ATLAS_NATIVE_SESSION_INVALID');
    const snapshot=deserialize(serialize(nextSnapshot));
    if(snapshot.revision<=session.snapshot.revision)fail('ATLAS_REVISION_NOT_INCREASED');
    const expected=canonicalJson(snapshot);
    let receipt,writeError;
    try {
      receipt=await invoke('center_atlas_commit',{
        organizationId:session.organizationId,
        expectedGeneration:session.generation,snapshot
      });
    } catch(e){writeError=e;}
    let opened;
    try {opened=await open(session.organizationId);}
    catch(e){if(writeError)throw writeError;throw e;}
    // A failed/lost acknowledgement is not permission to repeat the write.
    if(canonicalJson(opened.snapshot)!==expected) {
      if(writeError)throw writeError;
      fail('ATLAS_NATIVE_READBACK_MISMATCH');
    }
    if(receipt&&receipt.generation!==opened.generation)
      fail('ATLAS_NATIVE_GENERATION_MISMATCH');
    if(!receipt&&opened.generation===session.generation)
      fail('ATLAS_NATIVE_UNCONFIRMED_WRITE');
    return opened;
  }
  function view(session) {
    const output=readAtlasPortfolio(serialize(session.snapshot));
    if(!['CENTER_LOCAL_PREPARATION','PUBLIC_ATLAS_READ_ONLY'].includes(session?.sourceKind))
      fail('ATLAS_NATIVE_SESSION_INVALID');
    return {...output,
      mode:session.sourceKind==='PUBLIC_ATLAS_READ_ONLY'
        ? 'NATIVE_ATLAS_PUBLIC_READ_ONLY':'NATIVE_ATLAS_LOCAL_ORGANIZATION',
      authorization:'NOT_CHECKED'};
  }
  async function exportPreparation(session){
    if(session?.sourceKind!=='CENTER_LOCAL_PREPARATION')fail('ATLAS_PUBLIC_SOURCE_READ_ONLY');
    const actual=await open(session.organizationId);
    if(actual.generation==='none'||actual.generation!==session.generation||
       canonicalJson(actual.snapshot)!==canonicalJson(session.snapshot))
      fail('ATLAS_PREPARATION_CHANGED_BEFORE_EXPORT');
    if(!actual.snapshot.projects.length)fail('ATLAS_PREPARATION_EMPTY');
    const {buildIwxaPortfolio,toBase64}=await import('../vendor/atlas/desktop/src/iwxa-portfolio.mjs');
    const bytes=await buildIwxaPortfolio(actual.snapshot);
    const result=await invoke('center_atlas_export_iwxa',{
      organizationId:session.organizationId,expectedGeneration:actual.generation,
      archiveBase64:toBase64(bytes)
    });
    if(result!==null&&typeof result!=='string')fail('ATLAS_EXPORT_RECEIPT_INVALID');
    return result;
  }
  return Object.freeze({
    open,openPublicAtlas,comparePublicAtlasWork,commit,view,exportPreparation,
    async addProject(session,{name,type='business'}) {
      if(session?.sourceKind!=='CENTER_LOCAL_PREPARATION')fail('ATLAS_PUBLIC_SOURCE_READ_ONLY');
      const next=createProject(session.snapshot,{name,type});
      const saved=await commit(session,next.state);
      return {session:saved,projectId:next.id};
    },
    async addWork(session,{projectId,title}) {
      if(session?.sourceKind!=='CENTER_LOCAL_PREPARATION')fail('ATLAS_PUBLIC_SOURCE_READ_ONLY');
      const next=createItem(session.snapshot,projectId,{title});
      const saved=await commit(session,next.state);
      return {session:saved,workId:next.id};
    }
  });
}
