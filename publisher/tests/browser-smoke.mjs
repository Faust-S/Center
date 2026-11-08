import {firefox} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft} from '../src/preparation.mjs';

mkdirSync('artifacts/publisher',{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--config','publisher/vite.config.ts','--host','127.0.0.1','--port','4175','--strictPort'],{stdio:'pipe'});
let browser;
const checks=[],errors=[];
try {
  let ready=false;
  for(let i=0;i<100;i++){
    try { const r=await fetch('http://127.0.0.1:4175'); if(r.ok){ready=true;break;} }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(ready,'Publisher preview server started');
  browser=await firefox.launch();
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4175');
  assert.match(await page.locator('main').innerText(),/Подтверждённых релизов: 0/);
  assert.match(await page.locator('main').innerText(),/Подписанных лицензий: 0/);
  checks.push('empty-owner-first-run-no-synthetic-license');
  const mark=page.locator('.publisher-brand-logo');
  assert.equal(await mark.getAttribute('src'),'/favicon.svg');
  assert.equal(await mark.getAttribute('alt'),'IWXA');
  const brandSvg=await (await page.request.get('http://127.0.0.1:4175/favicon.svg')).text();
  assert.match(brandSvg,/fill="#FFFFFF"/);
  assert.match(brandSvg,/fill="#05070D"/);
  assert.match(brandSvg,/M29 14 L51 50 M51 14 L29 50/);
  assert.ok(!brandSvg.includes('#B6F24B'),'Publisher still uses Agent green background');
  const logoStyle=await mark.evaluate(el=>({w:el.getBoundingClientRect().width,loaded:el.complete&&el.naturalWidth>0}));
  assert.ok(logoStyle.loaded&&logoStyle.w>=36,'Publisher mark not rendered in agent shell');
  assert.equal(await page.locator('nav[aria-label="Разделы Publisher"] .nav-link svg').count(),6);
  checks.push('agent-exact-ix-glyph-white-logo-and-six-vector-navigation-icons');
  assert.equal(await page.getByRole('button',{name:'Сохранить копию черновиков'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Восстановить черновики'}).isDisabled(),true);
  assert.match(await page.getByTestId('publisher-preparation-backup').innerText(),/ключей издателя в этой копии нет/);
  checks.push('backup-is-native-only-and-never-exports-issuer-keys');

  await page.getByRole('button',{name:'Продукты',exact:true}).click();
  await page.getByLabel('Идентификатор продукта').fill('IWXA_ADMIN_CENTER');
  await page.getByLabel('Название').fill('IWXA Admin Center');
  await page.getByLabel('Версия',{exact:true}).fill('0.3.0');
  await page.getByRole('button',{name:'Сохранить продукт'}).click();
  await page.getByText('Продукты (1)').waitFor();
  checks.push('create-product-draft');

  await page.getByRole('button',{name:'Получатели'}).click();
  await page.getByLabel('Идентификатор субъекта').fill('11111111-1111-4111-8111-111111111111');
  await page.getByLabel('Название / имя').fill('Test Corporation');
  await page.getByRole('button',{name:'Сохранить получателя'}).click();
  await page.getByText('Получатели (1)').waitFor();
  checks.push('create-organization-holder');

  await page.getByRole('button',{name:'Запросы на лицензии'}).click();
  await page.getByLabel('Функции (коды через запятую)').fill('FEATURE_A,FEATURE_B');
  await page.getByRole('button',{name:'Сохранить запрос'}).click();
  await page.getByText('Подготовленные запросы (1)').waitFor();
  assert.match(await page.locator('main').innerText(),/Не выдано/);
  checks.push('proposal-not-issued');
  await page.getByLabel('Места для TEST-запроса').fill('3');
  await page.getByRole('button',{name:'Моделировать TEST-ответ'}).click();
  const simulatedText=await page.getByTestId('publisher-test-simulation-result').innerText();
  assert.match(simulatedText,/СИМУЛЯЦИЯ · НЕ ЛИЦЕНЗИЯ/);
  assert.match(simulatedText,/Смоделировано мест: 3/);
  assert.match(simulatedText,/Действительных лицензированных мест: 0/);
  assert.match(await page.getByTestId('publisher-test-simulation-result').getAttribute('aria-label'),/Действительных лицензированных мест: 0/);
  assert.match(simulatedText,/Активация и распределение мест недоступны/);
  // An installed WebView is shorter than the content; the simulation must be
  // brought into view so the seat count can actually be read by a user/UIA.
  const simInViewport=await page.getByTestId('publisher-test-simulation-result').evaluate(el=>{
    const rect=el.getBoundingClientRect();
    return rect.top>=0 && rect.top<window.innerHeight && rect.bottom<=window.innerHeight;
  });
  assert.ok(simInViewport,'Simulation result remains below the visible viewport');
  checks.push('simulation-shows-no-signed-license-or-active-seats');
  checks.push('simulation-result-auto-scrolls-into-view');
  const waiting=page.waitForEvent('download');
  await page.getByRole('button',{name:'Подготовить TEST-запрос'}).click();
  const downloaded=await waiting;
  const testRequest=JSON.parse(readFileSync(await downloaded.path(),'utf8'));
  assert.equal(testRequest.schema,'IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1');
  assert.equal(testRequest.kind,'TEST_LICENSE_REQUEST');
  assert.equal(testRequest.status,'UNSIGNED_REQUEST');
  assert.equal(testRequest.environment,'TEST');
  assert.equal(testRequest.seats,3);
  assert.equal(testRequest.product.id,'IWXA_ADMIN_CENTER');
  assert.equal(testRequest.subject.type,'ORGANIZATION');
  assert.equal(testRequest.subject.id,'11111111-1111-4111-8111-111111111111');
  assert.deepEqual(testRequest.featureIds,['FEATURE_A','FEATURE_B']);
  assert.ok(!('licenseId' in testRequest) && !('signature' in testRequest));
  assert.match(await page.locator('main').innerText(),/Лицензия не выдана/);
  checks.push('export-exact-unsigned-product-holder-test-request');

  await page.reload();
  await page.getByRole('button',{name:'Запросы на лицензии'}).click();
  assert.equal(await page.getByTestId('publisher-test-simulation-result').count(),0,'simulation was incorrectly persisted');
  await page.getByText('Подготовленные запросы (1)').waitFor();
  assert.match(await page.locator('main').innerText(),/Test Corporation/);
  checks.push('same-origin-restart-persistence');

  await page.getByRole('button',{name:'Доверие и ключи'}).click();
  assert.match(await page.locator('main').innerText(),/Операции подписи не подключены/);
  await page.getByRole('button',{name:'Релизы'}).click();
  assert.equal(await page.getByRole('button',{name:'Выбрать и проверить файл'}).isDisabled(),true);
  checks.push('browser-mode-does-not-offer-issuer-or-native-artifact-operation');

  await page.setViewportSize({width:320,height:800});
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Обзор'}).click();
  const dimensions=await page.evaluate(()=>({viewport:window.innerWidth,body:document.body.scrollWidth,doc:document.documentElement.scrollWidth}));
  assert.ok(dimensions.body<=dimensions.viewport && dimensions.doc<=dimensions.viewport,JSON.stringify(dimensions));
  checks.push('mobile-navigation-no-horizontal-overflow');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Запросы на лицензии'}).click();
  const requestWidth=await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth));
  assert.ok(requestWidth<=320,'TEST request interface overflows 320px: '+requestWidth);
  checks.push('mobile-test-license-request-no-horizontal-overflow');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Обзор'}).click();

  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.screenshot({path:'artifacts/publisher/navigation-320.png',fullPage:true});
  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  await page.screenshot({path:'artifacts/publisher/overview-320.png',fullPage:true});
  await page.setViewportSize({width:1366,height:900});
  await page.screenshot({path:'artifacts/publisher/overview-1366.png',fullPage:true});
  for(const [label,slug] of [
    ['Продукты','products'],['Получатели','holders'],
    ['Запросы на лицензии','proposals'],['Релизы','releases'],['Доверие и ключи','trust']
  ]){
    await page.getByRole('button',{name:label,exact:true}).click();
    const bounds=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(bounds.scroll<=bounds.width,slug+' overflows desktop viewport');
    await page.screenshot({path:'artifacts/publisher/'+slug+'-1366.png',fullPage:true});
  }
  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  checks.push('agent-shell-consistent-on-all-six-publisher-pages');
  // A bounded native-command double tests the confirmation UI without
  // pretending this is installed Windows, a T3 issuer or a real signed license.
  let backupDraft=emptyPublisherDraft();
  backupDraft=applyPublisherDraftCommand(backupDraft,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Restorable Product',version:'0.3.0'});
  backupDraft=applyPublisherDraftCommand(backupDraft,{kind:'addHolder',id:'11111111-1111-4111-8111-111111111111',name:'Restorable Organization',type:'ORGANIZATION'});
  backupDraft=applyPublisherDraftCommand(backupDraft,{kind:'addProposal',productId:'IWXA_ADMIN_CENTER',holderId:'11111111-1111-4111-8111-111111111111',features:['WORKSPACE'],termDays:30});
  const restoreData=encodePublisherDraft(backupDraft);
  const nativeMockPage=await browser.newPage({viewport:{width:1366,height:900}});
  nativeMockPage.on('pageerror',e=>errors.push('native fixture: '+e.message));
  await nativeMockPage.addInitScript(({restoreData})=>{
    window.__publisherMockSaved=[];
    window.confirm=()=>{throw new Error('Blocking browser confirm is not allowed for Publisher restore');};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='publisher_draft_read')return null;
      if(command==='publisher_pick_preparation_backup')return restoreData;
      if(command==='publisher_draft_save'){window.__publisherMockSaved.push(args.content);return true;}
      if(command==='publisher_export_preparation_backup')return true;
      throw new Error('Unexpected native command '+command);
    }};
  },{restoreData});
  await nativeMockPage.goto('http://127.0.0.1:4175');
  await nativeMockPage.getByRole('button',{name:'Восстановить черновики'}).click();
  const confirmation=nativeMockPage.getByTestId('publisher-restore-confirmation');
  await confirmation.waitFor();
  assert.match(await confirmation.innerText(),/неподписанных запросов — 1/);
  assert.equal(await nativeMockPage.evaluate(()=>window.__publisherMockSaved.length),0,'Import before confirmation wrote live data');
  await nativeMockPage.getByRole('button',{name:'Отмена восстановления'}).click();
  assert.equal(await confirmation.count(),0);
  assert.equal(await nativeMockPage.evaluate(()=>window.__publisherMockSaved.length),0,'Cancel overwrote native data');
  checks.push('restore-cancel-does-not-write');
  await nativeMockPage.getByRole('button',{name:'Восстановить черновики'}).click();
  await confirmation.waitFor();
  await nativeMockPage.getByRole('button',{name:'Заменить текущие черновики'}).click();
  await nativeMockPage.getByText('Черновики восстановлены из копии и сохранены. Подписи и права не изменены.').waitFor();
  const saved=await nativeMockPage.evaluate(()=>window.__publisherMockSaved);
  assert.equal(saved.length,1,'Confirm must write once');
  assert.deepEqual(JSON.parse(saved[0]),backupDraft);
  assert.equal(await confirmation.count(),0);
  checks.push('restore-confirm-atomically-writes-only-strict-draft');
  await nativeMockPage.close();
  assert.deepEqual(errors,[]);
  checks.push('no-browser-page-errors');
  const report={status:'PASS',checks,errors,environment:'Firefox Playwright; local preview without native issuer',issuer:'NOT_CONNECTED',signature:'NOT_TESTED'};
  writeFileSync('artifacts/publisher/browser-result.json',JSON.stringify(report,null,2));
  console.log('PUBLISHER_BROWSER_PREPARATION_PASS '+checks.join(', '));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
