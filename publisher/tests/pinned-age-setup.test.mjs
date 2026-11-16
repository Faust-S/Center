import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,truncateSync,
  existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AGE_SETUP_FILES,stagePinnedAgeResources}
  from '../src/pinned-age-setup.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'iwxa-age-pinned-source-'));
  const input=join(root,'source'),dest=join(root,'destination');
  mkdirSync(input);mkdirSync(dest);
  // Opaque fake bytes test the packaging contract, not age or T3 execution.
  const data={
    'iwxa-t3-age-desktop.exe':Buffer.from('NOT_A_SIGNER_OR_RUNTIME'),
    'age.exe':Buffer.from('NOT_AGE_BINARY_1.3.1'),
    'age-keygen.exe':Buffer.from('NOT_AGE_KEYGEN_BINARY'),
  };
  const hashes=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,sha(v)]));
  data['age-toolchain.json']=Buffer.from(JSON.stringify({
    schema:'IWXA_T3_AGE_PINNED_TOOLCHAIN/1',
    ageSha256:hashes['age.exe'],ageKeygenSha256:hashes['age-keygen.exe']
  }));
  hashes['age-toolchain.json']=sha(data['age-toolchain.json']);
  const files=Object.fromEntries(AGE_SETUP_FILES.map(k=>[k,join(input,k)]));
  for(const name of AGE_SETUP_FILES)writeFileSync(files[name],data[name]);
  return {root,input,dest,files,pins:hashes,
    cleanup:()=>rmSync(root,{force:true,recursive:true})};
}
test('only four independently pinned original age files are staged, never private keys',async()=>{
  const x=fixture();
  try{
    const result=await stagePinnedAgeResources({
      directory:x.dest,files:x.files,pins:x.pins
    });
    assert.deepEqual(result.files.map(y=>y.name),AGE_SETUP_FILES);
    assert.equal(result.fileCount,4);
    assert.equal(result.runtimeQualified,false);
    assert.equal(result.admitted,false);
    assert.equal(result.delivered,false);
    for(const name of AGE_SETUP_FILES)
      assert.equal(sha(readFileSync(join(x.dest,name))),x.pins[name]);
    assert.ok(!existsSync(join(x.dest,'keys.vault.json')));
    assert.ok(!existsSync(join(x.dest,'publisher-person-trust.json')));
  }finally{x.cleanup();}
});
test('wrong standalone SHA and wrong manifest SHA fail before staging any files',async()=>{
  for(const caseName of ['tool','manifest']){
    const x=fixture();
    try{
      const pins={...x.pins};
      pins[caseName==='tool'?'age.exe':'age-toolchain.json']='f'.repeat(64);
      await assert.rejects(stagePinnedAgeResources({
        directory:x.dest,files:x.files,pins
      }),/PUBLISHER_AGE_SETUP_SOURCE_PIN_MISMATCH/);
      assert.ok(AGE_SETUP_FILES.every(n=>!existsSync(join(x.dest,n))));
    }finally{x.cleanup();}
  }
});
test('manifest must bind original age and age-keygen to independently pinned bytes',async()=>{
 const x=fixture();
 try{
  writeFileSync(x.files['age-toolchain.json'],JSON.stringify({
    schema:'IWXA_T3_AGE_PINNED_TOOLCHAIN/1',
    ageSha256:'a'.repeat(64),ageKeygenSha256:x.pins['age-keygen.exe']
  }));
  x.pins['age-toolchain.json']=sha(readFileSync(x.files['age-toolchain.json']));
  await assert.rejects(stagePinnedAgeResources({
    directory:x.dest,files:x.files,pins:x.pins
  }),/PUBLISHER_AGE_SETUP_ORIGINAL_MANIFEST_PINS_MISMATCH/);
  assert.ok(AGE_SETUP_FILES.every(n=>!existsSync(join(x.dest,n))));
 }finally{x.cleanup();}
});
test('reject incomplete toolchain and accidental overwrite of existing Setup Core stage',async()=>{
 const x=fixture();
 try{
  const missing={...x.files};
  delete missing['age-keygen.exe'];
  await assert.rejects(stagePinnedAgeResources({
    directory:x.dest,files:missing,pins:x.pins
  }),/PUBLISHER_AGE_SETUP_EXACT_FOUR_PINNED_FILES_REQUIRED/);
  writeFileSync(join(x.dest,'age.exe'),'EXISTING_FILE_NOT_TO_REPLACE');
  await assert.rejects(stagePinnedAgeResources({
    directory:x.dest,files:x.files,pins:x.pins
  }),/PUBLISHER_AGE_SETUP_DESTINATION_ALREADY_EXISTS/);
  assert.equal(readFileSync(join(x.dest,'age.exe'),'utf8'),
    'EXISTING_FILE_NOT_TO_REPLACE');
 }finally{x.cleanup();}
});
test('no source symlink may substitute an externally pinned original T3 tool',async t=>{
 const x=fixture();
 try{
  const substitute=join(x.input,'linked-age.exe');
  try{symlinkSync(x.files['age.exe'],substitute,'file');}
  catch(e){
    if(e.code==='EPERM'||e.code==='EACCES'){
      t.skip('local filesystem disallows symbolic links');
      return;
    }
    throw e;
  }
  await assert.rejects(stagePinnedAgeResources({
    directory:x.dest,
    files:{...x.files,'age.exe':substitute},pins:x.pins
  }),/PUBLISHER_AGE_SETUP_SOURCE_FILE_INVALID/);
 }finally{x.cleanup();}
});

test('original age binaries larger than T3 native 64 MiB limit are rejected before copying',async()=>{
 const x=fixture();
 try{
  truncateSync(x.files['age.exe'],64*1024*1024+1);
  await assert.rejects(stagePinnedAgeResources({
    directory:x.dest,files:x.files,pins:x.pins
  }),/PUBLISHER_AGE_SETUP_SOURCE_FILE_INVALID/);
  assert.ok(AGE_SETUP_FILES.every(n=>!existsSync(join(x.dest,n))));
 }finally{x.cleanup();}
});
test('installed Setup Core contract supports both original owner and optional age toolchain',()=>{
 const driver=readFileSync('publisher/tests/installed-setupcore-publisher.ps1','utf8');
 const rust=readFileSync('native/t3_age_transport.rs','utf8');
 assert.match(driver,/PUBLISHER_AGE_PARTIAL_RUNTIME_DENIED/);
 assert.match(driver,/PUBLISHER_AGE_INDEPENDENT_RELEASE_SHA256_REQUIRED/);
 assert.match(driver,/pinned-age-setup\.mjs/);
 assert.match(driver,/\$expectedFiles=6/);
 assert.match(driver,/Assert-InstalledAgeFiles \$payload/);
 assert.equal((driver.match(/Assert-InstalledAgeFiles \$root/g)||[]).length,2);
 assert.match(driver,/PUBLISHER_TWO_FILE_TRANSPORT_ONLY_PASS/);
 assert.match(driver,/ageRuntimeQualified=\$false/);
 for(const file of AGE_SETUP_FILES){
  assert.ok(driver.includes(file),file);
  assert.ok(rust.includes(file),file);
 }
 assert.doesNotMatch(driver,/generateVaultKey|importVaultKey|newSigner|PRIVATE KEY/);
});
