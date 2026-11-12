// A selected Atlas file is a read-only source, not an organizational grant.
// Use the ORIGINAL released Atlas 0.6 IWXA reader and canonical project model.
// Never reinterpret the T3 signed Task carrier or write a second portfolio Store.
import {readIwxaPortfolio,IWXA_MAX_BYTES} from "../vendor/atlas/desktop/src/iwxa-portfolio.mjs";
import {serialize,deserialize} from "../vendor/atlas/src/core.mjs";
import {readAtlasPortfolio,ATLAS_SNAPSHOT_LIMIT} from "./atlas-integration.mjs";

const fail=code=>{throw Object.assign(new Error(code),{code});};
// The source summary intentionally hides some Atlas fields. Compare the FULL
// validated portfolio across repeated selections, not just summary counters.
// Canonical key order makes JSON and .iwxa of the same state comparable;
// packaging timestamps are not part of the source content.
const canonical=value=>Array.isArray(value)?value.map(canonical):
 value&&typeof value==="object"?Object.fromEntries(
  Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
async function projectCopy(raw,format){
 const view=readAtlasPortfolio(raw);
 const normalized=JSON.stringify(canonical(deserialize(raw)));
 if(!globalThis.crypto?.subtle)fail("ATLAS_SOURCE_DIGEST_UNAVAILABLE");
 const digest=await globalThis.crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(normalized));
 const contentSha256=Array.from(new Uint8Array(digest),
  byte=>byte.toString(16).padStart(2,"0")).join("");
 return {view,format,contentSha256};
}

export async function readAtlasSourceFile(file){
 const name=file?.name;
 if(typeof name!=="string")fail("ATLAS_SOURCE_FILE_INVALID");
 const iwxa=/\.iwxa$/i.test(name),json=/\.json$/i.test(name);
 if(!iwxa&&!json)fail("ATLAS_SOURCE_FILE_INVALID");
 const max=iwxa?IWXA_MAX_BYTES:ATLAS_SNAPSHOT_LIMIT;
 if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>max)
  fail("ATLAS_SOURCE_FILE_SIZE_INVALID");
 if(iwxa){
  if(typeof file.arrayBuffer!=="function")fail("ATLAS_SOURCE_FILE_INVALID");
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(bytes.byteLength!==file.size)fail("ATLAS_SOURCE_FILE_SIZE_INVALID");
   const imported=await readIwxaPortfolio(bytes);
   // Center's projection and WorkRef gate remain exactly the same as for JSON.
   return await projectCopy(serialize(imported.snapshot),"iwxa");
  }catch(error){
   if(error?.code==="ATLAS_SOURCE_FILE_SIZE_INVALID")throw error;
   fail("ATLAS_SOURCE_IWXA_INVALID");
  }
 }
 if(typeof file.text!=="function")fail("ATLAS_SOURCE_FILE_INVALID");
 const text=await file.text();
 if(new TextEncoder().encode(text).byteLength!==file.size)
  fail("ATLAS_SOURCE_FILE_SIZE_INVALID");
 return await projectCopy(text,"json");
}
