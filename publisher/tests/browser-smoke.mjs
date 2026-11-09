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
  // Production assets opened without a Tauri bridge are informational only.
  // There is no alternate browser Publisher or browser-local draft store.
  const noNative=await browser.newPage({viewport:{width:1366,height:900}});
  await noNative.goto('http://127.0.0.1:4175');
  await noNative.getByTestId('publisher-desktop-required').waitFor();
  assert.match(await noNative.locator('main').innerText(),/самостоятельная настольная программа/);
  assert.equal(await noNative.getByRole('button',{name:'Сохранить продукт'}).count(),0);
  assert.equal(await noNative.evaluate(()=>localStorage.getItem('iwxa.publisher.preparation/1')),null);
  await noNative.screenshot({path:'artifacts/publisher/desktop-required-no-tauri.png',fullPage:true});
  await noNative.close();
  checks.push('browser-without-tauri-cannot-run-desktop-publisher');
  // If the application bundle does not load, the native document still has
  // a visible reload path without JS, storage or a second browser product.
  const missingBundle=await browser.newPage({viewport:{width:900,height:680}});
  await missingBundle.route('**/*.js',route=>route.abort('failed'));
  await missingBundle.goto('http://127.0.0.1:4175',{waitUntil:'domcontentloaded'});
  await missingBundle.locator('#publisher-startup').waitFor({state:'visible'});
  assert.equal(await missingBundle.getByRole('link',{name:'Повторить загрузку'}).getAttribute('href'),'./');
  assert.equal(await missingBundle.getByRole('button',{name:'Сохранить продукт'}).count(),0);
  await missingBundle.close();
  checks.push('native-static-startup-retry-visible-when-js-bundle-missing');

  // Firefox is a rendering/test harness only. Fake Tauri IPC is provided
  // exclusively by this test script; the production Publisher has no fallback.
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__publisherMockNativeCommands=[];
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      window.__publisherMockNativeCommands.push(command);
      if(command==='publisher_draft_read')return sessionStorage.getItem('iwxa-publisher-test-native-draft');
      if(command==='publisher_draft_save'){
        if(window.__publisherMockFailNextSave){window.__publisherMockFailNextSave=false;throw Error('PUBLISHER_TEST_NATIVE_SAVE_UNAVAILABLE');}
        sessionStorage.setItem('iwxa-publisher-test-native-draft',args.content);return true;
      }
      if(command==='publisher_save_test_request'){sessionStorage.setItem('iwxa-publisher-test-native-request',args.content);return true;}
      if(command==='publisher_export_preparation_backup')return false;
      if(command==='publisher_pick_preparation_backup')return null;
      if(command==='publisher_inspect_artifact')return null;
      if(command==='publisher_t3_capabilities')return {
        operation:'TEST_CAPABILITIES',issuers:['publisher:owner:test'],
        activeSeats:0,productionActivation:false,commercialAuthorityProven:false};
      if(command==='publisher_t3_inventory')return {
        operation:'TEST_INVENTORY',
        licenses:JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]'),
        activeSeats:0,productionActivation:false};
      if(command==='publisher_t3_issue'){
        const req=JSON.parse(args.requestJson),ledger=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
        if(req.environment!=='TEST'||args.issuerAuthorityId!=='publisher:owner:test')
           throw Error('TEST_ISSUER_DENIED');
        const entry={licenseId:'license:test:native-ui:one',requestId:req.requestId,
          issuerAuthorityId:'publisher:owner:test',organizationId:req.subject.id,
          claimedSeats:req.seats,status:'NOT_ACTIVATED',sequence:0,activeSeats:0};
        if(!ledger.some(x=>x.requestId===req.requestId))ledger.push(entry);
        sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(ledger));
        return {operation:'TEST_ISSUE',outcome:'ISSUED_NEW',licenseId:entry.licenseId,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_change_status'){
        const ledger=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
        const entry=ledger.find(x=>x.licenseId===args.licenseId);
        if(!entry)throw Error('PRODUCT_OWNER_LICENSE_NOT_ISSUED');
        entry.status=args.nextStatus;entry.sequence+=1;
        sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(ledger));
        return {operation:'TEST_STATUS',licenseId:entry.licenseId,state:entry.status,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_export')return {
        operation:'TEST_IWXA_EXPORTED',licenseId:args.licenseId,
        activeSeats:0,productionActivation:false};
      if(command==='publisher_select_test_iwxa')return {
        size:348,sha256:'b'.repeat(64),integrityVerified:false,signatureVerified:false,
        statusVerified:false,productionActivation:false,activeSeats:0};
      if(command==='publisher_export_test_iwxa'){
        if(args.expectedSha256!=='b'.repeat(64))throw new Error('PUBLISHER_IWXA_SELECTION_CHANGED');
        return true;
      }
      if(command==='publisher_compare_offline_copies')return {
        name:'iwxa-publisher.exe',size:12500,sha256:'a'.repeat(64),
        copiesChecked:2,sameContent:true,distinctSelectedPaths:true,
        physicalIndependenceVerified:false,publisherAuthorized:false,
        signedReleaseMetadataVerified:false
      };
      throw new Error('UNEXPECTED_TEST_ONLY_IPC:'+command);
    }};
  });
  await page.goto('http://127.0.0.1:4175');
  assert.match(await page.locator('main').innerText(),/Подтверждённых релизов: 0/);
  assert.match(await page.locator('main').innerText(),/Подписанных лицензий: 0/);
  checks.push('empty-owner-first-run-no-synthetic-license');
  await page.getByRole('button',{name:'Доверие и ключи'}).click();
  const select=page.getByTestId('publisher-select-test-iwxa');
  const exportButton=page.getByTestId('publisher-export-test-iwxa');
  assert.equal(await exportButton.isEnabled(),false);
  await select.click();
  await page.getByTestId('publisher-iwxa-unverified').waitFor();
  assert.match(await page.getByTestId('publisher-iwxa-unverified').innerText(),/Подтверждённых мест: 0/);
  assert.match(await page.getByTestId('publisher-iwxa-unverified').innerText(),/Подлинность и статус не проверены/);
  await exportButton.click();
  assert.match(await page.locator('main').innerText(),/Файл .iwxa скопирован без изменения байтов/);
  checks.push('publisher-canonical-iwxa-native-transport-unverified-zero-seats');
  await page.getByRole('button',{name:'Обзор'}).click();

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
  assert.equal(await page.locator('nav[aria-label="Разделы Publisher"] .nav-link svg').count(),7);
  checks.push('agent-exact-ix-glyph-white-logo-and-seven-vector-navigation-icons');
  assert.equal(await page.getByRole('button',{name:'Сохранить копию черновиков'}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Восстановить черновики'}).isEnabled(),true);
  assert.match(await page.getByTestId('publisher-preparation-backup').innerText(),/ключей издателя в копии нет/);
  checks.push('backup-bound-to-test-only-native-ipc-without-issuer-keys');

  await page.getByRole('button',{name:'Продукты',exact:true}).click();
  await page.getByLabel('Идентификатор продукта').fill('IWXA_ADMIN_CENTER');
  await page.getByLabel('Название').fill('IWXA Admin Center');
  await page.getByLabel('Версия',{exact:true}).fill('0.3.0');
  await page.getByRole('button',{name:'Сохранить продукт'}).click();
  await page.getByText('Продукты (1)').waitFor();
  checks.push('create-product-draft');

  await page.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  await page.getByLabel('Код тарифа').fill('TEAM');
  await page.getByLabel('Название тарифа').fill('Команда');
  await page.getByLabel('Функции и модули').fill('FEATURE_A,FEATURE_B');
  await page.getByRole('button',{name:'Добавить квоту'}).click();
  await page.getByLabel('Ресурс').fill('CLOUD_TOKENS');
  await page.getByLabel('Где используется').selectOption('CLOUD');
  await page.getByLabel('Единица').selectOption('TOKENS');
  await page.getByLabel('Период').selectOption('MONTH');
  await page.getByLabel('Предел').fill('150000');
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await page.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  const tariffFeedback=page.getByTestId('publisher-tariff-save-feedback');
  await tariffFeedback.waitFor();
  assert.equal(await tariffFeedback.getAttribute('role'),'alert');
  assert.match(await tariffFeedback.innerText(),/Не удалось сохранить/);
  assert.equal(await page.getByText('Сохранённые тарифы (0)').count(),1);
  await page.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  await page.getByText('Сохранённые тарифы (1)').waitFor();
  await tariffFeedback.waitFor();
  assert.equal(await tariffFeedback.getAttribute('role'),'status');
  assert.match(await tariffFeedback.innerText(),/Редакция тарифа сохранена/);
  const tariffOnScreen=await tariffFeedback.evaluate(el=>{
    const r=el.getBoundingClientRect(),pane=document.querySelector('.publisher-app .main').getBoundingClientRect();
    return r.top>=pane.top&&r.bottom<=pane.bottom;
  });
  assert.ok(tariffOnScreen,'Tariff result must be visible beside its save action');
  checks.push('tariff-native-save-failure-and-success-visible-beside-action');
  const persistedTariff=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')));
  assert.equal(persistedTariff.tariffs[0].quotas[0].service,'CLOUD');
  assert.equal(persistedTariff.tariffs[0].quotas[0].max,150000);
  checks.push('versioned-offline-tariff-and-cloud-quota-draft');
  await page.getByRole('button',{name:'Клиенты'}).click();
  await page.getByLabel('Идентификатор клиента').fill('11111111-1111-4111-8111-111111111111');
  await page.getByLabel('Название / имя').fill('Test Corporation');
  await page.getByRole('button',{name:'Сохранить клиента'}).click();
  await page.getByText('Клиенты (1)').waitFor();
  checks.push('create-organization-holder');

  await page.getByRole('button',{name:'Лицензии'}).click();
  await page.getByTestId('publisher-tariff-proposal').waitFor();
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await page.getByRole('button',{name:'Сохранить подготовку по тарифу'}).click();
  const proposalFeedback=page.getByTestId('publisher-proposal-save-feedback');
  await proposalFeedback.waitFor();
  assert.equal(await proposalFeedback.getAttribute('role'),'alert');
  assert.equal(await page.getByText('Подготовленные запросы (0)').count(),1);
  await page.getByRole('button',{name:'Сохранить подготовку по тарифу'}).click();
  await proposalFeedback.waitFor();
  assert.equal(await proposalFeedback.getAttribute('role'),'status');
  assert.match(await proposalFeedback.innerText(),/Подготовка сохранена/);
  const proposalOnScreen=await proposalFeedback.evaluate(el=>{
    const r=el.getBoundingClientRect(),pane=document.querySelector('.publisher-app .main').getBoundingClientRect();
    return r.top>=pane.top&&r.bottom<=pane.bottom;
  });
  assert.ok(proposalOnScreen,'License preparation result must stay beside its action');
  checks.push('proposal-native-save-failure-and-success-visible-beside-action');
  await page.getByRole('button',{name:'Лицензии'}).click();
  await page.getByText('Подготовленные запросы (1)').waitFor();
  checks.push('tariff-proposal-unsigned-snapshot');
  await page.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  const offerReview=page.getByTestId('publisher-offline-offer-preview');
  assert.match(await offerReview.innerText(),/Места продукта: 5/);
  assert.match(await offerReview.innerText(),/Сотрудники: 10/);
  assert.match(await offerReview.innerText(),/CLOUD_TOKENS/);
  assert.match(await offerReview.innerText(),/Неподписанная подготовка/);
  await page.getByRole('button',{name:'Лицензии'}).click();
  checks.push('tariff-review-shows-quotas-and-no-effective-license');
  // The long license section must not carry its scroll offset to the next
  // section. This was observed in a real Windows Publisher screenshot.
  const formerScroll=await page.evaluate(()=>{
    const content=document.querySelector('.publisher-app .main');
    if(!content)throw Error('Publisher work area unavailable');
    content.scrollTop=500;
    return content.scrollTop;
  });
  assert.ok(formerScroll>=100,'License content must scroll for this witness');
  await page.getByRole('button',{name:'Клиенты',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.querySelector('.publisher-app .main').scrollTop),0,
    'Client section must begin at its title');
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.querySelector('.publisher-app .main').scrollTop),0,
    'License section must begin at its title on return');
  checks.push('native-desktop-section-navigation-resets-main-scroll');
  await page.getByRole('button',{name:'Открыть TEST-запрос'}).click();
  const legacyVisible=await page.getByLabel('Функции (коды через запятую)').evaluate(el=>{
    const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=window.innerHeight;
  });
  assert.ok(legacyVisible,'Legacy TEST editor must be visible after explicit shortcut');
  checks.push('legacy-test-form-explicit-native-scroll-navigation');
  await page.getByLabel('Функции (коды через запятую)').fill('FEATURE_A,FEATURE_B');
  await page.getByRole('button',{name:'Сохранить запрос'}).click();
  await page.getByText('Подготовленные запросы (2)').waitFor();
  assert.match(await page.locator('main').innerText(),/Не выдано/);
  checks.push('proposal-not-issued');
  await page.getByLabel('Места для TEST-запроса').fill('3');
  await page.getByRole('button',{name:'Моделировать TEST-ответ'}).last().click();
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
  await page.getByRole('button',{name:'Подготовить TEST-запрос'}).last().click();
  await page.getByText('Неподписанный TEST-запрос экспортирован. Лицензия не выдана.').waitFor();
  const testRequest=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-request')));
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
  await page.getByRole('button',{name:'Доверие и ключи'}).click();
  const proposalChoice=page.getByTestId('publisher-t3-owner-panel')
    .getByRole('combobox',{name:'Подготовленный запрос'});
  assert.match(await proposalChoice.locator('option').first().innerText(),
    /IWXA Admin Center · Test Corporation/);
  const banner=await page.locator('main > .notice').first().innerText();
  assert.match(banner,/Подписанные лицензии доступны только в режиме TEST/);
  assert.doesNotMatch(banner,/подпись издателя не подключена/);
  await page.getByTestId('publisher-t3-issue').click();
  await page.getByText('TEST-лицензия подписана T3 и сохранена в журнале издателя.').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
  await page.getByTestId('publisher-t3-change-status').click();
  await page.getByText('Новый подписанный TEST-статус сохранён в T3: ACTIVE').waitFor();
  await page.getByTestId('publisher-t3-export').click();
  await page.getByText('Пакет .iwxa выпущен T3 и подтверждён повторным чтением.').waitFor();
  assert.match(await page.getByTestId('publisher-t3-owner-panel').innerText(),/Активных мест: 0/);
  checks.push('publisher-owner-operations-through-native-IPC-model-only-no-commercial-seats');
  await page.getByRole('button',{name:'Лицензии'}).click();

  await page.reload();
  await page.getByRole('button',{name:'Лицензии'}).click();
  assert.equal(await page.getByTestId('publisher-test-simulation-result').count(),0,'simulation was incorrectly persisted');
  await page.getByText('Подготовленные запросы (2)').waitFor();
  assert.match(await page.locator('main').innerText(),/Test Corporation/);
  checks.push('same-origin-restart-persistence');

  await page.getByRole('button',{name:'Доверие и ключи'}).click();
  assert.match(await page.locator('main').innerText(),/TEST-подпись доступна только через ранее зарегистрированного владельца/);
  await page.getByRole('button',{name:'Релизы'}).click();
  assert.equal(await page.getByRole('button',{name:'Выбрать и проверить файл'}).isEnabled(),true);
  await page.getByRole('button',{name:'Сверить две копии файла'}).click();
  const copies=page.getByTestId('publisher-offline-copies-result');
  await copies.waitFor();
  assert.match(await copies.innerText(),/Сверены 2 файла — байты совпадают/);
  assert.match(await copies.innerText(),/Независимость физических носителей не подтверждена/);
  assert.match(await copies.innerText(),/Подписи и разрешения на выпуск нет/);
  assert.match(await copies.innerText(),/a{64}/);
  checks.push('offline-two-selected-paths-byte-match-without-physical-independence-or-release-claim');
  assert.equal(await page.evaluate(()=>window.__publisherMockNativeCommands.includes('publisher_save_test_request')),false);
  // __publisherMockNativeCommands is reset on reload: native IPC doesn't
  // provide a browser-only issuer implementation or a signed license.
  checks.push('preview-harness-cannot-issue-or-sign-product-license');

  await page.setViewportSize({width:700,height:650});
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Обзор'}).click();
  const dimensions=await page.evaluate(()=>({viewport:window.innerWidth,body:document.body.scrollWidth,doc:document.documentElement.scrollWidth}));
  assert.ok(dimensions.body<=dimensions.viewport && dimensions.doc<=dimensions.viewport,JSON.stringify(dimensions));
  checks.push('compact-desktop-navigation-no-horizontal-overflow');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Лицензии'}).click();
  const requestWidth=await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth));
  assert.ok(requestWidth<=700,'TEST request interface overflows desktop minimum 700px: '+requestWidth);
  checks.push('compact-desktop-test-license-request-no-horizontal-overflow');
  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.getByRole('button',{name:'Обзор'}).click();

  await page.getByRole('button',{name:'Открыть навигацию'}).click();
  await page.screenshot({path:'artifacts/publisher/navigation-desktop-700.png',fullPage:true});
  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  await page.screenshot({path:'artifacts/publisher/overview-desktop-700.png',fullPage:true});
  await page.setViewportSize({width:1366,height:900});
  await page.screenshot({path:'artifacts/publisher/overview-1366.png',fullPage:true});
  for(const [label,slug] of [
    ['Продукты','products'],['Тарифы и лимиты','tariffs'],['Клиенты','holders'],
    ['Лицензии','proposals'],['Релизы','releases'],['Доверие и ключи','trust']
  ]){
    await page.getByRole('button',{name:label,exact:true}).click();
    const bounds=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(bounds.scroll<=bounds.width,slug+' overflows desktop viewport');
    await page.screenshot({path:'artifacts/publisher/'+slug+'-1366.png',fullPage:true});
  }
  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  checks.push('agent-shell-consistent-on-all-seven-publisher-pages');
  // Same tariff code, new edition, preserved older offer, linked unsigned followup.
  await page.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  await page.getByRole('button',{name:'Новая редакция'}).first().click();
  assert.equal(await page.getByRole('spinbutton',{name:'Редакция',exact:true}).inputValue(),'2');
  assert.equal(await page.getByLabel('Название тарифа').inputValue(),'Команда');
  await page.getByLabel('Места продукта').fill('7');
  await page.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  await page.getByText('Сохранённые тарифы (2)').waitFor();
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
  const firstSaved=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')));
  const firstOffer=firstSaved.proposals.find(p=>p.tariffSnapshot);
  assert.equal(firstOffer.tariffSnapshot.productSeats,5);
  const newer=firstSaved.tariffs.find(t=>t.revision===2);
  await page.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Тариф'})
    .selectOption([newer.productId,newer.holderType,newer.id,newer.revision].join(':'));
  await page.getByRole('combobox',{name:'Основание подготовки'}).selectOption(firstOffer.id);
  assert.match(await page.getByTestId('publisher-offline-offer-preview').innerText(),/Места продукта: 7/);
  await page.getByRole('button',{name:'Создать следующую подготовку'}).click();
  const linked=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')));
  assert.equal(linked.proposals.length,3);
  assert.equal(linked.proposals[2].previousProposalId,firstOffer.id);
  assert.equal(linked.proposals[2].tariffSnapshot.productSeats,7);
  assert.equal(linked.proposals[2].status,'DRAFT_NOT_ISSUED');
  checks.push('native-ui-tariff-edition-and-followup-preserve-previous-terms');
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
  // Independent direct-to-product personal flow, using a bounded IPC test double.
  // It cannot claim that a PERSON license was signed by T3.
  const personal=await browser.newPage({viewport:{width:1050,height:820}});
  personal.on('pageerror',e=>errors.push('personal fixture: '+e.message));
  await personal.addInitScript(()=>{
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='publisher_draft_read')return sessionStorage.getItem('iwxa-publisher-person-fixture');
      if(command==='publisher_draft_save'){sessionStorage.setItem('iwxa-publisher-person-fixture',args.content);return true;}
      if(command==='publisher_t3_capabilities')return {operation:'TEST_CAPABILITIES',issuers:['test:owner'],activeSeats:0,productionActivation:false,commercialAuthorityProven:false};
      if(command==='publisher_t3_inventory')return {operation:'TEST_INVENTORY',licenses:[],activeSeats:0,productionActivation:false};
      throw new Error('Unexpected personal fixture IPC '+command);
    }};
  });
  await personal.goto('http://127.0.0.1:4175');
  await personal.getByRole('button',{name:'Продукты',exact:true}).click();
  await personal.getByLabel('Идентификатор продукта').fill('IWXA_ATLAS');
  await personal.getByLabel('Название').fill('IWXA Atlas');
  await personal.getByLabel('Версия',{exact:true}).fill('0.4.0');
  await personal.getByRole('button',{name:'Сохранить продукт'}).click();
  await personal.getByRole('button',{name:'Клиенты',exact:true}).click();
  await personal.getByLabel('Тип субъекта').selectOption('PERSON');
  await personal.getByLabel('Идентификатор клиента').fill('person:local-example');
  await personal.getByLabel('Название / имя').fill('Example Person');
  await personal.getByRole('button',{name:'Сохранить клиента'}).click();
  await personal.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  await personal.getByLabel('Код тарифа').fill('ATLAS_PERSONAL');
  await personal.getByLabel('Название тарифа').fill('Личный');
  await personal.getByRole('combobox',{name:'Тип клиента для тарифа'}).selectOption('PERSON');
  await personal.getByLabel('Устройства владельца').fill('3');
  await personal.getByLabel('Функции и модули').fill('LOCAL_PROJECTS');
  assert.equal(await personal.getByLabel('Сотрудники организации').count(),0);
  await personal.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  const personPreview=await personal.getByTestId('publisher-offline-offer-preview').innerText();
  assert.match(personPreview,/Устройства: 3/);
  assert.doesNotMatch(personPreview,/Сотрудники:/);
  assert.match(personPreview,/Неподписанная подготовка/);
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByTestId('publisher-tariff-proposal').waitFor();
  await personal.getByRole('button',{name:'Сохранить подготовку по тарифу'}).click();
  const directDraft=JSON.parse(await personal.evaluate(()=>sessionStorage.getItem('iwxa-publisher-person-fixture')));
  assert.equal(directDraft.proposals[0].tariffSnapshot.holderType,'PERSON');
  assert.equal(directDraft.proposals[0].tariffSnapshot.deviceLimit,3);
  assert.equal(directDraft.proposals[0].status,'DRAFT_NOT_ISSUED');
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  assert.equal(await personal.getByRole('button',{name:'Подготовить TEST-запрос'}).isDisabled(),true);
  await personal.reload();
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByText('Подготовленные запросы (1)').waitFor();
  assert.match(await personal.locator('main').innerText(),/Напрямую в продукт/);
  await personal.getByRole('button',{name:'Доверие и ключи'}).click();
  await personal.getByTestId('publisher-person-issuer-unavailable').waitFor();
  assert.equal(await personal.getByTestId('publisher-t3-issue').isDisabled(),true);
  assert.equal(await personal.getByRole('combobox',{name:'Подготовленный запрос'}).locator('option').count(),0);
  checks.push('personal-test-issuer-unavailable-even-with-active-original-owner');
  await personal.close();
  checks.push('personal-offline-draft-persists-restart-without-admin-center-or-false-signing');
  assert.deepEqual(errors,[]);
  checks.push('no-browser-page-errors');
  const report={status:'PASS',checks,errors,environment:'Firefox rendering with explicit test-only mock Tauri IPC; NOT an installed application',issuer:'NOT_CONNECTED',signature:'NOT_TESTED'};
  writeFileSync('artifacts/publisher/browser-result.json',JSON.stringify(report,null,2));
  console.log('PUBLISHER_BROWSER_PREPARATION_PASS '+checks.join(', '));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
