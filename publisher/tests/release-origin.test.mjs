import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,link,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifySourceCheckout,verifyTwoOfflineCopies} from '../src/release-origin.mjs';
import {RELEASE_INPUT_SCHEMA} from '../src/release-verification.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'iwxa-publisher-source-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=join(dir,'source');await mkdir(root);
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Publisher Tests');
 git('remote','add','origin','https://github.com/Faust-S/Center.git');
 await writeFile(join(root,'README.txt'),'source');
 git('add','README.txt');git('commit','-qm','source');
 const bytes=Buffer.from('publisher binary test');
 const a=join(dir,'site-a'),b=join(dir,'site-b');await mkdir(a);await mkdir(b);
 await writeFile(join(a,'ProductSetup.exe'),bytes);await writeFile(join(b,'ProductSetup.exe'),bytes);
 const claim={
  schema:RELEASE_INPUT_SCHEMA,productId:'IWXA_ADMIN_CENTER',version:'0.3.0',
  platform:'windows-x64',
  source:{repository:'Faust-S/Center',commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')},
  artifact:{name:'ProductSetup.exe',size:bytes.length,sha256:digest(bytes)}
 };
 return {root,git,a:join(a,'ProductSetup.exe'),b:join(b,'ProductSetup.exe'),bytes,claim};
}
test('same claimed source checkout is proven clean at exact head/tree, not proven built from source',async t=>{
 const f=await fixture(t);
 const result=await verifySourceCheckout(f.claim,f.root);
 assert.equal(result.result,'CLEAN_HEAD_AND_TREE_MATCH');
 assert.equal(result.publisherAuthorized,false);
 assert.equal(result.buildProvenanceVerified,false);
 assert.equal(result.commit,f.claim.source.commit);
});
test('rejects dirty checkout, changed commit and forged origin',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.root,'README.txt'),'modified');
 await assert.rejects(verifySourceCheckout(f.claim,f.root),{code:'SOURCE_WORKTREE_DIRTY'});
 f.git('checkout','--','README.txt');
 await assert.rejects(verifySourceCheckout({...f.claim,source:{...f.claim.source,commit:'a'.repeat(40)}},f.root),{code:'SOURCE_HEAD_MISMATCH'});
 await assert.rejects(verifySourceCheckout({...f.claim,source:{...f.claim.source,tree:'b'.repeat(40)}},f.root),{code:'SOURCE_TREE_MISMATCH'});
 f.git('remote','set-url','origin','https://github.com/Somebody/Other.git');
 await assert.rejects(verifySourceCheckout(f.claim,f.root),{code:'SOURCE_REMOTE_MISMATCH'});
});
test('two independent offline files match exact expected bytes without claiming distribution',async t=>{
 const f=await fixture(t);
 const result=await verifyTwoOfflineCopies(f.claim,[f.a,f.b]);
 assert.equal(result.result,'TWO_COPIES_MATCH_CLAIMED_BYTES');
 assert.equal(result.copiesChecked,2);
 assert.equal(result.publisherAuthorized,false);
 assert.equal(result.mirrorPublicationVerified,false);
 assert.equal(result.releaseMetadataSignatureVerified,false);
});
test('rejects duplicate paths, hardlinks, altered second copy and wrong claimed digest',async t=>{
 const f=await fixture(t);
 await assert.rejects(verifyTwoOfflineCopies(f.claim,[f.a,f.a]),{code:'MIRROR_NOT_INDEPENDENT'});
 const hard=join(f.root,'ProductSetup.exe');
 await link(f.a,hard);
 await assert.rejects(verifyTwoOfflineCopies(f.claim,[f.a,hard]),{code:'MIRROR_SAME_FILE'});
 await writeFile(f.b,Buffer.from('tampered bytes'));
 await assert.rejects(verifyTwoOfflineCopies(f.claim,[f.a,f.b]));
 await assert.rejects(verifyTwoOfflineCopies({...f.claim,artifact:{...f.claim.artifact,sha256:'0'.repeat(64)}},[f.a,f.b]));
});

test('offline release CLI returns the exact two-copy and source evidence with no approval',async t=>{
 const f=await fixture(t);
 const manifest=join(dirname(f.root),'input.json');
 await writeFile(manifest,JSON.stringify(f.claim));
 const r=execFileSync(process.execPath,['publisher/bin/verify-offline-release.mjs',manifest,f.root,f.a,f.b],{encoding:'utf8'});
 const output=JSON.parse(r);
 assert.equal(output.result,'SOURCE_CHECKOUT_AND_TWO_COPIES_CHECKED_NOT_RELEASE_APPROVED');
 assert.equal(output.releaseApproved,false);
 assert.equal(output.source.buildProvenanceVerified,false);
 assert.equal(output.copies.mirrorPublicationVerified,false);
 assert.equal(output.copies.copiesChecked,2);
});
