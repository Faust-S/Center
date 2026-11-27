import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requireLocalExactInputs as check} from './local-exact-inputs.mjs';
const parent='4e4ad5c5e566a74f24243b9d0744a6d64652a199';
function fixture(){
  const top=mkdtempSync(join(tmpdir(),'k036-local-contract-'));
  for(const name of ['t2','t3','core'])mkdirSync(join(top,name),{mode:0o700});
  const row=(commit,tree)=>({commit,tree,files:1,bytes:1,private_source_exported:false,working_tree_used:false});
  const evidence={schema:'IWXA_K036_LOCAL_EXACT_INPUTS/1',sourceParent:parent,packagingOnly:true,
    t2:row('c28e01876f3230307b7f20449f7ef54374367c93','3d774222c9aaa1521ded9eb23d2f5fcdb55b8cbd'),
    t3:row('30df3f6fd53e668e2886fb643f13526a89738647','f446fccd97f0f232e70e06b961f8653477a0785f'),
    core:row('be8d05866f336b599b8fe6cd1ba5a961f994ced8','1dbfa4119ef612db0343ca726bddb119079161af')};
  const descriptor=join(top,'inputs.json');
  const args={t2:join(top,'t2'),core:join(top,'core'),temp:join(top,'iwxa-k036-canonical-event-merge'),descriptor,env:{},platform:'linux',version:'v22.16.0'};
  const write=()=>writeFileSync(descriptor,JSON.stringify(evidence),{mode:0o600});write();
  return {args,evidence,top,write,close:()=>rmSync(top,{recursive:true,force:true})};
}
test('local descriptor binds only the pinned exact source selection and private sibling paths',()=>{const f=fixture();try{assert.equal(check(f.args),parent);}finally{f.close();}});
test('CI and wrong runtime cannot enter the local mode',()=>{const f=fixture();try{for(const patch of [{env:{GITHUB_ACTIONS:'true'}},{platform:'win32'},{version:'v22.16.1'}])assert.throws(()=>check({...f.args,...patch}),/RUNTIME_REQUIRED/);}finally{f.close();}});
test('wrong source pins, incomplete evidence and mutable worktree inputs are denied',()=>{
  for(const patch of [e=>e.t2.commit='0'.repeat(40),e=>e.t3.tree='0'.repeat(40),e=>e.core.working_tree_used=true,e=>e.t2.files=0,e=>e.packagingOnly=false]){
    const f=fixture();try{patch(f.evidence);f.write();assert.throws(()=>check(f.args),/SOURCE_EVIDENCE_INVALID/);}finally{f.close();}
  }
});
test('wrong sibling, pre-existing output and non-private descriptor are denied',()=>{const f=fixture();try{
  assert.throws(()=>check({...f.args,t2:f.args.core}),/PRIVATE_INPUT_PATH_REQUIRED/);
  mkdirSync(f.args.temp);assert.throws(()=>check(f.args),/PRIVATE_INPUT_PATH_REQUIRED/);rmSync(f.args.temp,{recursive:true});
  chmodSync(f.args.descriptor,0o644);assert.throws(()=>check(f.args),/PRIVATE_INPUT_PATH_REQUIRED/);
}finally{f.close();}});
test('dangling output symlink and aliased source directory are denied',()=>{const f=fixture();try{
  symlinkSync(join(f.top,'missing'),f.args.temp);assert.throws(()=>check(f.args),/PRIVATE_INPUT_PATH_REQUIRED/);rmSync(f.args.temp);
  rmSync(f.args.t2,{recursive:true});symlinkSync(f.args.core,f.args.t2);assert.throws(()=>check(f.args),/PRIVATE_INPUT_PATH_REQUIRED/);
}finally{f.close();}});
