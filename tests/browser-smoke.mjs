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
  let dismissNextConfirmation=false;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>{
    if(dismissNextConfirmation){dismissNextConfirmation=false;return dialog.dismiss();}
    return dialog.accept();
  });
  await page.goto('http://127.0.0.1:4173');
  await page.getByTestId('org-name').fill('North workshop');await page.getByTestId('create-org').click();
  await page.getByTestId('nav-resources').click();await page.getByTestId('workspace-name').fill('Procurement');await page.getByTestId('add-workspace').click();
  // Build a real Atlas snapshot through its pinned domain module, never a fake project record.
  const {empty,createProject,createItem,serialize}=await import('../vendor/atlas/src/core.mjs');
  const first=createProject(empty(),{name:'Supply programme',type:'business'});
  const work=createItem(first.state,first.id,{title:'Compare suppliers'});
  const atlas=serialize(work.state);
  await page.getByTestId('atlas-import-file').setInputFiles({name:'atlas.json',mimeType:'application/json',buffer:Buffer.from(atlas)});
  assert.equal(await page.getByTestId('atlas-project-count').textContent(),'1');
  const {buildIwxaPortfolio}=await import('../vendor/atlas/desktop/src/iwxa-portfolio.mjs');
  const iwxa=await buildIwxaPortfolio(work.state,{now:'2026-11-09T10:00:00.000Z'});
  const corrupt=Uint8Array.from(iwxa);corrupt[corrupt.length-30]^=1;
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'tampered.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(corrupt)});
  await page.getByRole('alert').waitFor({state:'visible'});
  assert.equal(await page.getByTestId('atlas-project-count').textContent(),'1');
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(iwxa)});
  await page.getByText(/Архив .iwxa открыт для просмотра/).waitFor({state:'visible'});
  const previewNote=await page.locator('[data-testid="atlas-link-panel"] .fine-print').innerText();
  assert.match(previewNote,/Это снимок, а не синхронизация/);
  assert.doesNotMatch(previewNote,/project\/1/);
  assert.equal(await page.getByTestId('atlas-project-count').textContent(),'1');
  assert.equal(await page.getByTestId('atlas-revision').textContent(),String(work.state.revision));
  checks.push('atlas-iwxa-real-file-picker-valid-and-tampered-archive-rejected');
  await page.getByTestId('link-atlas').click();
  checks.push('atlas-real-portfolio-project-selection-and-link');
  await page.getByTestId('nav-people').click();
  for(const name of ['Anna','Boris']){await page.getByTestId('person-name').fill(name);await page.getByTestId('add-person').click();}
  await page.getByTestId('nav-programs').click();await page.getByTestId('plan-agent-seat').first().click();
  assert.equal(await page.getByTestId('planned-agent-seats').textContent(),'1');checks.push('manager-plans-agent-seat-no-license-claim');
  assert.equal(await page.getByTestId('cen04-select-test-iwxa').isEnabled(),false);
  assert.equal(await page.getByTestId('cen04-iwxa-unverified').count(),0);
  assert.match(await page.getByTestId('cen04-test-license-panel').innerText(),/установленном Admin Center/);
  checks.push('cen04-desktop-file-picker-disabled-without-native-host-and-zero-seats');
  await page.getByTestId('nav-resources').click();
  await page.getByTestId('atlas-file-work-to-assignment').first().click();
  assert.ok((await page.getByTestId('assignment-atlas-binding').textContent()).includes(work.id));
  checks.push('atlas-specific-work-linked-to-assignment');
  await page.getByTestId('task-title').fill('Compare three suppliers');await page.getByTestId('task-criteria').fill('Three comparable offers with delivery dates');await page.getByTestId('save-assignment').click();
  assert.equal(await page.getByTestId('assignment-row').count(),1);
  assert.ok((await page.getByTestId('assignment-atlas-status').textContent()).includes('совпадают'));
  checks.push('organization-workspace-two-participants-assignment');
  await page.getByTestId('assignment-row').click();await page.getByTestId('task-title').fill('Compare four suppliers');await page.getByTestId('save-assignment').click();checks.push('edit-draft');
  const later=createItem(work.state,first.id,{title:'Verify new supplier'});
  await page.getByTestId('nav-resources').click();
  const revisedArchive=await buildIwxaPortfolio(later.state,{now:'2026-11-09T11:00:00.000Z'});
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-updated.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(revisedArchive)});
  // Parsing a ZIP is async. Wait for the NEW file's revision, not stale
  // comparison text left from the previous successful file.
  await page.waitForFunction(expected=>
    document.querySelector('[data-testid="atlas-revision"]')?.textContent?.trim()===expected,
    String(later.state.revision));
  assert.match(await page.getByTestId('atlas-copy-difference').innerText(),/работ добавлено 1/);
  assert.match(await page.getByTestId('atlas-file-links-review').innerText(),/требующими проверки: 1/);
  assert.equal(await page.getByTestId('atlas-revision').textContent(),String(later.state.revision));
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-updated.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(revisedArchive)});
  await page.getByText('Состав копии не изменился с предыдущего открытия.').waitFor({state:'visible'});
  assert.match(await page.getByTestId('atlas-copy-difference').innerText(),/не изменился/);
  // An older manually selected archive must be called out, not silently
  // treated as the current source merely because a previous link still fits.
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-older.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(iwxa)});
  await page.getByTestId('atlas-file-older').waitFor({state:'visible'});
  assert.equal(await page.getByTestId('atlas-revision').textContent(),String(work.state.revision));
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-updated.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(revisedArchive)});
  await page.waitForFunction(expected=>
    document.querySelector('[data-testid="atlas-revision"]')?.textContent?.trim()===expected,
    String(later.state.revision));
  assert.match(await page.getByTestId('atlas-copy-difference').innerText(),/работ добавлено 1/);
  await page.screenshot({path:'artifacts/atlas-file-comparison.png',fullPage:true});
  checks.push('older-file-warning-and-new-copy-restored-without-rebinding');
  const tamperedAgain=Uint8Array.from(revisedArchive);
  tamperedAgain[tamperedAgain.length-30]^=1;
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'broken-update.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(tamperedAgain)});
  await page.getByText(/Предыдущая копия осталась на экране/).waitFor({state:'visible'});
  assert.match(await page.getByRole('alert').innerText(),/Предыдущая копия осталась на экране/);
  assert.equal(await page.getByTestId('atlas-revision').textContent(),String(later.state.revision));
  checks.push('atlas-reopened-iwxa-compared-and-damaged-copy-retained-old-preview');
  await page.getByTestId('nav-work').click();
  assert.ok((await page.getByTestId('assignment-atlas-status').textContent()).includes('изменился'));
  await page.getByTestId('assignment-row').click();
  assert.ok(await page.getByTestId('refresh-assignment-atlas').isVisible());
  await page.getByTestId('task-title').fill('Unsaved editor text');
  await page.getByTestId('nav-resources').click();
  await page.getByTestId('atlas-file-work-to-assignment').first().click();
  assert.ok(await page.getByRole('alert').isVisible());
  await page.getByTestId('nav-work').click();
  assert.equal(await page.getByTestId('task-title').inputValue(),'Unsaved editor text');
  await page.getByTestId('task-title').fill('Compare four suppliers');
  await page.getByTestId('refresh-assignment-atlas').click();
  assert.ok((await page.getByTestId('assignment-atlas-currentness').textContent()).includes('совпадают'));
  await page.getByTestId('save-assignment').click();
  checks.push('explicit-plan-relink-keeps-unsaved-editor-and-original-work-id');
  await page.getByTestId('assignment-row').first().click();
  await page.getByTestId('task-title').fill('This unsaved next task must be retained');
  await page.getByTestId('nav-results').click();
  await page.getByRole('button',{name:'Подготовить поручение'}).click();
  assert.equal(await page.getByTestId('task-title').inputValue(),
    'This unsaved next task must be retained');
  assert.match(await page.getByRole('alert').innerText(),/Уже открыт редактор/);
  dismissNextConfirmation=true;
  await page.getByRole('button',{name:'Закрыть редактор'}).click();
  assert.equal(await page.getByTestId('task-title').inputValue(),
    'This unsaved next task must be retained','cancel must not discard unsaved editor');
  await page.getByRole('button',{name:'Закрыть редактор'}).click();
  assert.equal(await page.getByTestId('assignment-form').count(),0);
  checks.push('results-prepare-keeps-existing-unsaved-task-editor-and-confirmed-discard');
  const downloaded=page.waitForEvent('download');await page.locator('.top-save').click();const download=await downloaded;const path=await download.path();const raw=readFileSync(path,'utf8');const saved=JSON.parse(raw);
  assert.equal(saved.organizations[0].assignments[0].editNumber,3);assert.equal(saved.organizations[0].participants.length,2);
  assert.equal(saved.organizations[0].assignments[0].atlasRef.projectId,first.id);
  assert.equal(saved.organizations[0].assignments[0].atlasRef.workId,work.id);
  assert.equal(saved.organizations[0].assignments[0].atlasRef.revision,String(later.state.revision));
  assert.equal(saved.organizations[0].participants[0].personalAgentPlan,'PLANNED');checks.push('export-draft-file');
  await page.reload();await page.getByTestId('open-draft').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('nav-work').click();assert.equal(await page.getByTestId('assignment-row').count(),1);checks.push('reload-import-original-ids');
  await page.getByTestId('nav-resources').click();assert.ok(await page.getByText('Файл Atlas не открыт').isVisible());checks.push('atlas-preview-not-persisted-as-authority');
  await page.getByTestId('open-draft').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await page.getByRole('alert').waitFor({state:'visible'});
  assert.match(await page.getByRole('alert').innerText(),/изменение не выполнено|проверьте поля|черновик|файл/i);
  await page.getByTestId('nav-work').click();
  assert.equal(await page.getByTestId('assignment-row').count(),1);
  assert.equal(await page.getByTestId('assignment-row').first().locator('strong').innerText(),'Compare four suppliers');
  checks.push('bad-file-preserves-open-work');
  await page.getByTestId('open-draft').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await page.getByTestId('nav-resources').click();
  await page.getByTestId('atlas-import-file').setInputFiles({name:'north-project.json',mimeType:'application/json',buffer:Buffer.from(atlas)});
  assert.equal(await page.getByTestId('atlas-project-count').textContent(),'1');
  // Switching organizational draft context cannot reuse the previous source.
  await page.locator('.sidebar-add').click();
  await page.getByTestId('org-name').fill('South workshop');
  await page.getByTestId('create-org').click();
  await page.getByTestId('nav-resources').click();
  assert.equal(await page.getByTestId('atlas-project-count').count(),0);
  await page.getByText('Откройте портфель Atlas',{exact:true}).waitFor({state:'visible'});
  await page.getByTestId('workspace-name').fill('South quality');
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('nav-work').click();
  assert.equal(await page.getByTestId('assignment-row').count(),0);
  await page.locator('#active-organization').selectOption({label:'North workshop'});
  assert.equal(await page.getByTestId('assignment-row').count(),1);
  await page.getByTestId('nav-resources').click();
  assert.equal(await page.getByTestId('atlas-project-count').count(),0);
  await page.locator('#active-organization').selectOption({label:'South workshop'});
  assert.equal(await page.getByTestId('atlas-project-count').count(),0);
  checks.push('two-organization-draft-isolation-and-file-source-scope');
  await page.getByTestId('nav-results').click();
  await page.getByTestId('corporate-owner-status').waitFor({state:'visible'});
  assert.match(await page.getByTestId('corporate-owner-status').innerText(),/NOT_CONNECTED/);
  assert.equal(await page.getByTestId('corporate-issue').isEnabled(),false);
  assert.equal(await page.getByTestId('corporate-accept').count(),0);
  checks.push('corporate-workbench-fail-closed-without-private-owner');
  await page.getByTestId('nav-overview').click();await page.screenshot({path:'artifacts/overview-1366.png',fullPage:true});
  await page.setViewportSize({width:320,height:800});assert.ok(await page.locator('.menu-button').isVisible());await page.locator('.menu-button').click();await page.getByTestId('nav-work').click();
  const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));checks.push('navigation-and-no-overflow-320');
  await page.screenshot({path:'artifacts/work-320.png',fullPage:true});assert.deepEqual(errors,[]);checks.push('no-page-errors');
  writeFileSync('artifacts/ui-report.json',JSON.stringify({status:'PASS_BROWSER_DRAFT_SCOPE',browser:'Firefox',checks,errors,t3RuntimeIntegrated:false,installedWindowsGui:false},null,2));
  console.log('CENTER_DRAFT_UI_PASS',checks.length);
}finally{await browser?.close();server.kill();}
