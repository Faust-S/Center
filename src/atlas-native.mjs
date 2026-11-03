// Center calls the original Atlas native CAS store, never a second project
// database. The selected organization is only a local scope until T3 admits it.
import {deserialize, serialize, createProject, createItem} from '../vendor/atlas/src/core.mjs';
import {readAtlasPortfolio} from './atlas-integration.mjs';

const fail = code => {throw Error(code);};
const validOrganizationId = id => typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const row = x => x!==null&&typeof x==='object'&&!Array.isArray(x)?x:null;

export function createNativeAtlasPort(invoke) {
  if(typeof invoke!=='function')fail('ATLAS_NATIVE_INVOKE_REQUIRED');
  async function open(organizationId) {
    if(!validOrganizationId(organizationId))fail('ATLAS_ORGANIZATION_INVALID');
    const result=row(await invoke('center_atlas_open',{organizationId}));
    if(!result||typeof result.generation!=='string'||typeof result.needsConfirmation!=='boolean')
      fail('ATLAS_NATIVE_READBACK_INVALID');
    const snapshot=deserialize(JSON.stringify(result.snapshot));
    if(result.needsConfirmation)fail('ATLAS_NATIVE_REQUIRES_RECOVERY');
    return {organizationId,generation:result.generation,snapshot};
  }
  async function commit(session,nextSnapshot) {
    if(!session||!validOrganizationId(session.organizationId)||typeof session.generation!=='string')
      fail('ATLAS_NATIVE_SESSION_INVALID');
    const snapshot=deserialize(serialize(nextSnapshot));
    if(snapshot.revision<=session.snapshot.revision)fail('ATLAS_REVISION_NOT_INCREASED');
    const expected=serialize(snapshot);
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
    if(serialize(opened.snapshot)!==expected) {
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
    return {...output,mode:'NATIVE_ATLAS_LOCAL_ORGANIZATION',authorization:'NOT_CHECKED'};
  }
  return Object.freeze({
    open,commit,view,
    async addProject(session,{name,type='business'}) {
      const next=createProject(session.snapshot,{name,type});
      const saved=await commit(session,next.state);
      return {session:saved,projectId:next.id};
    },
    async addWork(session,{projectId,title}) {
      const next=createItem(session.snapshot,projectId,{title});
      const saved=await commit(session,next.state);
      return {session:saved,workId:next.id};
    }
  });
}
