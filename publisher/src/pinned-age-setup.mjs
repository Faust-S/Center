// Original T3 age/X25519 optional Setup Core payload, FILE TRANSPORT ONLY.
// Accept opaque owner-supplied executable bytes and externally verified SHA-256.
// Never download runtime/tools, create recipient keys, sign LICENSE/STATUS or
// assume that staging a binary proves an installed runtime or a delivered .iwxa.
import {createHash} from 'node:crypto';
import {createReadStream,copyFileSync,constants,existsSync,lstatSync,
  readFileSync,rmSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const AGE_SETUP_FILES=Object.freeze([
  'iwxa-t3-age-desktop.exe','age.exe','age-keygen.exe','age-toolchain.json'
]);
const HEX=/^[0-9a-f]{64}$/;
const deny=code=>{throw Error(code);};
async function fileHash(path){
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path,{highWaterMark:64*1024}))
    hash.update(bytes);
  return hash.digest('hex');
}
export async function stagePinnedAgeResources({directory,files,pins}={}){
  if(typeof directory!=='string'||!isAbsolute(directory)||
     !lstatSync(directory,{throwIfNoEntry:false})?.isDirectory())
    deny('PUBLISHER_AGE_SETUP_EXISTING_DESTINATION_REQUIRED');
  if(!files||!pins||typeof files!=='object'||typeof pins!=='object'||
     Object.keys(files).length!==4||Object.keys(pins).length!==4||
     AGE_SETUP_FILES.some(name=>!Object.hasOwn(files,name)||
       !Object.hasOwn(pins,name)))
    deny('PUBLISHER_AGE_SETUP_EXACT_FOUR_PINNED_FILES_REQUIRED');
  const evidence=[];
  const paths=[];
  for(const name of AGE_SETUP_FILES){
    const path=files[name],pin=pins[name];
    if(typeof path!=='string'||!isAbsolute(path)||
       typeof pin!=='string'||!HEX.test(pin))
      deny('PUBLISHER_AGE_SETUP_INDEPENDENT_SOURCE_PIN_REQUIRED');
    const meta=lstatSync(path,{throwIfNoEntry:false});
    // The original T3 verified age toolchain limits each executable to
    // 64 MiB; do not stage binaries it would reject at runtime.
    const maxBytes=name==='age-toolchain.json'?4096:
      (name==='age.exe'||name==='age-keygen.exe'?64*1024*1024:512*1024*1024);
    if(!meta?.isFile()||meta.isSymbolicLink()||meta.size<1||
       meta.size>maxBytes)
      deny('PUBLISHER_AGE_SETUP_SOURCE_FILE_INVALID');
    const target=join(directory,name);
    if(resolve(path)===resolve(target)||existsSync(target))
      deny('PUBLISHER_AGE_SETUP_DESTINATION_ALREADY_EXISTS');
    if(await fileHash(path)!==pin)
      deny('PUBLISHER_AGE_SETUP_SOURCE_PIN_MISMATCH');
    evidence.push(Object.freeze({name,sha256:pin,bytes:meta.size}));
    paths.push({source:path,target});
  }
  // This is the ORIGINAL native age adapter's manifest shape. The operator
  // provides its SHA out of band, so the incoming .iwxa cannot set tool trust.
  let manifest;
  try{manifest=JSON.parse(readFileSync(files['age-toolchain.json'],'utf8'));}
  catch{deny('PUBLISHER_AGE_SETUP_ORIGINAL_MANIFEST_INVALID');}
  if(!manifest||Array.isArray(manifest)||typeof manifest!=='object'||
     manifest.schema!=='IWXA_T3_AGE_PINNED_TOOLCHAIN/1'||
     manifest.ageSha256!==pins['age.exe']||
     manifest.ageKeygenSha256!==pins['age-keygen.exe'])
    deny('PUBLISHER_AGE_SETUP_ORIGINAL_MANIFEST_PINS_MISMATCH');
  const staged=[];
  try{
    for(const {source,target} of paths){
      copyFileSync(source,target,constants.COPYFILE_EXCL);
      staged.push(target);
      const expected=pins[target.split(/[\\/]/).at(-1)];
      if(await fileHash(target)!==expected)
        deny('PUBLISHER_AGE_SETUP_STAGE_READBACK_MISMATCH');
    }
  }catch(error){
    for(const target of staged)rmSync(target,{force:true});
    throw error;
  }
  return Object.freeze({
    operation:'PUBLISHER_AGE_SETUP_STAGED',
    schema:'IWXA_T3_AGE_PINNED_TOOLCHAIN/1',
    files:Object.freeze(evidence),fileCount:4,
    runtimeQualified:false,admitted:false,delivered:false,
  });
}
async function cli(){
  const args=process.argv.slice(2);
  if(args.length!==9)deny('PUBLISHER_AGE_SETUP_ARGUMENTS_INVALID');
  const [directory,component,age,keygen,manifest,componentPin,agePin,
    keygenPin,manifestPin]=args;
  const files=Object.fromEntries(AGE_SETUP_FILES.map((n,i)=>[n,
    [component,age,keygen,manifest][i]]));
  const pins=Object.fromEntries(AGE_SETUP_FILES.map((n,i)=>[n,
    [componentPin,agePin,keygenPin,manifestPin][i]]));
  const result=await stagePinnedAgeResources({directory,files,pins});
  process.stdout.write(JSON.stringify({operation:result.operation,
    fileCount:result.fileCount,runtimeQualified:false})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  cli().catch(e=>{
    const code=typeof e?.message==='string'&&
      /^PUBLISHER_AGE_SETUP_[A-Z_]+$/.test(e.message)?
      e.message:'PUBLISHER_AGE_SETUP_OPERATION_FAILED';
    process.stderr.write(code+'\n');
    process.exitCode=1;
  });
}
