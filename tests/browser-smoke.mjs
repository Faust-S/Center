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
  await page.getByTestId('nav-data').click();
  await page.getByTestId('center-age-exchange').waitFor();
  assert.equal(await page.getByTestId('center-age-encrypt').isEnabled(),false);
  assert.equal(await page.getByTestId('center-age-decrypt').isEnabled(),false);
  assert.match(await page.getByTestId('center-age-exchange').innerText(),/установленном Windows-приложении/);
  checks.push('encrypted-iwxa-file-transport-not-executed-in-browser');
  await page.getByTestId('nav-resources').click();await page.getByTestId('workspace-name').fill('Procurement');await page.getByTestId('add-workspace').click();
  // Build a real Atlas snapshot through its pinned domain module, never a fake project record.
  const {empty,createProject,createItem,editProject,serialize}=await import('../vendor/atlas/src/core.mjs');
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
  assert.equal(await page.getByTestId('cen04-select-test-iwxa').count(),0);
  assert.equal(await page.getByTestId('cen04-import-verified-age').isEnabled(),false);
  assert.equal(await page.getByTestId('cen04-import-verified-iwxa').isEnabled(),false);
  assert.equal(await page.getByTestId('cen04-enroll-trust').count(),0);
  assert.equal(await page.getByTestId('center-age-exchange').count(),1);
  assert.equal(await page.getByTestId('center-age-encrypt').count(),0);
  assert.equal(await page.getByTestId('center-age-decrypt').count(),0);
  assert.match(await page.getByTestId('center-age-exchange').innerText(),/Ключ получателя для защищённой лицензии/);
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
  await page.getByText('Содержимое портфеля совпадает с предыдущей копией.').waitFor({state:'visible'});
  assert.match(await page.getByTestId('atlas-copy-difference').innerText(),/портфеля совпадает/);
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
  // Change a project goal only. The small preview lacks this field, but
  // the complete owner snapshot fingerprint must flag the changed archive.
  const goalChanged=editProject(later.state,first.id,{goal:'Updated handoff expectations'});
  const goalArchive=await buildIwxaPortfolio(goalChanged,{now:'2026-11-09T12:00:00.000Z'});
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-goal-updated.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(goalArchive)});
  await page.waitForFunction(expected=>
    document.querySelector('[data-testid="atlas-revision"]')?.textContent?.trim()===expected,
    String(goalChanged.revision));
  assert.match(await page.getByTestId('atlas-copy-difference').innerText(),/Содержимое копии отличается, но краткие показатели совпадают/);
  await page.getByTestId('atlas-import-file').setInputFiles({
    name:'atlas-updated.iwxa',mimeType:'application/octet-stream',buffer:Buffer.from(revisedArchive)});
  await page.waitForFunction(expected=>
    document.querySelector('[data-testid="atlas-revision"]')?.textContent?.trim()===expected,
    String(later.state.revision));
  checks.push('full-owner-content-comparison-detects-hidden-goal-changes');
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
  const previousAtlasRef=await page.getByTestId('assignment-atlas-binding').innerText();
  dismissNextConfirmation=true;
  await page.getByTestId('refresh-assignment-atlas').click();
  assert.equal(await page.getByTestId('assignment-atlas-binding').innerText(),previousAtlasRef,
    'dismissing a revision change must preserve the old WorkRef');
  assert.ok((await page.getByTestId('assignment-atlas-currentness').textContent()).includes('изменился'));
  assert.equal(await page.getByTestId('task-title').inputValue(),'Compare four suppliers');
  const confirmed=page.waitForEvent('dialog');
  await page.getByTestId('refresh-assignment-atlas').click();
  // The existing browser dialog handler accepts the deliberate second request.
  const dialog=await confirmed;
  assert.match(dialog.message(),/Проект: Supply programme/);
  assert.match(dialog.message(),/Работа: Compare suppliers/);
  assert.match(dialog.message(),/\nРабота:/,'confirmation displays readable separate fields');
  assert.match(dialog.message(),/Была редакция:/);
  assert.match(dialog.message(),/Открыта редакция:/);
  assert.ok((await page.getByTestId('assignment-atlas-currentness').textContent()).includes('совпадают'));
  assert.equal(await page.getByTestId('task-title').inputValue(),'Compare four suppliers');
  await page.getByTestId('save-assignment').click();
  checks.push('confirmed-revision-refresh-keeps-work-id-and-unsaved-editor');
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
  // First-use UI with an available ORIGINAL native owner but no local
  // Workspace: manager must be able to create the missing draft Workspace
  // and then return to the ONE signed enrollment command. The native
  // owner below is a UI fixture; it is not original DPAPI qualification.
  const onboardPage=await browser.newPage({viewport:{width:1366,height:900}});
  await onboardPage.addInitScript(()=>{
    const fixture={enrolled:false,workspaceId:null,enrollmentCalls:0,
      draftSaves:0,failSave:true,savedContent:null};
    window.__onboardD3Fixture=fixture;
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='center_draft_read_local')return fixture.savedContent;
      if(command==='center_draft_save_local'){
        fixture.draftSaves++;
        if(fixture.failSave)throw Error('CEN_D3_UI_FIXTURE_DRAFT_DISK_UNAVAILABLE');
        fixture.savedContent=args.content;
        return true;
      }
      if(command==='center_corporate_signed_workspace_status')return {
        schema:'IWXA_CEN_D3_SIGNED_WORKSPACE_UI/1',
        open:false,visible:false,foreignOrOrphaned:false};
      if(command==='center_corporate_state'){
        if(!fixture.enrolled)return {status:'NOT_CONNECTED',enrollmentAvailable:true};
        return {status:'D3_OWNER_READY',snapshot:{
          product:'admin',organizationId:args.organizationId,
          workspaceId:fixture.workspaceId,actorId:'person:local-manager',
          contextId:'context:enrolled',contextEpoch:1,
          d3RecipientAvailable:true,d3TaskIssueAvailable:false,
          d3InspectAvailable:true,d3ApplyAvailable:false,
          d3ApplyRecoverAvailable:false,
          productionActivation:false,T3_READY:false,tasks:[],totalTasks:0
        }};
      }
      if(command==='center_corporate_enroll'){
        if(!args.workspaceId||args.organizationName!=='First use workshop'||
           !fixture.savedContent)
          throw Error('CEN_D3_UI_FIXTURE_ENROLLMENT_ARGUMENTS_INVALID');
        const saved=JSON.parse(fixture.savedContent);
        if(saved.activeOrganizationId!==args.organizationId||
           !saved.organizations?.some(o=>o.id===args.organizationId&&
             o.workspaces.some(w=>w.id===args.workspaceId)))
          throw Error('CEN_D3_UI_FIXTURE_ENROLLMENT_DRAFT_NOT_SAVED');
        fixture.enrollmentCalls++;
        fixture.workspaceId=args.workspaceId;
        fixture.enrolled=true;
        return {status:'D3_OWNER_READY',snapshot:{
          organizationId:args.organizationId,workspaceId:args.workspaceId}};
      }
      if(command==='center_corporate_age_status')return {
        operation:'AGE_STATUS',available:false,recipient:null,
        toolchain:{ready:false},provider:'WINDOWS_UI_FIXTURE',admitted:false};
      return null;
    }};
  });
  await onboardPage.goto('http://127.0.0.1:4173');
  await onboardPage.getByTestId('org-name').fill('First use workshop');
  await onboardPage.getByTestId('create-org').click();
  await onboardPage.getByTestId('nav-results').click();
  await onboardPage.getByTestId('d3-enrollment-no-workspace').waitFor();
  assert.equal(await onboardPage.getByTestId('d3-enroll').isEnabled(),false);
  assert.equal(await onboardPage.getByTestId('d3-enrollment-workspace').count(),0);
  await onboardPage.getByTestId('d3-enrollment-create-workspace').click();
  await onboardPage.getByTestId('workspace-name').fill('Purchasing team');
  await onboardPage.getByTestId('add-workspace').click();
  await onboardPage.getByTestId('nav-results').click();
  await onboardPage.getByTestId('d3-enrollment-workspace').waitFor();
  const signedWorkspaceSelect=onboardPage.getByTestId('d3-enrollment-workspace');
  assert.ok((await signedWorkspaceSelect.locator('option').allTextContents()).includes('Purchasing team'),
    'new Workspace appears as an original enrollment choice');
  const localWorkspaceId=await signedWorkspaceSelect.inputValue();
  assert.ok(localWorkspaceId.length>0,'new Workspace has an explicit local ID');
  assert.equal(await onboardPage.getByTestId('d3-enroll').isEnabled(),true);
  // The first disk save deliberately fails. No signed owner enrollment may
  // occur until the same native draft is actually persisted and reread.
  await onboardPage.getByTestId('d3-enroll').click();
  await onboardPage.getByRole('alert').waitFor({state:'visible'});
  assert.equal((await onboardPage.evaluate(()=>window.__onboardD3Fixture)).enrollmentCalls,0,
    'failed local saving must precede any original T3 enrollment');
  await onboardPage.evaluate(()=>{window.__onboardD3Fixture.failSave=false;});
  await onboardPage.getByTestId('d3-enroll').click();
  try{
    await onboardPage.getByTestId('cen03-d3-original').waitFor({timeout:8000});
  }catch(e){
    // Preserve the precise original owner response and React UI state:
    // a fixture error must never be mislabeled as native signed D3 failure.
    const diagnostic={
      fixture:await onboardPage.evaluate(()=>window.__onboardD3Fixture),
      native:await onboardPage.evaluate(()=>window.__TAURI_INTERNALS__.invoke(
        'center_corporate_state',{organizationId:document.querySelector('#active-organization')?.value})),
      status:await onboardPage.getByTestId('corporate-owner-status').allInnerTexts(),
      alerts:await onboardPage.getByRole('alert').allInnerTexts(),
      panelCount:await onboardPage.getByTestId('cen03-d3-original').count()
    };
    console.error('CEN_D3_FIRST_USE_DIAGNOSTIC',JSON.stringify(diagnostic));
    throw e;
  }
  const firstUse=await onboardPage.evaluate(()=>window.__onboardD3Fixture);
  assert.equal(firstUse.enrollmentCalls,1);
  assert.equal(firstUse.draftSaves,2,'one failed and one verified local save');
  assert.ok(firstUse.savedContent?.includes('Purchasing team'));
  await onboardPage.close();
  checks.push('d3-first-use-no-workspace-persists-and-rereads-before-signed-enrollment');
  // UI-only mock of the EXISTING native signed owner: this does not
  // assert Ed25519, original Kernel or installed T3 integration. It checks
  // that the manager does not lose an attempted Task ID when the signed
  // owner changes its epoch after a write and the ACK disappears.
  const d3Page=await browser.newPage({viewport:{width:1366,height:900}});
  await d3Page.addInitScript(()=>{
    const held={epoch:7,task:null,writes:0,decisionWrites:0,decision:null};
    window.__d3UiFixture=held;
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='center_draft_read_local')return null;
      if(command==='center_corporate_state'){
        const tasks=held.task?[{
          taskId:held.task.taskId,taskRevisionId:'a'.repeat(64),
          packageSha256:'b'.repeat(64),summary:'UI recovery task',
          deliveryState:'NOT_CONFIRMED'
        }]:[];
        return {status:'D3_OWNER_READY',snapshot:{
          product:'admin',organizationId:args.organizationId,
          workspaceId:'workspace:ui-smoke',actorId:'person:reviewer',
          contextId:'context:ui-smoke',contextEpoch:held.epoch,
          d3RecipientAvailable:true,d3TaskIssueAvailable:true,
          d3InspectAvailable:true,d3ApplyAvailable:false,
          d3ApplyRecoverAvailable:false,
          productionActivation:false,T3_READY:false,
          tasks,totalTasks:tasks.length
        }};
      }
      if(command==='center_corporate_age_status')
        return {operation:'AGE_STATUS',available:false,recipient:null,
          toolchain:{ready:false},provider:'WINDOWS_TEST_UI',admitted:false};
      if(command==='center_corporate_action'){
        if(args.binding?.contextEpoch!==held.epoch)
          throw Error('CEN_D3_CONTEXT_CHANGED');
        if(args.operation==='d3CreateTask'){
          held.task={taskId:args.input.taskId};
          held.writes++;held.epoch++;
          throw Error('CEN_D3_ORIGINAL_TASK_WRITE_READBACK_UNKNOWN');
        }
        if(args.operation==='d3TaskReadback')
          return {schema:'IWXA_T3_ORIGINAL_TASK_READBACK/1',
            found:held.task?.taskId===args.input.taskId,
            taskId:args.input.taskId,
            taskRevisionId:'a'.repeat(64),packageSha256:'b'.repeat(64),
            recipientId:'person:reviewer',
            status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED'};
        if(args.operation==='d3Preview'){
          const sha='c'.repeat(64),digest='d'.repeat(64),revision='e'.repeat(64);
          const resultText='Результат выполнен';
          return {schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',
            packageSha256:sha,previewDigest:digest,allowedAction:'EXPLICIT_ACCEPT_ONLY',
            classification:'NEW',entries:[{revisionId:revision}],
            resultInspection:{
              schema:'IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1',
              packageSha256:sha,previewDigest:digest,
              taskId:'task:employee',taskRevisionId:'a'.repeat(64),
              resultRevisionId:revision,executorId:'person:employee',
              organizationId:args.organizationId,workspaceId:'workspace:ui-smoke',
              signatureVerified:true,taskBindingProven:true,
              taskCatalogVerified:true,assignmentText:'Проверить исходный документ',
              resultLength:resultText.length,offset:0,resultText,
              nextOffset:resultText.length,hasMore:false
            }};
        }
        if(args.operation==='d3Decide'){
          held.decisionWrites++;
          held.decision={operationId:args.input.operationId,
            packageSha256:args.input.packageSha256};
          held.epoch++;
          // Model the original owner recording ACCEPT before losing native ACK.
          throw Error('T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED');
        }
        if(args.operation==='d3Receipt'){
          const found=held.decision?.operationId===args.input.operationId&&
            held.decision?.packageSha256===args.input.packageSha256;
          return {kernelApplication:'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT',
            found,receipt:found?{
              schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',
              operationId:held.decision.operationId,
              packageSha256:held.decision.packageSha256,
              decisionBy:'person:reviewer',acceptanceState:'ACCEPTED',
              acceptanceId:'f'.repeat(64)
            }:null};
        }
      }
      return null;
    }};
  });
  await d3Page.goto('http://127.0.0.1:4173');
  await d3Page.getByTestId('org-name').fill('UI signed Task fixture');
  await d3Page.getByTestId('create-org').click();
  await d3Page.getByTestId('nav-results').click();
  await d3Page.getByTestId('d3-signed-task-workflow').waitFor();
  // Installed independent employee authority cannot be inferred from the
  // existing original reviewer alone. When the private owner does not
  // advertise the genuine One Core enrollment port, no UI-issued grant,
  // credential or second-employee Task command may be available.
  await d3Page.getByTestId('d3-employee-owner-unavailable').waitFor();
  assert.equal(await d3Page.getByTestId('d3-employee-steps').count(),0);
  assert.equal(await d3Page.getByTestId('d3-employee-credential-begin').count(),0);
  checks.push('d3-independent-employee-unavailable-without-original-kernel-owner');
  await d3Page.getByTestId('d3-task-text').fill('Check original supplier receipt');
  await d3Page.getByTestId('d3-task-prepare-id').click();
  const attemptedTaskId=await d3Page.getByTestId('d3-task-operation-id').inputValue();
  assert.match(attemptedTaskId,/^task:[A-Za-z0-9-]{1,100}$/);
  await d3Page.getByLabel('Я сохранил этот ID до подписания').check();
  await d3Page.getByTestId('d3-create-task').click();
  await d3Page.getByTestId('d3-task-operation-attempted').waitFor();
  assert.equal(await d3Page.getByTestId('d3-task-operation-id').inputValue(),
    attemptedTaskId,'the original ID must survive signed epoch remount');
  assert.equal(await d3Page.getByTestId('d3-create-task').isEnabled(),false,
    'unknown original ACK cannot allow a second Task signature');
  await d3Page.getByTestId('d3-task-recover').click();
  await d3Page.getByTestId('d3-task-operation-readback').waitFor();
  assert.match(await d3Page.getByTestId('d3-task-operation-readback').innerText(),
    /Оригинальная Task сохранена/);
  assert.equal((await d3Page.evaluate(()=>window.__d3UiFixture)).writes,1,
    'read-only Task recovery must not reissue signed Task');
  checks.push('d3-task-id-and-no-replay-survive-unknown-ack-and-signed-epoch-remount');
  // UI-only owner fixture: ACCEPT commits, native ACK is lost and owner epoch
  // advances. A React remount must retain the original ID for receipt recovery.
  const decisionSha='c'.repeat(64);
  await d3Page.getByTestId('d3-package-sha').fill(decisionSha);
  await d3Page.getByTestId('d3-review').click();
  await d3Page.getByTestId('d3-original-signed-review').waitFor();
  await d3Page.getByLabel('Я просмотрел этот пакет и подтверждаю отдельное решение').check();
  await d3Page.getByTestId('d3-prepare-id').click();
  const pendingDecisionId=await d3Page.getByTestId('d3-operation-id').inputValue();
  await d3Page.getByLabel('Я сохранил ID для восстановления при потере ответа').check();
  await d3Page.getByTestId('d3-accept').click();
  await d3Page.getByTestId('d3-package-sha').fill(decisionSha);
  await d3Page.getByTestId('d3-decision-already-sent').waitFor();
  assert.equal(await d3Page.getByTestId('d3-operation-id').inputValue(),
    pendingDecisionId,'sent Human decision ID must survive signed epoch remount');
  await d3Page.getByTestId('d3-review').click();
  assert.equal(await d3Page.getByTestId('d3-prepare-id').isEnabled(),false,
    'unknown ACCEPT ACK cannot prepare another decision');
  assert.equal(await d3Page.getByTestId('d3-accept').isEnabled(),false);
  await d3Page.getByTestId('d3-recover').click();
  await d3Page.getByTestId('d3-recovered-receipt').waitFor();
  assert.match(await d3Page.getByTestId('d3-recovered-receipt').innerText(),
    /Оригинальная квитанция/);
  assert.equal((await d3Page.evaluate(()=>window.__d3UiFixture)).decisionWrites,1,
    'read-only decision recovery must not send a second ACCEPT');
  checks.push('d3-human-decision-no-replay-survives-unknown-ack-and-signed-epoch-remount');
  // A navigation away fully unmounts CorporatePanel, losing every React
  // decision guard. The original receipt alone must prevent a new ACCEPT.
  // This UI fixture keeps native owner state independent of the React panel.
  await d3Page.getByTestId('nav-overview').click();
  await d3Page.getByTestId('nav-results').click();
  await d3Page.getByTestId('d3-signed-task-workflow').waitFor();
  await d3Page.getByTestId('d3-package-sha').fill(decisionSha);
  await d3Page.getByTestId('d3-operation-id').fill(pendingDecisionId);
  await d3Page.getByTestId('d3-recover').click();
  await d3Page.getByTestId('d3-recovered-receipt').waitFor();
  await d3Page.getByTestId('d3-review').click();
  await d3Page.getByTestId('d3-original-signed-review').waitFor();
  assert.equal(await d3Page.getByTestId('d3-prepare-id').isEnabled(),false,
    'accepted original receipt blocks preparing another decision after cold panel reopen');
  assert.equal(await d3Page.getByTestId('d3-accept').isEnabled(),false,
    'accepted original receipt blocks Human ACCEPT after cold panel reopen');
  assert.equal((await d3Page.evaluate(()=>window.__d3UiFixture)).decisionWrites,1,
    'cold panel receipt recovery must not dispatch another decision');
  checks.push('d3-cold-react-panel-receipt-prevents-duplicate-human-accept');
  await d3Page.close();
  // UI-only native owner fixture: these checks DO NOT qualify cryptography,
  // the original installed T3, independent employee signature or Kernel.
  const employeeState={registered:false,ready:false,reads:0,
    initializations:0,savedDraft:null};
  const employeePage=await browser.newPage({viewport:{width:1366,height:900}});
  await employeePage.exposeFunction('__centerEmployeeFixture',
    async(command,args={})=>{
      if(command==='center_draft_read_local')return employeeState.savedDraft;
      if(command==='center_draft_save_local'){
        employeeState.savedDraft=args.content;return true;
      }
      if(command==='center_corporate_signed_workspace_status')
        return {schema:'IWXA_CEN_D3_SIGNED_WORKSPACE_UI/1',
          open:false,visible:false,foreignOrOrphaned:false};
      if(command==='center_corporate_state')return {
        status:'D3_OWNER_READY',snapshot:{
          product:'admin',organizationId:args.organizationId,
          workspaceId:'workspace:employee-fixture',
          actorId:'person:manager-fixture',
          contextId:'context:employee-fixture',contextEpoch:1,
          d3RecipientAvailable:true,d3TaskIssueAvailable:false,
          d3InspectAvailable:true,d3ApplyAvailable:false,
          d3ApplyRecoverAvailable:false,
          d3EmployeeRegistryBootstrapAvailable:true,
          d3EmployeeRegistryReadbackAvailable:true,
          d3EmployeeEnrollmentAvailable:employeeState.ready,
          d3EmployeeTaskIssueAvailable:false,
          productionActivation:false,T3_READY:false,tasks:[],totalTasks:0
        }};
      if(command==='center_corporate_age_status')return {
        operation:'AGE_STATUS',available:false,recipient:null,
        toolchain:{ready:false},provider:'WINDOWS_TEST_UI',admitted:false};
      if(command==='center_corporate_action'){
        assert.equal(args.binding?.actorId,'person:manager-fixture');
        assert.equal(args.binding?.workspaceId,'workspace:employee-fixture');
        assert.equal(args.binding?.contextEpoch,1);
        if(args.operation==='d3EmployeeRegistryReadback'){
          employeeState.reads++;
          employeeState.ready=employeeState.registered;
          return {
            schema:'IWXA_T3_ORIGINAL_EMPLOYEE_REGISTRY_READBACK/1',
            state:employeeState.registered?'ORIGINAL_KERNEL_REGISTRY_CONFIRMED':
              'ORIGINAL_KERNEL_REGISTRY_NOT_FOUND',
            organizationId:args.organizationId,
            workspaceId:'workspace:employee-fixture',
            originalReadback:true,originalKernel:true,
            signatureVerified:employeeState.registered,
            automaticRetryAllowed:false
          };
        }
        if(args.operation==='d3EmployeeRegistryInitialize'){
          assert.equal(args.input.confirmed,true);
          employeeState.initializations++;
          employeeState.registered=true;employeeState.ready=true;
          return {
            schema:'IWXA_T3_ORIGINAL_EMPLOYEE_REGISTRY_READBACK/1',
            state:'ORIGINAL_KERNEL_REGISTRY_CONFIRMED',
            organizationId:args.organizationId,
            workspaceId:'workspace:employee-fixture',
            originalReadback:true,originalKernel:true,
            signatureVerified:true,automaticRetryAllowed:false
          };
        }
        throw Error('CEN_UI_EMPLOYEE_OPERATION_FORBIDDEN');
      }
      return null;
    });
  await employeePage.addInitScript(()=>{
    window.__TAURI_INTERNALS__={invoke:(command,args)=>
      window.__centerEmployeeFixture(command,args)};
  });
  await employeePage.goto('http://127.0.0.1:4173');
  await employeePage.getByTestId('org-name').fill('Independent staff test');
  await employeePage.getByTestId('create-org').click();
  await employeePage.getByTestId('nav-results').click();
  await employeePage.getByTestId('d3-employee-registry-readback').waitFor();
  await employeePage.getByTestId('d3-employee-registry-readback').click();
  await employeePage.getByRole('alert').waitFor();
  assert.match(await employeePage.getByRole('alert').innerText(),
    /CEN_D3_EMPLOYEE_REGISTRY_NOT_PRESENT_USE_EXPLICIT_INITIALIZE/);
  assert.equal(employeeState.initializations,0,
    'readback NOT_FOUND must never create a signed registry');
  const originalInitButtons=employeePage.getByTestId('d3-employee-registry-initialize');
  const initialButtonsCount=await originalInitButtons.count();
  if(initialButtonsCount!==1){
    const view=await employeePage.locator(
      '[data-testid="d3-employee-registry-initialize"]').evaluateAll(rows=>
      rows.map(row=>({
        disabled:row.disabled,
        root:row.closest('[data-testid="d3-independent-employee"]')?.outerHTML.slice(0,130),
        ancestor:row.parentElement?.className,
        display:getComputedStyle(row).display,
        rectWidth:row.getBoundingClientRect().width
      })));
    console.log('D3_EMPLOYEE_UI_BUTTONS',JSON.stringify(view));
  }
  await originalInitButtons.first().click();
  await employeePage.getByTestId('d3-employee-steps').waitFor();
  assert.equal(employeeState.initializations,1);
  // Real Center persists organization drafts through its existing native
  // service. This fixture must provide the SAME saved draft when the main
  // WebView reloads, or the organization disappears before registry recovery.
  const employeeOrgId=await employeePage.locator('#active-organization').inputValue();
  assert.ok(employeeOrgId);
  employeeState.savedDraft=JSON.stringify({
    format:'iwxa.admin-center.draft',version:1,
    organizations:[{id:employeeOrgId,name:'Independent staff test',
      kind:'ORGANIZATION',workspaces:[],participants:[],assignments:[]}],
    activeOrganizationId:employeeOrgId,
    updatedAt:'2026-11-16T12:00:00.000Z',
  });
  // Simulate cold native owner without losing ORIGINAL persisted Kernel data.
  employeeState.ready=false;
  await employeePage.reload();
  // Ordinary Center startup returns to its overview. Open the original
  // corporate workbench again; native signer state survives navigation.
  await employeePage.getByTestId('nav-results').click();
  await employeePage.getByTestId('d3-employee-registry-readback').waitFor();
  await employeePage.getByTestId('d3-employee-registry-readback').click();
  await employeePage.getByTestId('d3-employee-steps').waitFor();
  assert.equal(employeeState.initializations,1,
    'cold readback does not send a second Kernel initialization');
  assert.equal(employeeState.reads,2);
  assert.equal(await employeePage.getByTestId('d3-employee-task-create').count(),0,
    'registry alone cannot authorize independent employee Task');
  await employeePage.close();
  checks.push('d3-employee-original-registry-ui-cold-readback-no-reissue');
  // React can reload while the REAL native signed WebView (and its Kernel)
  // survives. Model that lifetime using a separate Node-side host, NOT
  // localStorage/React state, so a browser reload cannot recreate its status.
  const nativeState={organizationId:'org:reload-owner',open:true,visible:true,
    shows:0,hides:0,closes:0};
  const restoredDraft=JSON.stringify({
    format:'iwxa.admin-center.draft',version:1,
    organizations:[{id:nativeState.organizationId,name:'D3 recovery factory',
      kind:'ORGANIZATION',workspaces:[],participants:[],assignments:[]}],
    activeOrganizationId:nativeState.organizationId,
    updatedAt:'2026-11-15T12:00:00.000Z',
  });
  const reloadPage=await browser.newPage({viewport:{width:1366,height:900}});
  await reloadPage.exposeFunction('__centerNativeSignedFixture',
    async(command,args={})=>{
      if(command==='center_draft_read_local')return restoredDraft;
      if(command==='center_corporate_signed_workspace_status'){
        const same=nativeState.open&&args.organizationId===nativeState.organizationId;
        return {schema:'IWXA_CEN_D3_SIGNED_WORKSPACE_UI/1',
          open:same,visible:same&&nativeState.visible,
          foreignOrOrphaned:nativeState.open&&!same};
      }
      if(command==='center_corporate_close_signed_workspace'){
        nativeState.open=false;nativeState.visible=false;nativeState.closes++;return null;
      }
      if(command==='center_corporate_hide_signed_workspace'){
        assert.equal(nativeState.open,true);
        nativeState.visible=false;nativeState.hides++;return null;
      }
      if(command==='center_corporate_show_signed_workspace'){
        assert.equal(args.organizationId,nativeState.organizationId);
        assert.equal(nativeState.open,true);
        nativeState.visible=true;nativeState.shows++;return null;
      }
      if(command==='center_corporate_state')return {
        status:'D3_OWNER_READY',snapshot:{
          product:'admin',organizationId:args.organizationId,
          workspaceId:'workspace:reload-owner',actorId:'person:reviewer',
          contextId:'context:reload-owner',contextEpoch:4,
          originalSignedWorkspaceAvailable:true,
          d3RecipientAvailable:true,d3TaskIssueAvailable:false,
          d3InspectAvailable:true,d3ApplyAvailable:false,
          d3ApplyRecoverAvailable:false,
          productionActivation:false,T3_READY:false,tasks:[],totalTasks:0,
        }};
      if(command==='center_corporate_age_status')
        return {operation:'AGE_STATUS',available:false,recipient:null,
          toolchain:{ready:false},provider:'WINDOWS_TEST_UI',admitted:false};
      return null;
    });
  await reloadPage.addInitScript(()=>{
    window.__TAURI_INTERNALS__={invoke:(command,args)=>
      window.__centerNativeSignedFixture(command,args)};
  });
  await reloadPage.goto('http://127.0.0.1:4173');
  await reloadPage.getByTestId('d3-return-to-review').waitFor({state:'visible'});
  assert.equal(nativeState.shows,0,'restoring visible child must not respawn it');
  await reloadPage.reload();
  await reloadPage.getByTestId('d3-return-to-review').waitFor({state:'visible'});
  assert.equal(nativeState.shows,0,'main React reload must not reopen Kernel');
  assert.equal(nativeState.closes,0,'main React reload must not release signer');
  await reloadPage.getByTestId('d3-return-to-review').click();
  await reloadPage.getByTestId('d3-show-signed-workspace').waitFor({state:'visible'});
  assert.equal(nativeState.hides,1);
  await reloadPage.reload();
  await reloadPage.getByTestId('d3-show-signed-workspace').waitFor({state:'visible'});
  assert.equal(nativeState.visible,false);
  assert.equal(nativeState.closes,0);
  await reloadPage.getByTestId('d3-show-signed-workspace').click();
  await reloadPage.getByTestId('d3-return-to-review').waitFor({state:'visible'});
  assert.equal(nativeState.shows,1);
  await reloadPage.getByTestId('d3-close-signed-workspace').click();
  await reloadPage.getByTestId('d3-return-to-review').waitFor({state:'detached'});
  assert.equal(nativeState.open,false);
  assert.equal(nativeState.closes,1);
  await reloadPage.reload();
  await reloadPage.getByTestId('d3-show-signed-workspace').waitFor({state:'detached'});
  assert.equal(await reloadPage.getByTestId('d3-return-to-review').count(),0);
  await reloadPage.close();
  checks.push('d3-native-child-visible-and-hidden-react-reload-restores-review-without-owner-restart');
  writeFileSync('artifacts/ui-report.json',JSON.stringify({status:'PASS_BROWSER_DRAFT_SCOPE',browser:'Firefox',checks,errors,t3RuntimeIntegrated:false,installedWindowsGui:false},null,2));
  console.log('CENTER_DRAFT_UI_PASS',checks.length);
}finally{await browser?.close();server.kill();}
