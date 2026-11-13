/** D11 site-only integrated static build using the accepted T2 runtime. */
import {mkdtempSync,existsSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {execFileSync,spawn} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {integrateD11HostPage} from "./d11-site-shell.mjs";
const SITE=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const T2_HEAD="e70de29b72b83e2546f7ab74b17572685a728c17";
const ARTIFACT="iwxa-kernel-k036-same-store-history-20261019-qualified.1";
const temp=mkdtempSync(join(tmpdir(),"d11-t2-site-"));
const run=(cmd,args,cwd)=>execFileSync(cmd,args,{cwd,stdio:"inherit",env:{...process.env,NODE_ENV:"production"}});
const node=(file,args,cwd)=>run(process.execPath,[file,...args],cwd);
const runAsync=(cmd,args,cwd)=>new Promise((resolveRun,rejectRun)=>{
 const child=spawn(cmd,args,{cwd,stdio:"inherit",env:{...process.env,NODE_ENV:"production"}});
 child.once("error",rejectRun);
 child.once("close",code=>code===0?resolveRun():rejectRun(Error("D11_BUILD_COMMAND_FAILED:"+basename(args[0]??cmd)+":"+code)));
});
// Bun exposes npm_execpath as an executable. A Node CLI must be a .js/.cjs/.mjs file.
const npmCliCandidates=[
 process.env.npm_execpath,
 resolve(dirname(process.execPath),"../lib/node_modules/npm/bin/npm-cli.js"),
 resolve(dirname(process.execPath),"node_modules/npm/bin/npm-cli.js"),
];
const npmCli=npmCliCandidates.find(file=>
 typeof file==="string" && /\.(?:cjs|mjs|js)$/i.test(file) && existsSync(file));
const npmAsync=(args,cwd)=>{
 if(!npmCli)throw Error("D11_NPM_CLI_MISSING: install Node/npm to build the T2 site");
 return runAsync(process.execPath,[npmCli,...args],cwd);
};
const copy=(from,to)=>{if(!existsSync(from))throw Error("D11_MISSING:"+from);mkdirSync(dirname(to),{recursive:true});cpSync(from,to,{recursive:true})};
const sha=(file)=>createHash("sha256").update(readFileSync(file)).digest("hex");
const json=(file)=>JSON.parse(readFileSync(file,"utf8"));
const shippingConfig=json(join(SITE,"runtime/t2-config/domain.json"));
const productShell=json(join(SITE,"runtime/t2-config/domain-shell.json"));
if(productShell.layout?.workspace_chrome!=="site-owned"||
   productShell.layout?.footer_variant!=="none"||
   productShell.theme?.tokens_path!=="/_iwxa/ui/d11-workspace-theme.css")
 throw Error("D11_PRODUCT_FIRST_SHELL_INVALID");
if(shippingConfig.status!=="active" ||
   shippingConfig.release?.deployment_mode!=="production" ||
   shippingConfig.diagnostics?.enabled!==false ||
   shippingConfig.diagnostics.path!=="/_iwxa/diagnostics" ||
   JSON.stringify(shippingConfig.release?.release_must_exclude)!=='["/_iwxa/diagnostics/"]' ||
   shippingConfig.release?.backup_before_upload!==true)
 throw Error("D11_PRODUCTION_CONFIG_INVALID");
try{
 const t2=process.env.IWXA_T2_SOURCE_DIR?resolve(process.env.IWXA_T2_SOURCE_DIR):join(temp,"T2");
 if(!process.env.IWXA_T2_SOURCE_DIR)run("git",["-c","core.autocrlf=false","clone","--filter=blob:none","https://github.com/Faust-S/T2.git",t2],temp);
 if(!process.env.IWXA_T2_SOURCE_DIR)run("git",["checkout","--detach",T2_HEAD],t2);
 const actual=execFileSync("git",["rev-parse","HEAD"],{cwd:t2,encoding:"utf8"}).trim();
 if(actual!==T2_HEAD)throw Error("D11_NORMATIVE_T2_REVISION_MISMATCH:"+actual);
 const canonical=join(t2,"t2/current/final-successor/canonical-source");
 const host=join(temp,"host");
 cpSync(canonical,host,{recursive:true,filter:x=>!["node_modules","dist",".git"].includes(basename(x))});
 node(join(canonical,"scripts/stage-t2-external-module.mjs"),[host,join(SITE,"runtime/d11-module"),"iwxa.domain.advice-logistics","advice-logistics"],canonical);
 // Reuse the accepted T2 kernel source materializers to obtain its complete
 // static file inventory and service catalog. Runtime bytes are pinned below.
 const authority=join(t2,"t2/current/final-successor/canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json");
 const kernelBase=join(temp,"kernel-base");
 const kernel=join(temp,"kernel-036");
 node(join(canonical,"scripts/materialize-k035-atomic-graph-successor.mjs"),[authority,t2,kernelBase],canonical);
 node(join(canonical,"scripts/materialize-k036-atomic-graph-qualified.mjs"),[kernelBase,kernel],canonical);
 // TanStack's route generator rewrites this tracked file in platform-specific
 // ordering during Vite builds. Keep the canonical source checkout immutable;
 // generated route code is consumed by this build but never becomes a source
 // change as a side effect of Product Completion.
 // The public sub-build also regenerates sitemap.xml; restore source inputs,
 // including on failure, without touching generated dist/.
 const generatedPaths=["src/routeTree.gen.ts","public/sitemap.xml"];
 const generatedSnapshots=generatedPaths.map(file=>{
  const path=join(SITE,file);
  return {path,bytes:existsSync(path)?readFileSync(path):null};
 });
 try{
  await Promise.all([
   (async()=>{await npmAsync(["ci","--no-audit","--no-fund","--include=dev"],host);await npmAsync(["run","build"],host)})(),
   (async()=>{await npmAsync(["ci","--no-audit","--no-fund","--include=dev"],kernel);await npmAsync(["run","build"],kernel)})(),
   npmAsync(["run","build:public:internal"],SITE),
  ]);
 }finally{
  for(const snap of generatedSnapshots){
   if(snap.bytes===null)rmSync(snap.path,{force:true});
   else writeFileSync(snap.path,snap.bytes);
  }
 }
 const dist=join(SITE,"dist");
 const hostDist=join(host,"dist");
 // The accepted artifact is staged by the canonical T2 verifier, never recompiled.
 const zip=join(t2,"t2/current/final-successor/kernel-successors/k036-same-store-event-history-20261019",ARTIFACT+".zip");
 const qualified=join(temp,"qualified");mkdirSync(qualified);
 // The generated kernel provides the catalog, schemas and ancillary files.
 // They are not claimed to be the qualified release until the accepted
 // artifact is installed and independently reverified by T2.
 copy(join(kernel,"dist/_iwxa"),join(dist,"_iwxa"));
 if(!existsSync(zip))throw Error("D11_QUALIFIED_ARCHIVE_MISSING");
 const manifest=json(join(canonical,"src/factory2/products/domain-completion/qualified-kernel-artifact.json"));
 const release=manifest.artifacts.find(x=>x.artifactId===ARTIFACT);
 if(!release||release.releaseAccepted!==true||release.productionActivation!==false||
    release.kernel!=="0.3.6"||release.contract!=="1.3.0"||
    release.archiveSha256!=="7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68"||
    sha(zip)!==release.archiveSha256||release.files?.length!==4)
  throw Error("D11_QUALIFIED_ARTIFACT_MISMATCH");
 if(process.platform==="win32")run("tar",["-xf",zip,"-C",qualified],temp);
 else run("unzip",["-q",zip,"-d",qualified],temp);
 // Remove only the four unqualified, freshly built counterparts; the
 // canonical T2 stager then installs/verifies the exact released bytes.
 for(const file of release.files){
  if(typeof file.path!=="string"||!file.path.startsWith("_iwxa/")||file.path.split("/").some(part=>!part||part==="."||part==="..")||!/^[A-Za-z0-9_./-]+$/.test(file.path))
   throw Error("D11_QUALIFIED_FILE_PATH_INVALID");
  const target=join(dist,file.path);
  if(!existsSync(target))throw Error("D11_KERNEL_BASE_FILE_MISSING:"+file.path);
  rmSync(target);
 }
 node(join(canonical,"scripts/stage-verified-kernel.mjs"),[qualified,dist,"--qualification-only","--artifact-id",ARTIFACT],canonical);
 // The generated Kernel tree includes an engineering-only diagnostics site
 // with negative probes. It is not part of the public Host, Workspace or
 // qualified four-file runtime; only the D11 hosting distribution excludes it.
 const diagnosticsDir=join(dist,"_iwxa","diagnostics");
 rmSync(diagnosticsDir,{recursive:true,force:true});
 if(existsSync(diagnosticsDir))
  throw Error("D11_ENGINEERING_DIAGNOSTICS_STILL_PRESENT");
 // Publish the verified client assets and the compiled Host under one domain.
 copy(join(hostDist,"assets"),join(dist,"workspace/assets"));
 // Studio belongs to Factory engineering, never to the customer-facing Host.
 const hostAssetDir=join(dist,"workspace/assets");
 const hostAssetNames=readdirSync(hostAssetDir);
 const studioChunks=hostAssetNames.filter(name=>/^studio-[A-Za-z0-9_-]+\.js$/.test(name));
 const shippedAssets=hostAssetNames.filter(name=>!studioChunks.includes(name));
 const hostPages=["index.html","exchange/index.html","lifecycle/index.html"]
  .map(file=>readFileSync(join(hostDist,file),"utf8"));
 for(const name of studioChunks){
  const used=hostPages.some(html=>html.includes(name))||
    shippedAssets.some(other=>/\.(?:js|mjs|css)$/.test(other)&&
      readFileSync(join(hostAssetDir,other),"utf8").includes(name));
  if(used)throw Error("D11_STUDIO_CHUNK_REFERENCED:"+name);
  rmSync(join(hostAssetDir,name));
 }
 const hostHtml=readFileSync(join(hostDist,"index.html"),"utf8");
 if(!hostHtml.includes('id="root"') || !hostHtml.includes('<base href="/workspace/"') ||
    !hostHtml.includes('type="module"') || !hostHtml.includes('/workspace/assets/'))
  throw Error("D11_HOST_ENTRY_INCOMPATIBLE");

 const publicPage=readFileSync(join(dist,"index.html"),"utf8");
 const withSiteIcon=(html)=>html.replace(/href=(["'])\/?(?:workspace\/)?favicon\.ico\1/g,'href="/favicon.png"');
 // The trusted Product-first Host selects #/domain for an empty hash.
 // Do not redirect or override explicit Host bookmarks.
 const hostPage=withSiteIcon(hostHtml);
 mkdirSync(join(dist,"workspace"),{recursive:true});
 writeFileSync(join(dist,"workspace/index.html"),integrateD11HostPage(publicPage,hostPage));
 for(const section of ["exchange","lifecycle"]){
  const source=join(hostDist,section,"index.html");
  if(!existsSync(source))throw Error("D11_HOST_SECTION_MISSING:"+section);
  const base="/workspace/"+section+"/";
  const html=readFileSync(source,"utf8");
  if(!html.includes('<base href="'+base+'"'))throw Error("D11_HOST_SECTION_BASE_INVALID:"+section);
  if(!html.includes("</head>"))throw Error("D11_HOST_SECTION_HEAD_MISSING:"+section);
  mkdirSync(join(dist,"workspace",section),{recursive:true});
  // D11 site-chrome handles the empty Exchange/Lifecycle hash in the head;
  // never inject inline JS or rewrite explicit bookmarks.
  writeFileSync(join(dist,"workspace",section,"index.html"),
   integrateD11HostPage(publicPage,withSiteIcon(html)));
 }
 const cfg=join(SITE,"runtime/t2-config");
 copy(join(cfg,"domain.json"),join(dist,"_iwxa/domain.json"));
 copy(join(cfg,"domain-shell.json"),join(dist,"_iwxa/domain-shell.json"));
 copy(join(cfg,"tokens.css"),join(dist,"_iwxa/tokens.css"));
 copy(join(cfg,"d11-workspace-theme.css"),join(dist,"_iwxa/ui/d11-workspace-theme.css"));
 copy(join(cfg,"d11-site-chrome.js"),join(dist,"_iwxa/ui/d11-site-chrome.js"));
 copy(join(cfg,"workspace.config.json"),join(dist,"workspace/workspace.config.json"));
 const passport=join(cfg,"d11-workspace-passport.json");
 const services=join(dist,"_iwxa/services");
 rmSync(services,{recursive:true,force:true});mkdirSync(services,{recursive:true});
 const service=json(passport);
 const serviceId="ru.iwxa.advice-logistics.workspace";
 const auditorId="ru.iwxa.advice-logistics.auditor";
 const expectedSchemas=[
  "ru.iwxa.advice-logistics.process.proposal",
  "ru.iwxa.advice-logistics.data-role-matrix.proposal",
  "ru.iwxa.advice-logistics.automation-readiness.proposal",
  "ru.iwxa.advice-logistics.functional-requirements.proposal",
  "ru.iwxa.advice-logistics.terms-of-reference.proposal",
  "ru.iwxa.advice-logistics.project-brief.proposal",
  "ru.iwxa.advice-logistics.delivery-network.proposal",
 ];
 if(service.service_id!==serviceId||service.base_path!=="/workspace/"||
    !Array.isArray(service.output_object_types)||
    service.output_object_types.length!==expectedSchemas.length||
    !expectedSchemas.every(id=>service.output_object_types.includes(id)&&!!service.schemas?.[id])||
    service.permissions?.workspace?.list!==true||
    service.permissions?.workspace?.read!==true||
    service.permissions?.workspace?.create!==true||
    service.permissions?.packages?.export!==true||
    service.permissions?.packages?.import!==true)
   throw Error("D11_PASSPORT_CONTRACT_INVALID");
 copy(passport,join(services,service.service_id+".json"));
 // The T2 independent witness requires a separate, openly declared Kernel
 // service with read authority but NO mutations, imports or owner approvals.
 const auditor=json(join(cfg,"d11-read-only-auditor.json"));
 if(auditor.service_id!=="ru.iwxa.advice-logistics.auditor"||
    auditor.permissions?.workspace?.list!==true||auditor.permissions?.workspace?.read!==true||
    auditor.permissions?.workspace?.create!==false||
    auditor.permissions?.workspace?.soft_delete!==false||
    auditor.permissions?.workspace?.restore!==false||
    auditor.permissions?.workspace?.purge!==false||
    JSON.stringify(auditor.permissions?.objects?.read)!=='["*"]'||
    auditor.permissions?.objects?.write?.length!==0||
    auditor.permissions?.objects?.delete?.length!==0||
    auditor.permissions?.events?.read_scope!=="workspace"||
    auditor.permissions?.packages?.export!==false||
    auditor.permissions?.packages?.import!==false||
    auditor.permissions?.operations?.length>0||
    auditor.input_object_types?.length!==0||
    auditor.output_object_types?.length!==0||
    Object.keys(auditor.schemas??{}).length!==0)
   throw Error("D11_AUDITOR_READ_ONLY_INVARIANT");
 copy(join(cfg,"d11-read-only-auditor.json"),join(services,auditorId+".json"));
 const catalogFile=join(dist,"_iwxa/service-catalog.json");
 if(!existsSync(catalogFile))throw Error("D11_KERNEL_SERVICE_CATALOG_MISSING");
 const catalog=json(catalogFile);
 if(!Array.isArray(catalog.entries))throw Error("D11_KERNEL_CATALOG_INVALID");
 const serviceEntries=[service,auditor].map(item=>({
  service_id:item.service_id,service_version:item.service_version,
  base_path:item.base_path,supported_levels:item.supported_levels,
  file:"_iwxa/services/"+item.service_id+".json",
  sha256:sha(join(services,item.service_id+".json"))
 }));
 writeFileSync(catalogFile,JSON.stringify({...catalog,count:serviceEntries.length,entries:serviceEntries},null,2)+"\n");
  const plane=json(join(cfg,"security/capability-control-plane.json"));
 const {auditT2CapabilityControlPlane}=await import(
  pathToFileURL(join(canonical,"scripts/verify-capability-control-plane.mjs")).href
 );
 const audit=auditT2CapabilityControlPlane({
  plane,servicePassports:{[service.service_id]:service,[auditorId]:auditor}
 });
 if(audit.serviceCount!==2||audit.guardedServiceCount!==0||
    audit.externalProvisioningRequired!==false||
    audit.signedGrantVerified!==false||audit.activeReceiptVerified!==false||
    plane.trusted_issuers?.length!==0||plane.issuance_policies?.length!==0||
    plane.services?.length!==2||
    ![serviceId,auditorId].every(id=>plane.services.some(entry=>
      entry.service_id===id&&entry.capability_control==="NONE"&&
      entry.capability_ceiling?.length===0&&entry.activation_any_of?.length===0&&
      entry.operation_guards?.length===0))||
    process.env.IWXA_T2_CAPABILITY_CONTROL_PLANE)
   throw Error("D11_ANONYMOUS_T2_DECLARATION_INVALID");
 copy(join(cfg,"security/capability-control-plane.json"),join(dist,"_iwxa/security/capability-control-plane.json"));
 const published=json(catalogFile);
 if(published.count!==2||published.entries.length!==2||
    ![service,auditor].every(item=>published.entries.some(entry=>
      entry.service_id===item.service_id&&
      entry.sha256===sha(join(services,item.service_id+".json")))))
   throw Error("D11_PUBLISHED_CATALOG_READBACK_INVALID");
 const domain=json(join(dist,"_iwxa/domain.json"));
 const workspace=json(join(dist,"workspace/workspace.config.json"));
 if(domain.status!=="active"||domain.release?.deployment_mode!=="production"||
    domain.diagnostics?.enabled!==false||
    JSON.stringify(domain.release?.release_must_exclude)!=='["/_iwxa/diagnostics/"]')
   throw Error("D11_PUBLISHED_PRODUCTION_CONFIG_INVALID");
 if(domain.domain_id!=="ru.iwxa.advice-logistics"||
    domain.origin!=="https://advice-logistics.ru"||
    domain.workspace_profile!=="organization"||
    workspace.domain_id!==domain.domain_id||
    workspace.workspace_service_id!==serviceId||
    workspace.profile!=="organization")
   throw Error("D11_DOMAIN_WORKSPACE_SCOPE_MISMATCH");
 // One hosting package: public tools and the three protected Host routes.
 for(const tool of ["as-is-to-be-process","process-data-system-role-matrix",
  "automation-readiness","functional-requirements-logistics-it",
  "logistics-automation-terms-of-reference","project-brief-generator"]){
  const page=join(dist,"tools",tool,"index.html");
  if(!existsSync(page))throw Error("D11_PUBLIC_TOOL_MISSING:"+tool);
 }
 for(const file of ["index.html","404.html",".htaccess","workspace/index.html",
    "workspace/exchange/index.html","workspace/lifecycle/index.html",
    "_iwxa/runtime/0.3.6/runtime.js","_iwxa/ui/d11-workspace-theme.css",
    "_iwxa/ui/d11-site-chrome.js"])
  if(!existsSync(join(dist,file)))throw Error("D11_INTEGRATED_PRODUCT_INCOMPLETE:"+file);
 for(const obsolete of ["server","client","workspace/studio","workspace/_iwxa",
    "_iwxa/runtime/0.1.1","_iwxa/diagnostics"])
  if(existsSync(join(dist,obsolete)))throw Error("D11_OBSOLETE_ASSET_IN_DIST:"+obsolete);
 if(readdirSync(join(dist,"workspace/assets")).some(f=>/^studio-[A-Za-z0-9_-]+\.js$/.test(f)))
  throw Error("D11_STUDIO_NOT_REMOVED");
 // Ensure no Host copy of the runtime and no server-only bundle in the ZIP.
 if(readdirSync(dist).some(name=>name.startsWith(".output")||name==="node_modules"))
  throw Error("D11_ENGINEERING_OUTPUT_IN_DIST");
 for(const entry of ["workspace/index.html","workspace/exchange/index.html",
   "workspace/lifecycle/index.html"]){
  const html=readFileSync(join(dist,entry),"utf8");
  if((html.match(/id="root"/g)||[]).length!==1||
     (html.match(/<nav\b/g)||[]).length!==1||
     (html.match(/<footer\b/g)||[]).length!==1||
     !html.includes("data-t2-site-owned")||
     !html.includes("data-d11-site-owned")||
     !html.includes("/_iwxa/ui/d11-site-chrome.js"))
   throw Error("D11_HOST_PAGE_UNBRANDED:"+entry);
 }
 if(sha(join(dist,"_iwxa/runtime/0.3.6/runtime.js"))!==
    "e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78")
  throw Error("D11_QUALIFIED_RUNTIME_READBACK_MISMATCH");
 // productionActivation:false is a T2 artifact/staging fact, not a domain
 // development mode. Only a human deploys this qualified static distribution.
 console.log("D11_SITE_T2_HOSTING_DIST_READY: "+ARTIFACT+
  " (domain=production; qualified Kernel staged, no grants or deploy performed)");
}finally{if(process.env.IWXA_T2_KEEP_STAGE==="1")console.log("D11_STAGE="+temp);else rmSync(temp,{recursive:true,force:true})}
