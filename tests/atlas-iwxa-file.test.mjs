import test from "node:test";
import assert from "node:assert/strict";
import {empty,createProject,createItem,serialize} from "../vendor/atlas/src/core.mjs";
import {buildIwxaPortfolio} from "../vendor/atlas/desktop/src/iwxa-portfolio.mjs";
import {readAtlasSourceFile} from "../src/atlas-file-import.mjs";
import {linkableAtlasWork,atlasWorkReadback} from "../src/atlas-integration.mjs";

const source=()=>{
 const project=createProject(empty(),{name:"IWXA проект Ω",type:"engineering"});
 const item=createItem(project.state,project.id,{title:"Контроль результата"});
 return {state:item.state,projectId:project.id,workId:item.id};
};
const fromBytes=(bytes,name="atlas.iwxa")=>({
 name,size:bytes.byteLength,arrayBuffer:async()=>bytes.slice().buffer,
 text:async()=>{throw Error("IWXA must never be read as plain text");}
});
const fromText=(value,name="atlas.json")=>({
 name,size:new TextEncoder().encode(value).byteLength,
 text:async()=>value,arrayBuffer:async()=>{throw Error("JSON must use existing text path");}
});
test("Center reads actual Atlas 0.5 .iwxa through owner's parser and retains WorkRef",async()=>{
 const {state,projectId,workId}=source();
 const bytes=await buildIwxaPortfolio(state,{now:"2026-11-09T10:00:00.000Z"});
 const {format,view}=await readAtlasSourceFile(fromBytes(bytes));
 assert.equal(format,"iwxa");
 assert.equal(view.source,"atlas.project/1");
 assert.equal(view.mode,"READ_ONLY_USER_SELECTED_FILE");
 assert.equal(view.authorization,"NOT_CHECKED");
 assert.equal(view.projects.length,1);
 assert.equal(view.projects[0].name,"IWXA проект Ω");
 assert.equal(view.projects[0].workItems[0].id,workId);
 const ref=linkableAtlasWork(view,projectId,workId);
 assert.deepEqual(ref,{projectId,workId,revision:String(state.revision)});
 assert.equal(atlasWorkReadback(view,ref),"SOURCE_REVISION_MATCHES");
 assert.equal(state.projects[0].items.length,1,"Reading must not modify owner snapshot");
});
test("Center still reads historical JSON via existing Atlas model",async()=>{
 const {state}=source();
 const {view,format}=await readAtlasSourceFile(fromText(serialize(state)));
 assert.equal(format,"json");
 assert.equal(view.projects[0].name,"IWXA проект Ω");
 assert.equal(view.revision,String(state.revision));
});
test("Center rejects tampered .iwxa, spoofed extensions, oversize and fake file sizes",async()=>{
 const {state}=source();
 const valid=await buildIwxaPortfolio(state,{now:"2026-11-09T10:00:00.000Z"});
 const changed=Uint8Array.from(valid);
 changed[changed.length-30]^=1;
 await assert.rejects(readAtlasSourceFile(fromBytes(changed)),/ATLAS_SOURCE_IWXA_INVALID/);
 await assert.rejects(readAtlasSourceFile(fromText('{"format":"iwxa.package"}',"task.json")),/ATLAS_SNAPSHOT_INVALID/);
 await assert.rejects(readAtlasSourceFile(fromBytes(valid,"task.iwxa.exe")),/ATLAS_SOURCE_FILE_INVALID/);
 await assert.rejects(readAtlasSourceFile({...fromBytes(valid),size:0}),/ATLAS_SOURCE_FILE_SIZE_INVALID/);
 await assert.rejects(readAtlasSourceFile({...fromBytes(valid),size:33*1024*1024}),/ATLAS_SOURCE_FILE_SIZE_INVALID/);
 await assert.rejects(readAtlasSourceFile({...fromBytes(valid),size:valid.length+1}),/ATLAS_SOURCE_FILE_SIZE_INVALID/);
});
