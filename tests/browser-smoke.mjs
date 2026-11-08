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
  // Build a real Atlas snapshot through its pinned domain module, never a fake project record.
  const {empty,createProject,createItem,serialize}=await import('../vendor/atlas/src/core.mjs');
  const first=createProject(empty(),{name:'Supply programme',type:'business'});
  const work=createItem(first.state,first.id,{title:'Compare suppliers'});
  const atlas=serialize(work.state);
  await page.getByTestId('atlas-import-file').setInputFiles({name:'atlas.json',mimeType:'application/json',buffer:Buffer.from(atlas)});
  assert.equal(await page.getByTestId('atlas-project-count').textContent(),'1');
  await page.getByTestId('link-atlas').click();
  checks.push('atlas-real-portfolio-project-selection-and-link');
  await page.getByTestId('nav-people').click();
  for(const name of ['Anna','Boris']){await page.getByTestId('person-name').fill(name);await page.getByTestId('add-person').click();}
  await page.getByTestId('nav-programs').click();await page.getByTestId('plan-agent-seat').first().click();
  assert.equal(await page.getByTestId('planned-agent-seats').textContent(),'1');checks.push('manager-plans-agent-seat-no-license-claim');
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
  await page.getByTestId('atlas-import-file').setInputFiles({name:'atlas-updated.json',mimeType:'application/json',buffer:Buffer.from(serialize(later.state))});
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
  await page.getByRole('button',{name:'Закрыть редактор'}).click();
  checks.push('results-prepare-keeps-existing-unsaved-task-editor');
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
  assert.match(await page.getByTestId('corporate-offline-readiness').innerText(),/T3 организации не подключён/);
  await page.getByTestId('corporate-offline-instructions').locator('summary').click();
  const guidance=await page.getByTestId('corporate-offline-instructions').innerText();
  assert.match(guidance,/Atlas/);
  assert.match(guidance,/JSON-портфель/);
  assert.match(guidance,/Сохранить .iwxa/);
  assert.match(guidance,/Personal Agent/);
  assert.match(guidance,/ACCEPT\/REJECT/);
  assert.match(guidance,/не доказывает доставку/);
  assert.equal(await page.getByTestId('corporate-issue').isEnabled(),false);
  assert.equal(await page.getByTestId('corporate-export').isEnabled(),false);
  assert.equal(await page.getByTestId('corporate-receive').isEnabled(),false);
  assert.match(await page.getByTestId('cen05-not-connected').innerText(),/NOT_CONNECTED/);
  assert.equal(await page.getByTestId('corporate-accept').count(),0);
  checks.push('corporate-workbench-offline-handoff-reality-and-fail-closed-without-private-owner');

  // Strictly synthetic owner stub: this checks rendering of a confirmed T3
  // application-shaped readback without activating any production PA/T3 port.
  const {emptyDraft,applyDraftCommand,encodeDraft,assignmentText}=await import('../src/organization.mjs');
  const ids=['org:synthetic','workspace:synthetic','person:staff','person:reviewer','assignment:synthetic'];
  const ops={id:()=>ids.shift(),now:()=>'2026-11-08T00:00:00.000Z'};
  let synthetic=emptyDraft(ops.now());
  const use=(cmd)=>{synthetic=applyDraftCommand(synthetic,cmd,ops)};
  use({type:'CREATE_ORGANIZATION',name:'Isolated synthetic owner'});
  const oid=synthetic.activeOrganizationId;
  use({type:'ADD_WORKSPACE',organizationId:oid,name:'Delivery'});
  use({type:'ADD_PARTICIPANT',organizationId:oid,name:'Employee',roleLabel:'Executor'});
  use({type:'ADD_PARTICIPANT',organizationId:oid,name:'Reviewer',roleLabel:'Reviewer'});
  const org=synthetic.organizations[0],workId=org.workspaces[0].id;
  const people=org.participants,workRef={projectId:'project:synthetic',workId:'work:synthetic',revision:'7'};
  use({type:'SAVE_ASSIGNMENT',organizationId:oid,workspaceId:workId,title:'Inspect evidence',
    assigneeId:people[0].id,reviewerId:people[1].id,description:'Work',criteria:'Verified',
    atlasRef:workRef});
  const assignment=synthetic.organizations[0].assignments[0],taskRevisionId='a'.repeat(64),resultRevisionId='b'.repeat(64);
  use({type:'RECORD_ISSUED_TASK_LINK',organizationId:oid,workspaceId:workId,
    assignmentId:assignment.id,assignmentEditNumber:assignment.editNumber,
    assigneeId:people[0].id,reviewerId:people[1].id,recipientId:'person:staff',
    taskId:'task:synthetic',taskRevisionId,atlasRef:workRef});
  const exactResult='Полный результат T3.\\nВторая строка <script>всегда текст</script>.\\n'.replaceAll('\\n','\n')+'Данные проверки без сокращений.';
  const snapshot={product:'admin',organizationId:oid,workspaceId:workId,personId:'person:staff',
    task:{id:'task:synthetic',taskRevisionId},
    contextEpoch:1,productionActivation:true,T3_READY:true,packages:[],receipts:[],
    application:{status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',externalContextCoreApplied:false,
      records:[{organizationId:oid,workspaceId:workId,taskId:'task:synthetic',
        taskRevisionId,resultRevisionId,executorId:'person:staff',
        acceptanceId:'acceptance:synthetic',result:exactResult},
        {organizationId:oid,workspaceId:workId,taskId:'task:unlinked',
         taskRevisionId:'c'.repeat(64),resultRevisionId:'d'.repeat(64),
         executorId:'person:staff',acceptanceId:'acceptance:unlinked',
         result:'T3 Apply without an issuer-side Atlas WorkRef'}]}};
  const draftText=encodeDraft(synthetic);
  const view={status:'OWNER_READY',snapshot};
  const evidencePage=await browser.newPage({viewport:{width:1200,height:900}});
  evidencePage.on('pageerror',e=>errors.push(e.message));
  await evidencePage.addInitScript(({draftText,view})=>{
    window.__TAURI_INTERNALS__={invoke:async command=>{
      if(command==='center_draft_read_state_local')return {content:draftText,generation:'a'.repeat(64)};
      if(command==='center_corporate_state')return view;
      throw Error('TEST_ONLY_UNSUPPORTED_NATIVE_OPERATION');
    }};
  },{draftText,view});
  await evidencePage.goto('http://127.0.0.1:4173');
  await evidencePage.getByTestId('nav-results').click();
  await evidencePage.getByTestId('cen05-applied-list').waitFor({state:'visible'});
  assert.equal(await evidencePage.getByTestId('corporate-export').isEnabled(),true,
    'only a signed Task with a saved exact issuer WorkRef may be offered for export');
  assert.match(await evidencePage.getByTestId('cen02-export-link-confirmed').innerText(),/work:synthetic/);
  assert.equal(await evidencePage.getByTestId('cen05-applied-work').count(),1);
  assert.match(await evidencePage.getByTestId('cen05-unlinked-count').innerText(),/1/);
  assert.match(await evidencePage.getByTestId('cen05-unlinked-count').innerText(),/WorkRef/);
  assert.match(await evidencePage.getByTestId('cen05-applied-list').innerText(),/work:synthetic/);
  assert.match(await evidencePage.getByTestId('cen05-applied-list').innerText(),/Atlas не открыт/);
  assert.equal(await evidencePage.getByTestId('cen05-applied-result-text').count(),0,
    'large T3 result text stays unmounted until manager expands it');
  await evidencePage.getByTestId('cen05-evidence-details').locator('summary').click();
  assert.equal(await evidencePage.getByTestId('cen05-applied-result-text').textContent(),exactResult);
  assert.equal(await evidencePage.locator('script').filter({hasText:'всегда текст'}).count(),0,
    'result text cannot execute HTML inserted by an external employee');
  assert.match(await evidencePage.getByTestId('cen05-evidence-details').innerText(),/ACCEPT receipt/);
  assert.match(await evidencePage.getByTestId('cen05-evidence-details').innerText(),/person:staff/);
  assert.match(await evidencePage.getByTestId('cen05-evidence-details').innerText(),/не утверждается/);
  await evidencePage.getByTestId('cen05-evidence-details').locator('summary').click();
  assert.equal(await evidencePage.getByTestId('cen05-applied-result-text').count(),0);
  await evidencePage.getByTestId('cen05-go-to-atlas').click();
  await evidencePage.getByTestId('cen05-atlas-work-focus').waitFor({state:'visible'});
  assert.match(await evidencePage.getByTestId('cen05-atlas-work-focus').innerText(),/work:synthetic/);
  assert.match(await evidencePage.getByTestId('cen05-atlas-focus-status').innerText(),/не открыт/);
  assert.equal(await evidencePage.getByTestId('cen05-atlas-focus-work').count(),0,
    'an absent Atlas source cannot assert a work title or completion state');
  await evidencePage.getByTestId('nav-results').click();
  assert.equal(await evidencePage.getByTestId('cen05-applied-work').count(),1);
  await evidencePage.close();
  checks.push('synthetic-t3-owner-applied-result-expanded-full-read-only-no-html-execution');
  // The same signed T3 Task without a durable Center WorkRef must NOT be
  // exported. This is only a synthetic UI adapter test, not a T3 signature.
  const noLinkDraft=structuredClone(synthetic);
  delete noLinkDraft.organizations[0].issuedTaskLinks;
  const noLinkPage=await browser.newPage({viewport:{width:1200,height:900}});
  noLinkPage.on('pageerror',e=>errors.push(e.message));
  await noLinkPage.addInitScript(({draftText,view})=>{
    window.__TAURI_INTERNALS__={invoke:async command=>{
      if(command==='center_draft_read_state_local')return {content:draftText,generation:'a'.repeat(64)};
      if(command==='center_corporate_state')return view;
      throw Error('TEST_ONLY_UNSUPPORTED_NATIVE_OPERATION');
    }};
  },{draftText:encodeDraft(noLinkDraft),view});
  await noLinkPage.goto('http://127.0.0.1:4173');
  await noLinkPage.getByTestId('nav-results').click();
  await noLinkPage.getByTestId('cen02-export-link-missing').waitFor({state:'visible'});
  assert.equal(await noLinkPage.getByTestId('corporate-export').isEnabled(),false);
  assert.match(await noLinkPage.getByTestId('cen02-export-link-missing').innerText(),
    /не выдавайте Task повторно/i);
  await noLinkPage.close();
  checks.push('synthetic-cen02-export-requires-persisted-exact-issuer-workref');

  // The signed T3 Task still exists, but the native Center CAS failed.
  // A second window may have changed unrelated draft data meanwhile.
  // Recovery must rebase on the current stored generation without any
  // createTask/issue/export or organizational authority simulation.
  const taskText=assignmentText(org,assignment);
  const signedTask={id:'task:synthetic',taskRevisionId,task:taskText,
    assignedTo:'person:staff',organizationId:oid,workspaceId:workId,
    signedClaims:{schema:'IWXA_T3_RECONCILIATION_CLAIMS/1',
      profile:{id:'interop.task'},
      scope:{subjectId:oid,workspaceId:workId,recipientId:'person:staff'},
      changes:[{id:'task:synthetic',revisionId:taskRevisionId,
        body:{schemaId:'interop.task.v1',task:taskText}}]}};
  const recoveryView={status:'OWNER_READY',
    snapshot:{...snapshot,task:signedTask}};
  const externalDraft=applyDraftCommand(noLinkDraft,{
    type:'ADD_WORKSPACE',organizationId:oid,name:'Another window new workspace'
  },{id:()=> 'workspace:another-window',now:()=>'2026-11-08T13:00:00.000Z'});
  const installRecoveryMock=async (page)=>{
    await page.addInitScript(({draftText,view})=>{
      let content=draftText,generation='a'.repeat(64),saves=0,ownerActions=0;
      window.__TEST_RECOVERY__={
        otherWindowSave(next){content=next;generation='c'.repeat(64)},
        snapshot(){return {content,generation,saves,ownerActions}}
      };
      window.__TAURI_INTERNALS__={invoke:async (command,args)=>{
        if(command==='center_draft_read_state_local')return {content,generation};
        if(command==='center_corporate_state')return view;
        if(command==='center_draft_save_local'){
          if(args?.expectedGeneration!==generation)
            throw Error('CEN_DRAFT_CONCURRENT_UPDATE');
          content=args.content;generation='b'.repeat(64);saves++;
          return {content,generation};
        }
        if(command==='center_corporate_action'){ownerActions++;throw Error('TEST_MUST_NOT_REISSUE_TASK')}
        throw Error('TEST_ONLY_UNSUPPORTED_NATIVE_OPERATION: '+command);
      }};
    },{draftText:encodeDraft(noLinkDraft),view:recoveryView});
  };
  const recoveryPage=await browser.newPage({viewport:{width:1200,height:900}});
  recoveryPage.on('pageerror',e=>errors.push(e.message));
  await installRecoveryMock(recoveryPage);
  await recoveryPage.goto('http://127.0.0.1:4173');
  await recoveryPage.getByTestId('nav-results').click();
  await recoveryPage.getByTestId('corporate-assignment').selectOption(assignment.id);
  await recoveryPage.getByTestId('cen02-recovery-preview').waitFor({state:'visible'});
  assert.equal(await recoveryPage.getByTestId('corporate-export').isEnabled(),false);
  await recoveryPage.evaluate(next=>window.__TEST_RECOVERY__.otherWindowSave(next),
    encodeDraft(externalDraft));
  await recoveryPage.getByTestId('cen02-recovery-consent').check();
  await recoveryPage.getByTestId('cen02-recover-link').click();
  await recoveryPage.getByTestId('cen02-export-link-confirmed').waitFor({state:'visible'});
  assert.equal(await recoveryPage.getByTestId('corporate-export').isEnabled(),true);
  const recovered=await recoveryPage.evaluate(()=>window.__TEST_RECOVERY__.snapshot());
  assert.equal(recovered.saves,1,'one native CAS write only');
  assert.equal(recovered.ownerActions,0,'recovery cannot reissue, sign or export Task');
  const recoveredDraft=JSON.parse(recovered.content);
  assert.equal(recoveredDraft.organizations[0].workspaces.length,2,
    'concurrent unrelated native draft edits must be preserved');
  const recoveredLink=recoveredDraft.organizations[0].issuedTaskLinks[0];
  assert.equal(recoveredLink.taskId,'task:synthetic');
  assert.equal(recoveredLink.taskRevisionId,taskRevisionId);
  assert.deepEqual(recoveredLink.atlasRef,workRef);
  assert.equal(recoveredLink.deliveryState,'NOT_CONFIRMED');
  await recoveryPage.close();

  // A second window edits the SELECTED assignment. No recovery write may
  // merge that changed source with the old signed task.
  const changedDraft=applyDraftCommand(noLinkDraft,{
    type:'SAVE_ASSIGNMENT',organizationId:oid,assignmentId:assignment.id,
    expectedEditNumber:assignment.editNumber,workspaceId:workId,
    title:assignment.title,assigneeId:assignment.assigneeId,
    reviewerId:assignment.reviewerId,description:'Changed by another window',
    criteria:assignment.criteria,dueDate:assignment.dueDate,
    priority:assignment.priority,atlasRef:workRef
  },{now:()=>'2026-11-08T13:01:00.000Z'});
  const staleRecoveryPage=await browser.newPage({viewport:{width:1200,height:900}});
  staleRecoveryPage.on('pageerror',e=>errors.push(e.message));
  await installRecoveryMock(staleRecoveryPage);
  await staleRecoveryPage.goto('http://127.0.0.1:4173');
  await staleRecoveryPage.getByTestId('nav-results').click();
  await staleRecoveryPage.getByTestId('corporate-assignment').selectOption(assignment.id);
  await staleRecoveryPage.getByTestId('cen02-recovery-preview').waitFor({state:'visible'});
  await staleRecoveryPage.evaluate(next=>window.__TEST_RECOVERY__.otherWindowSave(next),
    encodeDraft(changedDraft));
  await staleRecoveryPage.getByTestId('cen02-recovery-consent').check();
  await staleRecoveryPage.getByTestId('cen02-recover-link').click();
  await staleRecoveryPage.getByRole('alert').filter({hasText:/изменён в другом окне/})
    .waitFor({state:'visible'});
  const blocked=await staleRecoveryPage.evaluate(()=>window.__TEST_RECOVERY__.snapshot());
  assert.equal(blocked.saves,0,'stale assignment cannot create a local WorkRef');
  assert.equal(blocked.ownerActions,0,'no retry of T3 createTask');
  assert.equal(JSON.parse(blocked.content).organizations[0].issuedTaskLinks,undefined);
  await staleRecoveryPage.close();
  checks.push('synthetic-cen02-recovery-preserves-parallel-draft-and-refuses-edited-source');


  await page.getByTestId('nav-overview').click();await page.screenshot({path:'artifacts/overview-1366.png',fullPage:true});
  await page.setViewportSize({width:320,height:800});assert.ok(await page.locator('.menu-button').isVisible());await page.locator('.menu-button').click();await page.getByTestId('nav-work').click();
  const sizes=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));checks.push('navigation-and-no-overflow-320');
  await page.screenshot({path:'artifacts/work-320.png',fullPage:true});assert.deepEqual(errors,[]);checks.push('no-page-errors');
  writeFileSync('artifacts/ui-report.json',JSON.stringify({status:'PASS_BROWSER_DRAFT_SCOPE',browser:'Firefox',checks,errors,t3RuntimeIntegrated:false,syntheticT3ReadbackOnly:true,installedWindowsGui:false},null,2));
  console.log('CENTER_DRAFT_UI_PASS',checks.length);
}finally{await browser?.close();server.kill();}
