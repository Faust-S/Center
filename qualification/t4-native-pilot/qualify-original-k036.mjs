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
  const result=spawnSync(cmd,args,{cwd,env,encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true,timeout:300000});
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
  if(!existsSync(output)){
    for(const code of ['IMPORT_EVENT_ID_COLLISION','ERR_MODULE_NOT_FOUND','SyntaxError','TypeError'])
      if(r.output.includes(code))console.log('K036_TEST_RUNNER_DETAIL='+code);
  }
  return {...r,report:report(output)};
}
try{
  need(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Faust-S/Center'&&
    process.env.GITHUB_REF==='refs/heads/work/2026-11-27-t4-native-pilot-k036'&&
    process.env.RUNNER_ENVIRONMENT==='github-hosted','K036_PUBLIC_DISPOSABLE_RUNNER_REQUIRED');
  need(process.env.T2_PIN==='c28e01876f3230307b7f20449f7ef54374367c93'&&
    process.env.CORE_PIN==='683b8c14adeef650d7eb5901f0ff1865267f68b6','K036_SOURCE_PINS_REQUIRED');
  for(const [root,pin] of [[t2,process.env.T2_PIN],[core,process.env.CORE_PIN]]){
    const got=run('git',['rev-parse','HEAD'],root);
    need(got.code===0&&got.output.trim()===pin,'K036_SOURCE_PIN_MISMATCH');
  }
  // The source and canonical generator are exactly the previously qualified
  // commit. The direct successor adds ONLY the two candidate archive tools.
  const sourcePin=process.env.T2_SOURCE_PIN;
  const packagingDir='t2/current/final-successor/kernel-successors/k036-canonical-event-merge-20261125';
  const packagingPaths=[packagingDir+'/prepare_k036_candidate_archive.py',
    packagingDir+'/test_prepare_k036_candidate_archive.py'].sort();
  const parent=run('git',['rev-parse','HEAD^'],t2);
  const changed=run('git',['diff','--name-only','HEAD^','HEAD'],t2);
  need(sourcePin==='4e4ad5c5e566a74f24243b9d0744a6d64652a199'&&parent.code===0&&parent.output.trim()===sourcePin&&
    changed.code===0&&JSON.stringify(changed.output.trim().split(/\r?\n/).sort())===JSON.stringify(packagingPaths),
    'K036_PACKAGING_ONLY_SOURCE_DRIFT');
  const stageOnly=process.env.K036_STAGE_ONLY==='1';
  const admissionOnly=process.env.K036_ADMISSION_ONLY==='1';
  // Unlike the earlier recipe-only witness, this is an explicit test of
  // the exact converged public Core pinned above. No accepted pin changes.
  need(process.env.K036_ADMISSION_ONLY==='1'&&process.env.K036_STAGE_ONLY!=='1',
    'K036_T4_EXACT_ADMISSION_WITNESS_REQUIRED');
  console.log('K036_CONVERGED_PUBLIC_CORE_PIN=PASS');
  console.log('K036_PACKAGING_ONLY_SOURCE_PIN=PASS');
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
  const count=identity.eventComparisonsChanged;
  need(Number.isInteger(count)&&count>=1&&count<=8&&text.split(corrected).length===count+1,'K036_BASELINE_RECONSTRUCTION_ANCHOR');
  console.log(`K036_EVENT_COMPARISONS_CHANGED=${count}`);
  const prior=Buffer.from(text.replaceAll(corrected,original),'utf8');
  need(sha(prior)===change.beforeSha256,'K036_BASELINE_SOURCE_HASH_MISMATCH');
  if(stageOnly||admissionOnly){
    console.log('K036_SOURCE_REGRESSION=REUSED_EXACT_REVISION_45596499435');
  }else{
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
  }
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
    sourceCommit:sourcePin,productionActivation:false,changedFiles:identity.changedFiles,files};
  const receiptPath=join(temp,'candidate-build-receipt.json');
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log('K036_CANDIDATE_BUILD_RECEIPT='+JSON.stringify(receipt));
  const qualified=join(temp,'qualified-original'),corePackage=join(core,'packages/t3-core');
  // The existing exact accepted ZIP stays the input to product materializers.
  const zip=join(corePackage,'qualified-runtime',identity.baseQualifiedArtifactId+'.zip');
  need(sha(readFileSync(zip))===previous.archiveSha256,'K036_PREVIOUS_ARCHIVE_SHA_MISMATCH');
  step('K036_EXTRACT_IMMUTABLE_BASELINE','python',['-c',
    'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',zip,qualified],temp);
  // The candidate archive remains private and unaccepted. Rebuild it
  // from the already verified original source bytes and the immutable
  // previous distribution; never claim that its old release ID still fits.
  const packagingRoot=join(t2,packagingDir);
  step('K036_CANDIDATE_ARCHIVE_SOURCE_TESTS','python',['-m','unittest','discover','-s',packagingRoot,
    '-p','test_prepare_k036_candidate_archive.py'],temp,{...process.env,PYTHONDONTWRITEBYTECODE:'1'});
  const artifactOut=join(temp,'candidate-archive');
  const previousRoot=join(t2,'t2/current/final-successor/kernel-successors/k036-same-store-event-history-20261019');
  step('K036_CANDIDATE_ARCHIVE_STAGE','python',[join(packagingRoot,'prepare_k036_candidate_archive.py'),
    '--base-archive',zip,'--previous-identity',join(previousRoot,'ARTIFACT_IDENTITY.json'),
    '--candidate-dist',dist,'--build-receipt',receiptPath,'--output-dir',artifactOut],temp);
  const identityOut=json(join(artifactOut,'CANDIDATE_ARTIFACT_IDENTITY.json'));
  const candidateZip=join(artifactOut,identityOut.artifactId+'.zip');
  need(identityOut.releaseAccepted===false&&identityOut.productionActivation===false&&
    identityOut.sourceCommit===sourcePin&&identityOut.archiveSha256===sha(readFileSync(candidateZip)),
    'K036_CANDIDATE_ARCHIVE_IDENTITY_INVALID');
  console.log('K036_CANDIDATE_ARCHIVE_IDENTITY='+JSON.stringify(identityOut));
  need(identityOut.artifactId==='iwxa-kernel-k036-canonical-event-merge-20261125-candidate.1'&&
    identityOut.archiveSha256==='5320dcb6c42d5fca410880677c8a8b595d4c9a2a6cedf51089b5f60f4ceeb52a',
    'K036_CANDIDATE_ARCHIVE_PIN_MISMATCH');
  if(!stageOnly){
    const extracted=join(temp,'candidate-original');
    step('K036_EXTRACT_EXACT_CANDIDATE','python',['-c',
      'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',candidateZip,extracted],temp);
    const idb=join(candidate,'node_modules/fake-indexeddb/build/esm/index.js');
    need(existsSync(idb),'K036_TEST_INDEXEDDB_REQUIRED');
    npm('K036_ONE_CORE_DEPENDENCIES',['ci','--ignore-scripts','--no-audit','--no-fund'],corePackage);
    npm('K036_ONE_CORE_COMPILED_UI',['run','build'],corePackage);
    const countsFor=output=>Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)\s*$/gm)]
      .map(m=>[m[1],Number(m[2])]));
    const reportTests=(label,r,minimum,exact=false)=>{
      const counts=countsFor(r.output);
      console.log(label+'_COUNTS='+JSON.stringify(counts));
      if(r.code!==0){
        for(const code of ['T3_INSTALLED_KERNEL_CANDIDATE_FILE_DIGEST_MISMATCH',
          'T3_INSTALLED_KERNEL_CANDIDATE_FILE_PATH_INVALID','T3_D1_DIST_CANDIDATE_NATIVE_CORPORATE_PROFILE_REQUIRED',
          'T3_AGENT_ONE_DIST_ORIGINAL_QUALIFIED_ASSEMBLY_REQUIRED','T3_D1_DIST_DESKTOP_AGENT_WEBGPU_WORKER_FORBIDDEN',
          'T3_D1_DIST_DESKTOP_ADMIN_WEBGPU_WORKER_FORBIDDEN','IMPORT_EVENT_ID_COLLISION','ERR_ASSERTION',
          'ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','SyntaxError','ReferenceError','TypeError','ENOENT'])
          if(r.output.includes(code))console.log(label+'_DIAGNOSTIC='+code);
      }
      need(r.code===0&&Number.isInteger(counts.tests)&&
        (exact?counts.tests===minimum:counts.tests>=minimum)&&counts.pass===counts.tests&&
        counts.fail===0&&counts.cancelled===0&&counts.skipped===0,label+'_FAILED');
      console.log(label+'=PASS');
    };
    const recipes=run(node,['--test','--test-reporter=tap','--test-timeout=180000',
      'tests/installed-kernel-candidate.test.mjs','tests/t3-d1-signed-control-dist.test.mjs',
      'tests/t3-d6-agent-one-dist-builder.test.mjs'],corePackage);
    reportTests('K036_CANDIDATE_RECIPE_REGRESSIONS',recipes,17);
    const cross=run(node,['--test','--test-reporter=tap','--test-timeout=180000','tests/t3-company-original-runtime-roundtrip.test.mjs'],
      corePackage,{...process.env,IWXA_COMPANY_TEST_QUALIFIED_T2:qualified,IWXA_COMPANY_TEST_IDB_MODULE:idb,
        IWXA_COMPANY_TEST_CANDIDATE_T2:extracted,
        IWXA_COMPANY_TEST_CANDIDATE_RECEIPT:join(artifactOut,'CANDIDATE_ARTIFACT_IDENTITY.json'),
        IWXA_COMPANY_TEST_COMPILED_T3:join(corePackage,'dist')});
    reportTests('K036_ORIGINAL_CANDIDATE_ACTUAL_PRODUCT_RECIPES',cross,3,true);
  }else console.log('K036_CROSS_PRODUCT_REGRESSION=REUSED_PREVIOUS_SOURCE_EVIDENCE_45596499435');
  console.log(stageOnly?'K036_CANDIDATE_ARCHIVE=STAGED_REUSED_EXACT_SOURCE_EVIDENCE_NOT_RELEASED':
    'K036_CANDIDATE_PRODUCT_RECIPES=PASS_NOT_RELEASED');
}catch(error){
  const code=String(error?.message??'');
  console.log(/^K036_[A-Z0-9_]{4,120}$/.test(code)?code:'K036_QUALIFICATION_UNCLASSIFIED_FAILURE');
  process.exitCode=1;
}finally{
  // All private reconstructed files and build bytes are disposable.
  if(ownsTemp)rmSync(temp,{recursive:true,force:true});
}
