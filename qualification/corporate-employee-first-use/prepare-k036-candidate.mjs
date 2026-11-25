// Rebuild only the previously qualified exact candidate. Disposable Windows CI.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const t2=resolve('private-t2'),core=resolve('one-core');
const sourcePin='4e4ad5c5e566a74f24243b9d0744a6d64652a199';
const packagingDir='t2/current/final-successor/kernel-successors/k036-canonical-event-merge-20261125';
const expectedId='iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1',expectedArchive='5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a';
let temp=null,output=null,ownsOutput=false;
const fail=code=>{throw Error(code)};
const need=(ok,code)=>{if(!ok)fail(code)};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const run=(cmd,args,cwd,env=process.env)=>{
  const result=spawnSync(cmd,args,{cwd,env,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
  return {code:result.status,output:(result.stdout??'')+'\n'+(result.stderr??'')};
};
function step(label,cmd,args,cwd,env){
  const r=run(cmd,args,cwd,env);
  if(r.code!==0){
    // Only bounded machine code families from the original source generator
    // and compiler; no raw exception messages, paths or private diagnostics.
    const codes=new Set([...r.output.matchAll(/\b(?:K036_(?:CANONICAL_EVENT_MERGE|SAME_STORE|IMPORT_TIME)_[A-Z0-9_]{3,80}|TS[0-9]{4,5}|IMPORT_EVENT_ID_COLLISION)\b/g)].map(m=>m[0]));
    for(const code of [...codes].slice(0,12))console.log(label+'_DETAIL='+code);
    fail(label+'_FAILED');
  }
  console.log(label+'=PASS');
}
function npm(label,args,cwd){
  if(process.platform==='win32')
    step(label,'cmd.exe',['/d','/s','/c','npm '+args.join(' ')],cwd);
  else step(label,'npm',args,cwd);
}

try{
  need(process.platform==='win32'&&process.version==='v24.18.1'&&
    process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Faust-S/Center'&&
    process.env.GITHUB_REF==='refs/heads/work/2026-11-24-corporate-installed-one-core'&&
    process.env.RUNNER_ENVIRONMENT==='github-hosted'&&Boolean(process.env.RUNNER_TEMP),
    'K036_CENTER_DISPOSABLE_RUNNER_REQUIRED');
  need(process.env.T2_PIN==='c28e01876f3230307b7f20449f7ef54374367c93'&&process.env.CORE_PIN==='8db847058cab231d2d39c34df46024b60564d2ad'&&
    process.env.KERNEL_CANDIDATE_ID===expectedId&&process.env.KERNEL_CANDIDATE_ARCHIVE_SHA256===expectedArchive,
    'K036_CENTER_SOURCE_PIN_REQUIRED');
  for(const [root,pin] of [[t2,process.env.T2_PIN],[core,process.env.CORE_PIN]]){
    const got=run('git',['rev-parse','HEAD'],root),status=run('git',['status','--porcelain'],root);
    need(got.code===0&&got.output.trim()===pin&&status.code===0&&!status.output.trim(),
      'K036_CENTER_SOURCE_PIN_OR_CLEANLINESS_FAILED');
  }
  output=resolve(process.env.RUNNER_TEMP,'corporate-original-k036');
  need(!existsSync(output),'K036_CENTER_OUTPUT_NOT_FRESH');
  temp=mkdtempSync(join(process.env.RUNNER_TEMP,'corporate-k036-rebuild-'));
  const canonical=join(t2,'t2/current/final-successor/canonical-source');
  const predecessor=join(temp,'k035'),base=join(temp,'k036'),timestamp=join(temp,'k036-time'),
    candidate=join(temp,'k036-canonical-event-merge');
  const node=process.execPath;
  step('K036_RECONSTRUCT_K035',node,['scripts/materialize-k035-atomic-graph-successor.mjs',
    '../canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json',t2,predecessor],canonical);
  step('K036_RECONSTRUCT_K036',node,['scripts/materialize-k036-atomic-graph-qualified.mjs',predecessor,base],canonical);
  step('K036_RECONSTRUCT_TIMESTAMP',node,['scripts/create-k036-import-time-candidate.mjs',base,timestamp],canonical);
  step('K036_RECONSTRUCT_AND_PATCH_ORIGINAL',node,['scripts/create-k036-canonical-event-merge-candidate.mjs',
    timestamp,candidate],canonical);
  const identity=json(join(candidate,'CANONICAL_EVENT_MERGE_CANDIDATE.json'));
  need(identity.status==='SOURCE_PATCHED_UNQUALIFIED'&&identity.changedFiles?.length===1&&
    identity.changedFiles[0].path==='src/package/import/commit.ts','K036_SOURCE_PATCH_IDENTITY_INVALID');
  const change=identity.changedFiles[0],file=join(candidate,change.path),fixed=readFileSync(file);
  need(sha(fixed)===change.afterSha256,'K036_PATCHED_SOURCE_HASH_MISMATCH');
  npm('K036_DEPENDENCIES',['ci','--no-audit','--no-fund'],candidate);
  const corrected='if (canonicalize(existing) !== canonicalize(e)) {';
  const original='if (JSON.stringify(existing) !== JSON.stringify(e)) {';
  const text=fixed.toString('utf8');
  const count=identity.eventComparisonsChanged;
  need(Number.isInteger(count)&&count>=1&&count<=8&&text.split(corrected).length===count+1,'K036_BASELINE_RECONSTRUCTION_ANCHOR');
  console.log(`K036_EVENT_COMPARISONS_CHANGED=${count}`);
  const prior=Buffer.from(text.replaceAll(corrected,original),'utf8');
  need(sha(prior)===change.beforeSha256,'K036_BASELINE_SOURCE_HASH_MISMATCH');

  npm('K036_CANDIDATE_BUILD',['run','build'],candidate);
  const previous=json(join(t2,'t2/current/final-successor/kernel-successors/k036-same-store-event-history-20261019/ARTIFACT_IDENTITY.json'));
  need(previous.artifactId===identity.baseQualifiedArtifactId&&previous.releaseAccepted===true&&
    previous.files.length===4,'K036_PREVIOUS_ARTIFACT_IDENTITY_MISMATCH');
  const dist=join(candidate,'dist');
  const files=previous.files.map(row=>{
    const value=sha(readFileSync(join(dist,row.path)));
    if(row.path==='_iwxa/runtime/0.3.6/runtime.js')
      need(value!==row.sha256,'K036_CANDIDATE_RUNTIME_UNCHANGED');
    else need(value===row.sha256,'K036_CANDIDATE_UNRELATED_FILE_CHANGED');
    return {path:row.path,sha256:value};
  });
  const receipt={schema:'IWXA_K036_CANONICAL_EVENT_MERGE_BUILD_WITNESS/1',
    status:'SOURCE_AND_BUILD_PASS_CANDIDATE_UNACCEPTED',baseQualifiedArtifactId:identity.baseQualifiedArtifactId,
    sourceCommit:sourcePin,productionActivation:false,changedFiles:identity.changedFiles,files};
  const receiptPath=join(temp,'candidate-build-receipt.json');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');

  const corePackage=join(core,'packages/t3-core');
  const zip=join(corePackage,'qualified-runtime',identity.baseQualifiedArtifactId+'.zip');
  need(sha(readFileSync(zip))===previous.archiveSha256,'K036_PREVIOUS_ARCHIVE_SHA_MISMATCH');
  const artifactOut=join(temp,'candidate-archive'),packagingRoot=join(t2,packagingDir);
  const previousRoot=join(t2,'t2/current/final-successor/kernel-successors/k036-same-store-event-history-20261019');
  step('K036_CANDIDATE_ARCHIVE_STAGE','python',[join(packagingRoot,'prepare_k036_candidate_archive.py'),
    '--base-archive',zip,'--previous-identity',join(previousRoot,'ARTIFACT_IDENTITY.json'),
    '--candidate-dist',dist,'--build-receipt',receiptPath,'--output-dir',artifactOut],temp);
  const identityOut=json(join(artifactOut,'CANDIDATE_ARTIFACT_IDENTITY.json'));
  const candidateZip=join(artifactOut,expectedId+'.zip');
  need(identityOut.artifactId===expectedId&&identityOut.sourceCommit===sourcePin&&
    identityOut.releaseAccepted===false&&identityOut.productionActivation===false&&
    identityOut.archiveSha256===expectedArchive&&sha(readFileSync(candidateZip))===expectedArchive,
    'K036_CENTER_ARCHIVE_PIN_MISMATCH');
  ownsOutput=true;
  step('K036_CENTER_EXTRACT_CANDIDATE','python',['-c',
    'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',candidateZip,output],temp);
  const selector=await import(pathToFileURL(join(corePackage,'scripts/installed-kernel-candidate.mjs')).href);
  const verified=selector.assertQualificationKernelCandidate(output,expectedId);
  need(verified.archiveSha256===expectedArchive&&verified.releaseAccepted===false,
    'K036_CENTER_EXTRACTED_IDENTITY_INVALID');
  console.log('CORPORATE_INSTALLED_K036_CANDIDATE_ARCHIVE=PASS');
}catch(error){
  const code=String(error?.message??'');
  console.log(/^K036_[A-Z0-9_]{4,120}$/.test(code)?code:'K036_CENTER_REBUILD_UNCLASSIFIED_FAILURE');
  process.exitCode=1;
}finally{
  if(temp!==null)rmSync(temp,{recursive:true,force:true});
  if(process.exitCode&&ownsOutput)rmSync(output,{recursive:true,force:true});
}
