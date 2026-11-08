import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath,stat} from 'node:fs/promises';
import {basename} from 'node:path';
import {validateReleaseInput,verifyReleaseArtifact} from './release-verification.mjs';

const run=promisify(execFile);
export const OFFLINE_SOURCE_SCHEMA='IWXA_PUBLISHER_OFFLINE_SOURCE_CHECK/1';
export const OFFLINE_MIRRORS_SCHEMA='IWXA_PUBLISHER_OFFLINE_COPIES_CHECK/1';
export class ReleaseOriginError extends Error {
 constructor(code){super(code);this.name='ReleaseOriginError';this.code=code;}
}
const reject=code=>{throw new ReleaseOriginError(code);};
async function git(root,...args){
 try{
  const {stdout}=await run('git',['-C',root,...args],{timeout:10000,maxBuffer:1024*1024,windowsHide:true});
  return stdout.trim();
 }catch{reject('SOURCE_GIT_NOT_AVAILABLE_OR_FAILED');}
}
function remoteRepository(value){
 if(typeof value!=='string'||value.includes('@')&&!value.startsWith('git@github.com:')&&!value.startsWith('ssh://git@github.com/'))reject('SOURCE_REMOTE_UNRECOGNIZED');
 const match=/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(value);
 if(!match)reject('SOURCE_REMOTE_UNRECOGNIZED');
 return match[1].toLowerCase();
}
/**
 * Checks an independently provided local clean checkout at the claimed exact
 * HEAD and tree. This is NOT build provenance, release approval or a signature.
 */
export async function verifySourceCheckout(input,sourceDirectory){
 const claim=validateReleaseInput(input);
 if(typeof sourceDirectory!=='string'||sourceDirectory.length===0)reject('SOURCE_DIRECTORY_REQUIRED');
 const root=await realpath(sourceDirectory);
 const actualRoot=await git(root,'rev-parse','--show-toplevel');
 if(await realpath(actualRoot)!==root)reject('SOURCE_NOT_REPOSITORY_ROOT');
 const remote=remoteRepository(await git(root,'remote','get-url','origin'));
 if(remote!==claim.source.repository.toLowerCase())reject('SOURCE_REMOTE_MISMATCH');
 const head=await git(root,'rev-parse','--verify','HEAD');
 if(head!==claim.source.commit)reject('SOURCE_HEAD_MISMATCH');
 const tree=await git(root,'rev-parse','--verify','HEAD^{tree}');
 if(tree!==claim.source.tree)reject('SOURCE_TREE_MISMATCH');
 if(await git(root,'status','--porcelain=v1','--untracked-files=normal')!=='')reject('SOURCE_WORKTREE_DIRTY');
 return Object.freeze({
  schema:OFFLINE_SOURCE_SCHEMA,
  result:'CLEAN_HEAD_AND_TREE_MATCH',
  repository:claim.source.repository,
  commit:head,
  tree,
  buildProvenanceVerified:false,
  publisherAuthorized:false
 });
}
/**
 * Independently streams two physically separate copies, each of which must
 * match the same claimed SHA-256. Does not prove mirror availability or trust.
 */
export async function verifyTwoOfflineCopies(input,filePaths){
 const claim=validateReleaseInput(input);
 if(!Array.isArray(filePaths)||filePaths.length!==2)reject('MIRROR_EXACTLY_TWO_COPIES_REQUIRED');
 if(filePaths.some(p=>typeof p!=='string'||basename(p)!==claim.artifact.name))reject('MIRROR_FILENAME_INVALID');
 const [first,second]=await Promise.all(filePaths.map(p=>realpath(p)));
 if(first===second)reject('MIRROR_NOT_INDEPENDENT');
 const [a,b]=await Promise.all([stat(first),stat(second)]);
 if(a.dev===b.dev&&a.ino===b.ino)reject('MIRROR_SAME_FILE');
 // Deliberately serial to limit memory while checking large binaries.
 const one=await verifyReleaseArtifact(claim,first);
 const two=await verifyReleaseArtifact(claim,second);
 if(one.outcome!=='BYTE_MATCH'||two.outcome!=='BYTE_MATCH')reject('MIRROR_MISMATCH');
 return Object.freeze({
  schema:OFFLINE_MIRRORS_SCHEMA,
  result:'TWO_COPIES_MATCH_CLAIMED_BYTES',
  name:claim.artifact.name,size:one.artifact.size,sha256:one.artifact.sha256,
  copiesChecked:2,mirrorPublicationVerified:false,
  publisherAuthorized:false,releaseMetadataSignatureVerified:false
 });
}
