// Local qualification input binding only. The Python launcher verifies all
// Git blobs before invoking the unchanged original Kernel witness body.
// This is NOT a release receipt or a substitute for source verification.
import {lstatSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
const pins=Object.freeze({
  t2:['c28e01876f3230307b7f20449f7ef54374367c93','3d774222c9aaa1521ded9eb23d2f5fcdb55b8cbd'],
  t3:['30df3f6fd53e668e2886fb643f13526a89738647','f446fccd97f0f232e70e06b961f8653477a0785f'],
  core:['be8d05866f336b599b8fe6cd1ba5a961f994ced8','1dbfa4119ef612db0343ca726bddb119079161af'],
});
const sourceParent='4e4ad5c5e566a74f24243b9d0744a6d64652a199';
const need=(value,code)=>{if(!value)throw Error('K036_LOCAL_'+code);};
const safeDirectory=p=>{const s=lstatSync(p);return s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(p)===p&&(s.mode&0o077)===0;};
export function requireLocalExactInputs({t2,core,temp,descriptor,env=process.env,platform=process.platform,version=process.version}={}){
  need(platform==='linux'&&env.GITHUB_ACTIONS!=='true'&&version==='v22.16.0','RUNTIME_REQUIRED');
  need(typeof descriptor==='string'&&descriptor===resolve(descriptor),'INPUT_DESCRIPTOR_REQUIRED');
  const top=dirname(descriptor),st=lstatSync(descriptor);
  need(safeDirectory(top)&&st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0&&st.size<=16384&&
    descriptor===join(top,'inputs.json')&&t2===join(top,'t2')&&core===join(top,'core')&&
    temp===join(top,'iwxa-k036-canonical-event-merge')&&!existsSync(temp)&&!isSymlink(temp)&&
    [t2,core,join(top,'t3')].every(safeDirectory),'PRIVATE_INPUT_PATH_REQUIRED');
  const evidence=JSON.parse(readFileSync(descriptor,'utf8'));
  need(evidence?.schema==='IWXA_K036_LOCAL_EXACT_INPUTS/1'&&evidence.sourceParent===sourceParent&&
    evidence.packagingOnly===true,'SOURCE_EVIDENCE_INVALID');
  for(const [name,[commit,tree]] of Object.entries(pins)){
    const row=evidence[name];
    need(row?.commit===commit&&row.tree===tree&&row.private_source_exported===false&&row.working_tree_used===false&&
      Number.isSafeInteger(row.files)&&row.files>0&&row.files<=4096&&Number.isSafeInteger(row.bytes)&&
      row.bytes>0&&row.bytes<=128*1024*1024,'SOURCE_EVIDENCE_INVALID');
  }
  return sourceParent;
}
function isSymlink(p){try{return lstatSync(p).isSymbolicLink();}catch(e){if(e.code==='ENOENT')return false;throw e;}}
