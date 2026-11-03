import {firefox} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('artifacts',{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'pipe'});
let browser;
const checks=[],errors=[];
try{
  let ready=false;
  for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:4173');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'preview server started');
  browser=await firefox.launch();
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto('http://127.0.0.1:4173');
  await page.getByTestId('org-name').fill('North workshop');await page.getByTestId('create-org').click();
  await page.getByTestId('nav-resources').click();await page.getByTestId('workspace-name').fill('Procurement');await page.getByTestId('add-workspace').click();
  await page.getByTestId('atlas-project-id').fill('atlas:project-42');await page.getByTestId('atlas-project-revision').fill('revision-1');await page.getByTestId('link-atlas').click();
  checks.push('atlas-workspace-project-revision-draft');
  await page.getByTestId('nav-people').click();
  for(const name of ['Anna','Boris']){await page.getByTestId('person-name').fill(name);await page.getByTestId('add-person').click();}
  await page.getByTestId('nav-programs').click();await page.getByTestId('plan-agent-seat').first().click();
  assert.equal(await page.getByTestId('planned-agent-seats').textContent(),'1');checks.push('manager-plans-agent-seat-no-license-claim');
  await page.getByTestId('nav-work').click();await page.locator('.section-head .primary').click();
  await page.getByTestId('task-title').fill('Compare three suppliers');await page.getByTestId('task-criteria').fill('Three comparable offers with delivery dates');await page.getByTestId('save-assignment').click();
  assert.equal(await page.getByTestId('assignment-row').count(),1);checks.push('organization-workspace-two-participants-assignment');
  await page.getByTestId('assignment-row').click();await page.getByTestId('task-title').fill('Compare four suppliers');await page.getByTestId('save-assignment').click();checks.push('edit-draft');
  const downloaded=page.waitForEvent('download');await page.locator('.top-save').click();const download=await downloaded;const path=await download.path();const raw=readFileSync(path,'utf8');const saved=JSON.parse(raw);
  assert.equal(saved.organizations[0].assignments[0].editNumber,2);assert.equal(saved.organizations[0].participants.length,2);
  assert.equal(saved.organizations[0].assignments[0].atlasRef.projectId,'atlas:project-42');
  assert.equal(saved.organizations[0].participants[0].personalAgentPlan,'PLANNED');checks.push('export-draft-file');
  await page.reload();await page.getByTestId('open-draft').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('nav-work').click();assert.equal(await page.getByTestId('assignment-row').count(),1);checks.push('reload-import-original-ids');
  await page.getByTestId('open-draft').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});assert.ok(await page.getByRole('alert').isVisible());assert.equal(await page.getByTestId('assignment-row').count(),1);checks.push('bad-file-preserves-open-work');
  await page.getByTestId('open-draft').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('nav-overview').click();await page.screenshot({path:'artifacts/overview-1366.png',fullPage:true});
  await page.setViewportSize({width:320,height:800});assert.ok(await page.locator('.menu-button').isVisible());await page.locator('.menu-button').click();await page.getByTestId('nav-work').click();
  const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));checks.push('navigation-and-no-overflow-320');
  await page.screenshot({path:'artifacts/work-320.png',fullPage:true});assert.deepEqual(errors,[]);checks.push('no-page-errors');
  writeFileSync('artifacts/ui-report.json',JSON.stringify({status:'PASS_BROWSER_DRAFT_SCOPE',browser:'Firefox',checks,errors,t3RuntimeIntegrated:false,installedWindowsGui:false},null,2));
  console.log('CENTER_DRAFT_UI_PASS',checks.length);
}finally{await browser?.close();server.kill();}
