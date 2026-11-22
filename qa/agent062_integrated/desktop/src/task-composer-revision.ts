/** Verify a Task Composer projection against what the user meant to save.
 * Digest revisions are owned by Python Core. This helper does not hash text,
 * create a store, retry a command, or grant any Task/file permission.
 */
import type {RecoveredTaskComposer,RecoveredTaskSource,RecoveredTaskAttachment} from './task-composer-readback';

export type ComposerEditableSnapshot={
 text:string;knowledge_sources:readonly RecoveredTaskSource[];
 attachments:readonly RecoveredTaskAttachment[];
 local_model:unknown;
};

export const composerDigestVerified=(digest:unknown):digest is string=>
 typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest);

const sources=(items:readonly RecoveredTaskSource[])=>
 items.map(s=>[s.path,s.expected_sha256,s.title,s.provider_id??null,s.binding_digest??null]);
const attachments=(items:readonly RecoveredTaskAttachment[])=>
 items.map(a=>[a.name,a.text]);
const model=(value:unknown)=>{
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return typeof v.name==='string'&&typeof v.digest==='string'
  ?[v.name,v.digest.toLowerCase().replace(/^sha256:/,'')]:false;
};

/** An exact semantic match is required after an unknown save acknowledgement.
 * Pending-submission markers must be checked separately by their owner.
 */
export function composerEditableMatches(
 saved:RecoveredTaskComposer,snapshot:ComposerEditableSnapshot,
):boolean{
 return saved.state==='SAVED'&&composerDigestVerified(saved.draft_digest)
  &&saved.text===snapshot.text
  &&JSON.stringify(sources(saved.knowledge_sources))===JSON.stringify(sources(snapshot.knowledge_sources))
  &&JSON.stringify(attachments(saved.attachments))===JSON.stringify(attachments(snapshot.attachments))
  &&JSON.stringify(model(saved.local_model))===JSON.stringify(model(snapshot.local_model));
}
