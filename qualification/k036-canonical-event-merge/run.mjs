// Public orchestration only. Private T2 source, output and raw diagnostics
// remain on the disposable hosted runner. No publish, upload or cache.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [t2Arg,coreArg,tempArg]=process.argv.slice(2);
const t2=resolve(t2Arg),core=resolve(coreArg),temp=resolve(tempArg);
let ownsTemp=false;
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
  need(r.code===0,label+'_FAILED');
  console.log(label+'=PASS');
}
function npm(label,args,cwd){
  if(process.platform==='win32')
    step(label,'cmd.exe',['/d','/s','/c','npm '+args.join(' ')],cwd);
  else step(label,'npm',args,cwd);
}
function report(path){
  need(existsSync(path),'K036_TEST_REPORT_MISSING');
  return json(path);
}
function tests(root,files,name,filter=null){
  const output=join(temp,name+'.json');
  const args=[join(root,'node_modules/vitest/vitest.mjs'),'run',...files,
    '--config','vitest.config.ts','--fileParallelism=false','--reporter=json','--outputFile='+output];
  if(filter)args.push('-t',filter);
  const r=run(process.execPath,args,root);
  return {...r,report:report(output)};
}
try{
  need(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Faust-S/Center'&&
    process.env.RUNNER_ENVIRONMENT==='github-hosted','K036_PUBLIC_DISPOSABLE_RUNNER_REQUIRED');
  need(/^[a-f0-9]{40}$/.test(process.env.T2_PIN??'')&&
    /^[a-f0-9]{40}$/.test(process.env.CORE_PIN??''),'K036_SOURCE_PINS_REQUIRED');
  for(const [root,pin] of [[t2,process.env.T2_PIN],[core,process.env.CORE_PIN]]){
    const got=run('git',['rev-parse','HEAD'],root);
    need(got.code===0&&got.output.trim()===pin,'K036_SOURCE_PIN_MISMATCH');
  }
  need(Boolean(process.env.RUNNER_TEMP)&&
    temp===resolve(process.env.RUNNER_TEMP,'iwxa-k036-canonical-event-merge')&&
    temp!==t2&&temp!==core&&!existsSync(temp),'K036_DISPOSABLE_TEMP_PATH_REQUIRED');
  mkdirSync(temp,{recursive:false});
  ownsTemp=true;
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
  need(text.split(corrected).length===2,'K036_BASELINE_RECONSTRUCTION_ANCHOR');
  const prior=Buffer.from(text.replace(corrected,()=>original),'utf8');
  need(sha(prior)===change.beforeSha256,'K036_BASELINE_SOURCE_HASH_MISMATCH');
  try{
    writeFileSync(file,prior);
    const baseline=tests(candidate,['tests/same-workspace-event-merge.test.ts'],'baseline',
      'roundtrips the original local Event');
    const failed=baseline.report.testResults.flatMap(r=>r.assertionResults??[])
      .filter(r=>r.status==='failed');
    need(baseline.code!==0&&baseline.report.numFailedTests===1&&failed.length===1&&
      failed[0].failureMessages?.some(m=>m.includes('IMPORT_EVENT_ID_COLLISION')),
      'K036_BASELINE_EXACT_COLLISION_NOT_REPRODUCED');
    console.log('K036_BASELINE_EXACT_COLLISION=CONFIRMED');
  }finally{writeFileSync(file,fixed)}
  need(sha(readFileSync(file))===change.afterSha256,'K036_FIXED_SOURCE_RESTORE_MISMATCH');
  const green=tests(candidate,['tests/same-workspace-event-merge.test.ts',
    'tests/same-store-event-history.test.ts','tests/import-commit-atomicity.test.ts',
    'tests/atomic-object-graph.test.ts'],'candidate');
  console.log('K036_CANDIDATE_TEST_COUNTS='+JSON.stringify({
    total:green.report.numTotalTests,passed:green.report.numPassedTests,failed:green.report.numFailedTests,
    pending:green.report.numPendingTests}));
  need(green.code===0&&green.report.numFailedTests===0&&green.report.numPassedTests>=43,
    'K036_CANDIDATE_REGRESSION_FAILED');
  npm('K036_CANDIDATE_TYPECHECK',['run','typecheck'],candidate);
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
    sourceCommit:process.env.T2_PIN,productionActivation:false,changedFiles:identity.changedFiles,files};
  const receiptPath=join(temp,'candidate-build-receipt.json');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log('K036_CANDIDATE_BUILD_RECEIPT='+JSON.stringify(receipt));
  const qualified=join(temp,'qualified-original'),corePackage=join(core,'packages/t3-core');
  // The existing exact accepted ZIP stays the input to product materializers.
  const zip=join(corePackage,'qualified-runtime',identity.baseQualifiedArtifactId+'.zip');
  need(sha(readFileSync(zip))===previous.archiveSha256,'K036_PREVIOUS_ARCHIVE_SHA_MISMATCH');
  step('K036_EXTRACT_IMMUTABLE_BASELINE','python',['-c',
    'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',zip,qualified],temp);
  const idb=join(candidate,'node_modules/fake-indexeddb/build/esm/index.js');
  need(existsSync(idb),'K036_TEST_INDEXEDDB_REQUIRED');
  const cross=run(node,['--test','--test-force-exit','tests/t3-company-original-runtime-roundtrip.test.mjs'],corePackage,
    {...process.env,IWXA_COMPANY_TEST_QUALIFIED_T2:qualified,IWXA_COMPANY_TEST_IDB_MODULE:idb,
      IWXA_COMPANY_TEST_CANDIDATE_T2:dist,IWXA_COMPANY_TEST_CANDIDATE_RECEIPT:receiptPath});
  const counts=Object.fromEntries([...cross.output.matchAll(/^# (tests|pass|fail|skipped) (\d+)\s*$/gm)]
    .map(m=>[m[1],Number(m[2])]));
  console.log('K036_ORIGINAL_CANDIDATE_CROSS_PRODUCT_COUNTS='+JSON.stringify(counts));
  if(cross.code!==0){
    // Only finite error code names. Never relay raw diagnostics.
    for(const code of ['IMPORT_EVENT_ID_COLLISION','CANDIDATE_BUILD_BYTES_MISMATCH',
      'CANDIDATE_UNRELATED_RUNTIME_FILE_CHANGED','ERR_ASSERTION','KERNEL_UNAVAILABLE',
      'T3_CORPORATE_EXCHANGE_BUSINESS_ARCHIVE_REQUIRED','T3_D3_ORIGINAL_EFFECT_ALREADY_RECORDED_USE_RECOVERY'])
      if(cross.output.includes(code))console.log('K036_CROSS_PRODUCT_DIAGNOSTIC='+code);
  }
  need(cross.code===0&&counts.tests===2&&counts.pass===2&&counts.fail===0,
    'K036_ORIGINAL_CANDIDATE_CROSS_PRODUCT_FAILED');
  console.log('K036_ORIGINAL_CANDIDATE_CROSS_PRODUCT=PASS');
  console.log('K036_CANDIDATE_SOURCE_AND_RUNTIME=PASS_NOT_RELEASED');
}catch(error){
  const code=String(error?.message??'');
  console.log(/^K036_[A-Z0-9_]{4,120}$/.test(code)?code:'K036_QUALIFICATION_UNCLASSIFIED_FAILURE');
  process.exitCode=1;
}finally{
  // All private reconstructed files and build bytes are disposable.
  if(ownsTemp)rmSync(temp,{recursive:true,force:true});
}
