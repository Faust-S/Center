import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {createDraftRepository} from '../runtime/t3-draft-repository.mjs';
import {emptyDraft, applyDraftCommand} from '../src/organization.mjs';
const source=process.env.IWXA_T3_SUBJECT_STORE_MODULE;
test('exact owning T3 Store: save, close, reopen, readback and stale-write rejection', {skip:!source && 'Owning T3 module is not supplied to public CI'}, async()=>{
  const bytes=readFileSync(source),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(blob,'d2c1ffeff55c66411caf5d52001f4855583ee6bf');
  const {openSubjectScopedStore}=await import(pathToFileURL(source).href);
  const root=mkdtempSync(join(tmpdir(),'center-t3-'));
  const options={baseDir:root,scope:{schema:'IWXA_T3_SUBJECT_STORAGE_SCOPE/1',subjectType:'PERSON',subjectId:'planner',workspaceId:'preparation',dataRootId:'draft-root',organizationId:null,realmId:null,issuerAuthorityId:null},keyId:'draft-key',encryptionKey:randomBytes(32)};
  try{
    const first=createDraftRepository(openSubjectScopedStore(options));
    const draft=applyDraftCommand(emptyDraft(),{type:'CREATE_ORGANIZATION',name:'Offline group'});
    assert.equal(first.save(draft,0).revision,1);first.close();
    const second=createDraftRepository(openSubjectScopedStore(options));
    assert.deepEqual(second.load().draft,draft);
    assert.throws(()=>second.save(draft,0),/SUBJECT_CONCURRENT_REVISION/);
    second.close();
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import {pathToFileURL} from 'node:url';
      const {openSubjectScopedStore}=await import(pathToFileURL(process.env.IWXA_T3_SUBJECT_STORE_MODULE).href);
      const options=JSON.parse(process.env.CENTER_TEST_OPTIONS);
      options.encryptionKey=Buffer.from(options.encryptionKey,'base64');
      const store=openSubjectScopedStore(options);
      process.stdout.write(Buffer.from(store.read().bytes).toString('utf8'));store.close();
    `],{encoding:'utf8',env:{...process.env,CENTER_TEST_OPTIONS:JSON.stringify({...options,encryptionKey:options.encryptionKey.toString('base64')})}});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),draft);

  }finally{rmSync(root,{recursive:true,force:true});}
});
