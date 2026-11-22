import {compareDocumentRevisions} from './k01-document-change-preview.mjs';
const HEX=/^[a-f0-9]{64}$/;
const TASK=/^TASK-[A-Za-z0-9_-]+$/,SNAP=/^CSN-[A-Za-z0-9_-]+$/;
const PATH=/^attachments\/[0-9]{2}-[\w.-]{1,120}$/;
function validName(name){
 return typeof name==='string'&&name.length>0&&name.length<=120&&
  name===name.normalize('NFC')&&/^[\p{L}\p{N}_ .()-]+$/u.test(name)&&
  !name.includes('..')&&!/[. ]$/.test(name)&&
  !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)&&
  /\.(txt|md|csv|json)$/i.test(name);
}
async function digest(bytes){
 if(!globalThis.crypto?.subtle)throw Error('k01_preview_crypto_unavailable');
 return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),
  value=>value.toString(16).padStart(2,'0')).join('');
}
const assertActive=current=>{if(!current())throw Error('k01_preview_superseded');};
/** Read the immutable old attachment from the *existing Task* via Core. The
 * user's new File is not owner-authorized and never becomes accepted here.
 */
export async function compareTaskAttachmentWithFile(port,identity,file,{isCurrent=()=>true}={}){
 if(!port||typeof port.query!=='function'||typeof isCurrent!=='function'||
    !TASK.test(identity?.taskId??'')||!SNAP.test(identity?.snapshotId??'')||
    !PATH.test(identity?.path??'')||!HEX.test(identity?.sha256??''))
  throw Error('k01_preview_identity_invalid');
 if(!file||!validName(file.name)||!Number.isSafeInteger(file.size)||
    file.size<1||file.size>48000||typeof file.arrayBuffer!=='function')
  throw Error('k01_preview_file_invalid');
 assertActive(isCurrent);
 const raw=await file.arrayBuffer();
 assertActive(isCurrent);
 if(!(raw instanceof ArrayBuffer)||raw.byteLength!==file.size||raw.byteLength>48000)
  throw Error('k01_preview_file_changed');
 let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw Error('k01_preview_file_not_utf8');}
 if(!text.trim()||text.includes('\0'))throw Error('k01_preview_file_invalid');
 const currentSha=await digest(raw);
 assertActive(isCurrent);
 const saved=await port.query('task_document_source',{
  task_id:identity.taskId,snapshot_id:identity.snapshotId,
  path:identity.path,expected_sha256:identity.sha256});
 assertActive(isCurrent);
 if(!saved||saved.task_id!==identity.taskId||saved.snapshot_id!==identity.snapshotId||
    saved.path!==identity.path||saved.sha256!==identity.sha256||
    typeof saved.text!=='string')throw Error('k01_preview_saved_source_mismatch');
 if(await digest(new TextEncoder().encode(saved.text))!==identity.sha256)
  throw Error('k01_preview_saved_digest_mismatch');
 assertActive(isCurrent);
 return {authority:'PREVIEW_ONLY',oldSha256:identity.sha256,
  oldFile:{text:saved.text,bytes:new TextEncoder().encode(saved.text).byteLength},
  newFile:{name:file.name,sha256:currentSha,bytes:raw.byteLength,text},
  comparison:compareDocumentRevisions(saved.text,text)};
}
