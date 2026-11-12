// Windows acceptance fixture only: re-encode the *installed* Atlas owner's
// exact native project blocks with the original released Atlas 0.6 IWXA adapter.
// Read-only: no generated project, competing store, or T3 receipt.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {deserialize,serialize} from "../vendor/atlas/src/core.mjs";
import {buildIwxaPortfolio,readIwxaPortfolio} from "../vendor/atlas/desktop/src/iwxa-portfolio.mjs";
import {readAtlasPortfolio} from "../src/atlas-integration.mjs";

const [root,target]=process.argv.slice(2);
assert.ok(root&&target,"Usage: installed-u05-atlas-iwxa.mjs ATLAS_OWNER_ROOT OUTPUT.iwxa");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const canonical=value=>Array.isArray(value)?value.map(canonical):
 value&&typeof value==="object"?Object.fromEntries(
  Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const before=readFileSync(join(root,"head.json"));
const manifest=JSON.parse(before.toString("utf8"));
assert.equal(manifest.schema,"atlas.store/1");
assert.ok(Array.isArray(manifest.projects)&&manifest.projects.length>0);
assert.ok(Number.isSafeInteger(manifest.revision)&&manifest.revision>0);
const rootSha=manifest.rootSha256??manifest.root_sha256;
if(rootSha)assert.equal(sha(Buffer.from(JSON.stringify(canonical(manifest.root)))),rootSha);
const projects=manifest.projects.map(row=>{
 assert.match(row.sha256,/^[a-f0-9]{64}$/);
 const bytes=readFileSync(join(root,"blocks",row.sha256+".json"));
 assert.equal(sha(bytes),row.sha256,"Immutable owner block must match its digest");
 const project=JSON.parse(bytes.toString("utf8"));
 assert.equal(project.id,row.id,"Native owner project ID must match block index");
 return project;
});
const snapshot=deserialize(JSON.stringify({...manifest.root,projects}));
assert.equal(snapshot.revision,manifest.revision);
assert.ok(projects.some(project=>project.items.length>0));
const original=serialize(snapshot);
const archive=await buildIwxaPortfolio(snapshot,{now:new Date().toISOString()});
const reopened=await readIwxaPortfolio(archive);
assert.equal(serialize(reopened.snapshot),original,"IWXA roundtrip must preserve exact owner portfolio");
const view=readAtlasPortfolio(original);
assert.equal(view.revision,String(manifest.revision));
assert.equal(view.projects.length,projects.length);
assert.equal(sha(readFileSync(join(root,"head.json"))),sha(before),"Owner manifest changed while reading");
writeFileSync(target,Buffer.from(archive),{flag:"wx"});
assert.equal(sha(readFileSync(target)),sha(archive),"IWXA output not durable");
console.log("CENTER_INSTALLED_ATLAS_IWXA_FIXTURE_PASS",JSON.stringify({
 revision:manifest.revision,projects:projects.length,
 works:projects.reduce((n,p)=>n+p.items.length,0),
 archiveBytes:archive.length,archiveSha256:sha(archive),
 sourceManifestSha256:sha(before),ownerModified:false
}));
