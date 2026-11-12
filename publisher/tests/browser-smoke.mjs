import {firefox} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft} from '../src/preparation.mjs';
import {prepareAdminPublisherTestRequest} from '../../runtime/cen04-issuer-request.mjs';

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
      if(command==='publisher_pick_unsigned_admin_request')
        return window.__publisherMockAdminUnsignedRequest??null;
      if(command==='publisher_export_preparation_backup')return false;
      if(command==='publisher_pick_preparation_backup')return null;
      if(command==='publisher_inspect_artifact')return window.__publisherMockInspectedArtifact??null;
      if(command==='publisher_diagnostics')return {
        schema:'IWXA_DIAGNOSTICS/1',productId:'iwxa.publisher',version:'0.4.0-dev.2',
        application:'NATIVE_RUNNING',localPreparation:'READABLE',
        webviewProfile:'FOLDER_PRESENT',setupCore:'CHECK_IN_SETUP_CORE',
        licensing:'TEST_ONLY',activeSeats:0,productionActivation:false,
        attentionRequired:false};
      if(command==='publisher_t3_capabilities')return {
        operation:'TEST_CAPABILITIES',issuers:['publisher:owner:test'],
        activeSeats:0,productionActivation:false,commercialAuthorityProven:false};
      if(command==='publisher_t3_inventory'){
        if(window.__publisherMockTruncatedInventoryOnce){
          window.__publisherMockTruncatedInventoryOnce=false;
          return {operation:'TEST_INVENTORY',licenses:[],total:49,truncated:true,
            activeSeats:0,productionActivation:false};
        }
        if(window.__publisherMockFailNextInventory){
          window.__publisherMockFailNextInventory=false;
          throw Error('PUBLISHER_T3_TEMPORARY_INVENTORY_UNAVAILABLE');
        }
        return {
          operation:'TEST_INVENTORY',
          licenses:JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]'),
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_issue'){
        const req=JSON.parse(args.requestJson),ledger=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
        if(req.environment!=='TEST'||args.issuerAuthorityId!=='publisher:owner:test')
           throw Error('TEST_ISSUER_DENIED');
        const entry={licenseId:ledger.length===0?'license:test:native-ui:one':'license:test:native-ui:two',requestId:req.requestId,
          issuerAuthorityId:'publisher:owner:test',organizationId:req.subject.id,
          productId:req.product.id,claimedSeats:req.seats,
          status:'NOT_ACTIVATED',sequence:0,activeSeats:0};
        const alreadyIssued=window.__publisherMockNextAlreadyIssued===true;
        window.__publisherMockNextAlreadyIssued=false;
        if(!alreadyIssued&&!ledger.some(x=>x.requestId===req.requestId))ledger.push(entry);
        sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(ledger));
        return {operation:'TEST_ISSUE',outcome:alreadyIssued?'ALREADY_ISSUED':'ISSUED_NEW',licenseId:entry.licenseId,
          requestId:req.requestId,activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_change_status'){
        const ledger=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
        const entry=ledger.find(x=>x.licenseId===args.licenseId);
        if(!entry)throw Error('PRODUCT_OWNER_LICENSE_NOT_ISSUED');
        entry.status=args.nextStatus;entry.sequence+=1;
        sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(ledger));
        if(window.__publisherMockLoseNextTestStatusResponse){
          window.__publisherMockLoseNextTestStatusResponse=false;
          throw Error('TEST_NATIVE_IPC_RESPONSE_LOST_AFTER_COMMIT');
        }
        return {operation:'TEST_STATUS',licenseId:entry.licenseId,state:entry.status,
          sequence:entry.sequence,activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_export')return {
        operation:'TEST_IWXA_EXPORTED',licenseId:args.licenseId,
        bytes:1024,packageSha256:'a'.repeat(64),
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
  assert.match(await page.locator('main').innerText(),/Подписанные лицензии PERSON учитывает отдельный журнал T3/);
  checks.push('empty-owner-first-run-no-synthetic-license');
  await page.setViewportSize({width:1024,height:640});
  const footerVisible=await page.locator('.publisher-app .sidebar-bottom p').last().evaluate(el=>{
    const r=el.getBoundingClientRect(),area=el.closest('.sidebar').getBoundingClientRect();
    return r.top>=area.top&&r.bottom<=area.bottom;
  });
  assert.ok(footerVisible,'Publisher bottom navigation description must fit a compact desktop window');
  assert.match(await page.locator('.publisher-app .sidebar-bottom p').last().innerText(),/Черновики — не лицензии/);
  checks.push('compact-desktop-sidebar-caption-fully-visible');
  // The native 680px window can be constrained further by Windows taskbars
  // and display scaling. Its whole navigation and footer must fit together.
  await page.setViewportSize({width:1024,height:520});
  const compactSidebar=await page.locator('.publisher-app .sidebar').evaluate(el=>{
    const viewport=el.getBoundingClientRect();
    const nav=el.querySelectorAll('.nav-link');
    const bottom=el.querySelector('.sidebar-bottom p:last-child');
    if(!bottom||nav.length!==7)return false;
    const last=nav[nav.length-1].getBoundingClientRect();
    const foot=bottom.getBoundingClientRect();
    return last.top>=viewport.top&&last.bottom<=viewport.bottom&&
      foot.top>=viewport.top&&foot.bottom<=viewport.bottom-18&&el.scrollTop===0;
  });
  assert.ok(compactSidebar,'At 520px height both the final navigation section and footer must be visible without sidebar scrolling');
  checks.push('compact-height-native-sidebar-all-sections-and-footer-visible');
  checks.push('compact-height-native-footer-clears-windows-taskbar-safe-inset');
  await page.setViewportSize({width:1366,height:900});
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
  await page.getByRole('button',{name:'Проверить программу'}).click();
  const diagnostics=page.getByTestId('publisher-diagnostics-result');
  await diagnostics.waitFor();
  assert.match(await diagnostics.innerText(),/IWXA Publisher 0.4.0-dev.2/);
  assert.match(await diagnostics.innerText(),/Черновики: читаются/);
  assert.match(await diagnostics.innerText(),/проверки, восстановления или удаления/);
  const diag=JSON.parse(await page.getByRole('textbox',{name:'Сведения диагностики'}).inputValue());
  assert.equal(diag.schema,'IWXA_DIAGNOSTICS/1');
  assert.equal(diag.setupCore,'CHECK_IN_SETUP_CORE');
  assert.equal(diag.productionActivation,false);
  assert.equal(diag.activeSeats,0);
  assert.ok(!JSON.stringify(diag).includes('Test Corporation'));
  checks.push('native-read-only-common-iwxa-diagnostics-no-license-or-private-draft-data');
  // Diagnostics must remain usable when a damaged local draft prevents
  // the Publisher workbench from loading. Otherwise the diagnostic action
  // disappears precisely when support is most needed.
  const damaged=await browser.newPage({viewport:{width:1000,height:680}});
  damaged.on('pageerror',e=>errors.push(e.message));
  await damaged.addInitScript(()=>{
    window.__TAURI_INTERNALS__={invoke:async(command)=>{
      if(command==='publisher_draft_read')throw Error('PUBLISHER_DRAFT_FORMAT_INVALID');
      if(command==='publisher_diagnostics')return {
        schema:'IWXA_DIAGNOSTICS/1',productId:'iwxa.publisher',version:'0.4.0-dev.2',
        application:'NATIVE_RUNNING',localPreparation:'NEEDS_ATTENTION',
        webviewProfile:'FOLDER_PRESENT',setupCore:'CHECK_IN_SETUP_CORE',
        licensing:'TEST_ONLY',activeSeats:0,productionActivation:false,
        attentionRequired:true};
      throw Error('UNEXPECTED_DIAGNOSTIC_ONLY_COMMAND:'+command);
    }};
  });
  await damaged.goto('http://127.0.0.1:4175');
  await damaged.getByText(/Не удалось открыть сохранённые черновики/).waitFor();
  const diagnoseWhenFailed=damaged.getByRole('button',{name:'Проверить программу'});
  assert.equal(await diagnoseWhenFailed.isEnabled(),true);
  await diagnoseWhenFailed.click();
  const degradedReport=damaged.getByTestId('publisher-diagnostics-result');
  await degradedReport.waitFor();
  assert.match(await degradedReport.innerText(),/Черновики: требуют внимания/);
  assert.equal(JSON.parse(await damaged.getByRole('textbox',{name:'Сведения диагностики'}).inputValue()).attentionRequired,true);
  await damaged.close();
  checks.push('common-diagnostics-available-after-corrupt-draft-load-failure');

  await page.getByRole('button',{name:'Продукты',exact:true}).click();
  assert.equal(await page.getByLabel('Версия',{exact:true}).inputValue(),'',
    'New product version must be entered rather than inferred from Admin Center');
  await page.getByLabel('Идентификатор продукта').fill('IWXA_ADMIN_CENTER');
  await page.getByLabel('Название').fill('IWXA Admin Center');
  await page.getByLabel('Версия',{exact:true}).fill('0.3.0');
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await page.getByRole('button',{name:'Сохранить продукт'}).click();
  const productFeedback=page.getByTestId('publisher-product-save-feedback');
  await productFeedback.waitFor();
  assert.equal(await productFeedback.getAttribute('role'),'alert');
  assert.match(await productFeedback.innerText(),/Не удалось сохранить/);
  assert.equal(await page.getByLabel('Идентификатор продукта').inputValue(),'IWXA_ADMIN_CENTER');
  assert.equal(await page.getByLabel('Название').inputValue(),'IWXA Admin Center');
  assert.equal(await page.getByText('Продукты (0)').count(),1);
  await page.getByRole('button',{name:'Сохранить продукт'}).click();
  await page.getByText('Продукты (1)').waitFor();
  await productFeedback.waitFor();
  assert.equal(await productFeedback.getAttribute('role'),'status');
  assert.match(await productFeedback.innerText(),/Продукт добавлен/);
  assert.equal(await page.getByLabel('Идентификатор продукта').inputValue(),'');
  assert.equal(await page.getByLabel('Версия',{exact:true}).inputValue(),'');
  checks.push('product-native-save-failure-retains-form-and-success-is-inline');
  checks.push('create-product-draft');

  await page.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  const createTariff=page.getByRole('button',{name:'Сохранить редакцию тарифа'});
  assert.equal(await createTariff.isDisabled(),true,'Tariff editor must not select the first product implicitly');
  await page.getByRole('combobox',{name:'Продукт',exact:true}).selectOption('IWXA_ADMIN_CENTER');
  assert.equal(await createTariff.isEnabled(),true);
  checks.push('tariff-editor-requires-explicit-product');
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
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await page.getByRole('button',{name:'Сохранить клиента'}).click();
  const clientFeedback=page.getByTestId('publisher-client-save-feedback');
  await clientFeedback.waitFor();
  assert.equal(await clientFeedback.getAttribute('role'),'alert');
  assert.equal(await page.getByLabel('Идентификатор клиента').inputValue(),'11111111-1111-4111-8111-111111111111');
  assert.equal(await page.getByLabel('Название / имя').inputValue(),'Test Corporation');
  assert.equal(await page.getByText('Клиенты (0)').count(),1);
  await page.getByRole('button',{name:'Сохранить клиента'}).click();
  await page.getByText('Клиенты (1)').waitFor();
  await clientFeedback.waitFor();
  assert.equal(await clientFeedback.getAttribute('role'),'status');
  assert.match(await clientFeedback.innerText(),/Клиент добавлен/);
  assert.equal(await page.getByLabel('Идентификатор клиента').inputValue(),'');
  checks.push('client-native-save-failure-retains-form-and-success-is-inline');
  checks.push('create-organization-holder');

  await page.getByRole('button',{name:'Лицензии'}).click();
  const licenseChoice=page.getByTestId('publisher-tariff-proposal');
  await licenseChoice.waitFor();
  const prepareLicense=page.getByRole('button',{name:'Сохранить подготовку по тарифу'});
  assert.equal(await prepareLicense.isDisabled(),true,'An implicit first tariff/recipient must never be submitted');
  await licenseChoice.getByRole('combobox',{name:'Тариф'}).selectOption('IWXA_ADMIN_CENTER:ORGANIZATION:TEAM:1');
  assert.equal(await prepareLicense.isDisabled(),true,'Selecting a tariff must not implicitly select its first recipient');
  await licenseChoice.getByRole('combobox',{name:'Клиент'}).selectOption('11111111-1111-4111-8111-111111111111');
  assert.equal(await prepareLicense.isEnabled(),true);
  checks.push('license-preparation-requires-explicit-tariff-and-recipient');
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
  await page.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Тариф'})
    .selectOption('IWXA_ADMIN_CENTER:ORGANIZATION:TEAM:1');
  await page.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Клиент'})
    .selectOption('11111111-1111-4111-8111-111111111111');
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
  assert.equal(await page.getByText('Простой TEST-запрос (совместимость)').count(),0,
    'Compatibility-only editor must not clutter normal license preparation');
  await page.getByRole('button',{name:'Открыть TEST-запрос'}).click();
  await page.getByText('Простой TEST-запрос (совместимость)').waitFor();
  const legacyVisible=await page.getByLabel('Функции (коды через запятую)').evaluate(el=>{
    const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=window.innerHeight;
  });
  assert.ok(legacyVisible,'Legacy TEST editor must be visible after explicit shortcut');
  checks.push('legacy-test-form-explicit-native-scroll-navigation');
  const legacySave=page.getByRole('button',{name:'Сохранить запрос'});
  assert.equal(await legacySave.isDisabled(),true,'Legacy TEST request cannot silently use first product/holder');
  await page.getByRole('combobox',{name:'Продукт',exact:true}).selectOption('IWXA_ADMIN_CENTER');
  assert.equal(await legacySave.isDisabled(),true,'Legacy TEST request must require explicit recipient');
  await page.getByRole('combobox',{name:'Получатель',exact:true}).selectOption('11111111-1111-4111-8111-111111111111');
  assert.equal(await legacySave.isEnabled(),true);
  await page.getByLabel('Функции (коды через запятую)').fill('FEATURE_A,FEATURE_B');
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await legacySave.click();
  const legacyFeedback=page.getByTestId('publisher-legacy-save-feedback');
  await legacyFeedback.waitFor();
  assert.equal(await legacyFeedback.getAttribute('role'),'alert');
  assert.equal(await page.getByRole('combobox',{name:'Получатель',exact:true}).inputValue(),'11111111-1111-4111-8111-111111111111');
  assert.equal(await page.getByText('Подготовленные запросы (1)').count(),1);
  await legacySave.click();
  await page.getByText('Подготовленные запросы (2)').waitFor();
  await legacyFeedback.waitFor();
  assert.equal(await legacyFeedback.getAttribute('role'),'status');
  assert.match(await legacyFeedback.innerText(),/Черновик запроса сохранён/);
  assert.equal(await page.getByRole('combobox',{name:'Получатель',exact:true}).inputValue(),'');
  checks.push('legacy-test-request-explicit-product-recipient-native-failure-and-inline-save');
  assert.equal(await page.getByTestId('publisher-proposal-draft-status').first().innerText(),'Подготовка');
  checks.push('proposal-draft-status-does-not-claim-unsigned-T3-license');
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
  // A temporary owner-ledger read error at first opening must not hide
  // an already enrolled issuer or force a desktop restart.
  await page.evaluate(()=>{window.__publisherMockFailNextInventory=true;});
  await page.getByRole('button',{name:'Доверие и ключи'}).click();
  const ownerPanel=page.getByTestId('publisher-t3-owner-panel');
  await ownerPanel.getByText('Журнал T3 недоступен при запуске.',{exact:false}).waitFor();
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  assert.equal(await page.getByTestId('publisher-t3-refresh').isEnabled(),true);
  assert.match(await ownerPanel.innerText(),/Журнал пока не прочитан/);
  await page.getByTestId('publisher-t3-refresh').click();
  await ownerPanel.getByText('Журнал T3 обновлён.',{exact:false}).waitFor();
  checks.push('test-issuer-recovers-first-ledger-read-without-restart');
  const proposalChoice=ownerPanel.getByRole('combobox',{name:'Подготовленный запрос'});
  const issuerChoice=ownerPanel.getByRole('combobox',{name:'Полномочие издателя'});
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  await issuerChoice.selectOption('publisher:owner:test');
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  const issueSeats=ownerPanel.getByRole('spinbutton',{name:'Мест в TEST-запросе'});
  assert.equal(await issueSeats.isDisabled(),true,'No request must leave a seat value editable');
  const tariffProposalId=JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-test-native-draft'))).proposals[0].id;
  await proposalChoice.selectOption(tariffProposalId);
  const tariffIssuePreview=page.getByTestId('publisher-t3-issue-preview');
  assert.match(await tariffIssuePreview.innerText(),/от 1 до 5/);
  assert.match(await tariffIssuePreview.innerText(),/не подписываются этим контрактом/);
  assert.equal(await issueSeats.inputValue(),'');
  await issueSeats.fill('6');
  assert.match(await tariffIssuePreview.innerText(),/вне допустимого диапазона 1–5/);
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true,
    'The original T3 owner may not issue more seats than the saved tariff snapshot');
  await issueSeats.fill('5');
  assert.equal(await page.getByTestId('publisher-t3-issue').isEnabled(),true);
  await proposalChoice.selectOption(testRequest.requestId);
  assert.match(await proposalChoice.locator('option:checked').innerText(),
    /IWXA Admin Center · Test Corporation/);
  assert.equal(await issueSeats.inputValue(),'',
    'Switching requests must clear the seat count instead of carrying it over');
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  await issueSeats.fill('3');
  assert.equal(await page.getByTestId('publisher-t3-issue').isEnabled(),true);
  checks.push('t3-owner-seats-explicit-and-scoped-to-saved-tariff');
  const banner=await page.locator('main > .notice').first().innerText();
  assert.match(banner,/Лицензии TEST и PERSON подписывает исходный T3/);
  assert.match(banner,/Коммерческая активация мест и выпуск релизов отключены/);
  assert.doesNotMatch(banner,/подпись издателя не подключена/);
  // The original T3 inventory is limited to 48 entries. A truncated list
  // must not prove an unseen ALREADY_ISSUED receipt.
  await page.evaluate(()=>{
    window.__publisherMockNextAlreadyIssued=true;
    window.__publisherMockTruncatedInventoryOnce=true;
  });
  await page.getByTestId('publisher-t3-issue').click();
  const unverifiedOlderIssue=await ownerPanel.getByRole('alert').innerText();
  assert.match(unverifiedOlderIssue,/результат не подтверждён/);
  assert.match(unverifiedOlderIssue,/полный журнал оригинального T3/);
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  assert.equal(await page.getByText('Ранее выпущенная TEST-лицензия найдена в журнале T3.').count(),0);
  await page.getByTestId('publisher-t3-refresh').click();
  await page.getByText('Журнал T3 обновлён. Подписи и права не изменены.').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-issue').isEnabled(),true);
  checks.push('t3-truncated-inventory-cannot-verify-unseen-idempotent-issue');
  await page.getByTestId('publisher-t3-issue').click();
  await page.getByText('TEST-лицензия подписана T3 и сохранена в журнале издателя.').waitFor();
  // A signed request is not a second issuance opportunity: original T3
  // remains authoritative, while Publisher explains the existing result.
  await page.getByTestId('publisher-t3-already-issued').waitFor();
  assert.match(await page.getByTestId('publisher-t3-already-issued').innerText(),
    /license:test:native-ui:one/);
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  checks.push('t3-original-ledger-disables-repeat-admin-center-test-issuance');
  const signedTestMock=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('publisher-t3-mock-licenses')));
  assert.equal(signedTestMock[0].claimedSeats,3,'Original T3 TEST issue must match explicit user seat count');
  assert.equal(await page.getByTestId('publisher-t3-export').isDisabled(),true,
    'The issued TEST license must not be silently selected for further operations');
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true);
  await ownerPanel.getByRole('combobox',{name:'Лицензия',exact:true})
    .selectOption('license:test:native-ui:one');
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true,
    'Status change must require a new explicit status choice');
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('ACTIVE');
  await page.getByTestId('publisher-t3-change-status').click();
  await page.getByText('Новый подписанный TEST-статус сохранён в T3: ACTIVE').waitFor();
  await page.getByTestId('publisher-t3-export').click();
  await page.getByText('Пакет .iwxa выпущен T3 и подтверждён повторным чтением.').waitFor();
  assert.match(await page.getByTestId('publisher-t3-owner-panel').innerText(),/Активных мест: 0/);
  checks.push('publisher-owner-operations-through-native-IPC-model-only-no-commercial-seats');
  checks.push('original-t3-test-issue-status-and-export-require-explicit-selections');
  // T3 already signed SUSPENDED but its native IPC answer was lost. No
  // second signature can be produced until the genuine ledger is read.
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('SUSPENDED');
  await page.evaluate(()=>{window.__publisherMockLoseNextTestStatusResponse=true;});
  await page.getByTestId('publisher-t3-change-status').click();
  const readbackError=await ownerPanel.getByRole('alert').innerText();
  assert.match(readbackError,/Операция могла сохраниться в T3 без ответа/);
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true);
  assert.equal(await page.getByTestId('publisher-t3-export').isDisabled(),true);
  assert.doesNotMatch(await ownerPanel.innerText(),/Новый подписанный TEST-статус сохранён в T3: SUSPENDED/);
  await page.getByTestId('publisher-t3-refresh').click();
  await page.getByText('Журнал T3 обновлён. Подписи и права не изменены.').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
  const afterLostTestReply=JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('publisher-t3-mock-licenses')));
  assert.equal(afterLostTestReply[0].status,'SUSPENDED');
  assert.equal(afterLostTestReply[0].sequence,2,
    'Lost native TEST reply must not produce a duplicate signed status');
  checks.push('publisher-admin-test-lost-IPC-response-requires-owner-readback');
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('REVOKED');
  await page.getByTestId('publisher-t3-change-status').click();
  const revokePrompt=page.getByTestId('publisher-t3-revoke-confirmation');
  await revokePrompt.waitFor();
  assert.match(await revokePrompt.innerText(),/повторная активация будет недоступна/);
  assert.equal(JSON.parse(await page.evaluate(()=>sessionStorage.getItem('publisher-t3-mock-licenses')))[0].status,
    'SUSPENDED','Opening the revocation confirmation must not change the original ledger');
  await revokePrompt.getByRole('button',{name:'Отмена'}).click();
  assert.equal(await revokePrompt.count(),0);
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true);
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('REVOKED');
  await page.getByTestId('publisher-t3-change-status').click();
  await revokePrompt.getByRole('button',{name:'Подтвердить отзыв'}).click();
  await page.getByText('Новый подписанный TEST-статус сохранён в T3: REVOKED').waitFor();
  assert.equal(await revokePrompt.count(),0);
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true);
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
  checks.push('t3-native-readback-failure-cannot-claim-success-and-revocation-is-terminal');
  checks.push('t3-test-revocation-requires-explicit-inline-confirmation-and-cancel');
  // The independent Admin Center's exact unsigned request can be signed
  // without creating a second customer/product/proposal in Publisher.
  const fromAdmin=prepareAdminPublisherTestRequest({
    organization:{id:'org:cross-app-demo',name:'Workshop from Admin',kind:'ORGANIZATION'},
    requestId:'request:admin:cross-app-001',requestedAt:'2026-11-11T12:00:00.000Z',
    seats:2,termDays:45,version:'0.3.0'
  });
  await page.evaluate(content=>{window.__publisherMockAdminUnsignedRequest=content;},fromAdmin.content);
  const draftsBefore=await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft'));
  await page.getByTestId('publisher-open-admin-request').click();
  const review=page.getByTestId('publisher-admin-request-review');
  await review.waitFor();
  assert.match(await review.innerText(),/Workshop from Admin/);
  assert.match(await review.innerText(),/org:cross-app-demo/);
  assert.match(await review.innerText(),/request:admin:cross-app-001/);
  assert.match(await review.innerText(),/45 дней/);
  assert.match(await review.innerText(),/TEST-мест: 2/);
  assert.equal(await page.getByTestId('publisher-sign-admin-request').isEnabled(),true);
  await page.getByTestId('publisher-sign-admin-request').click();
  await page.getByText('Запрос Admin Center подписан исходным T3.',{exact:false}).waitFor();
  await page.getByTestId('publisher-admin-request-already-issued').waitFor();
  assert.equal(await page.getByTestId('publisher-sign-admin-request').isDisabled(),true);
  assert.match(await page.getByTestId('publisher-admin-request-already-issued').innerText(),
    /license:test:native-ui:two/);
  const externalLedger=JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('publisher-t3-mock-licenses')));
  assert.equal(externalLedger.length,2);
  assert.equal(externalLedger[1].requestId,fromAdmin.request.requestId);
  assert.equal(externalLedger[1].organizationId,fromAdmin.request.subject.id);
  assert.equal(externalLedger[1].claimedSeats,2);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')),
    draftsBefore,'Admin request must not mutate local Publisher drafts');
  checks.push('admin-unsigned-request-signing-through-original-T3-owner');
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
  // Inspecting an EXE is not publication. Its product must be explicitly
  // chosen and the evidence must survive a failed native save.
  await page.evaluate(()=>{window.__publisherMockInspectedArtifact={
    name:'iwxa-publisher.exe',size:4096,sha256:'d'.repeat(64)};});
  await page.getByRole('button',{name:'Выбрать и проверить файл'}).click();
  const inspectedRelease=page.getByTestId('publisher-artifact-save-action');
  await inspectedRelease.waitFor();
  const saveInspected=page.getByRole('button',{name:'Сохранить проверенный файл'});
  assert.equal(await saveInspected.isDisabled(),true,
    'Release evidence must not silently borrow the first catalog product');
  assert.equal(await page.getByLabel('Версия файла').inputValue(),'');
  assert.equal(await page.getByRole('combobox',{name:'Платформа'}).inputValue(),'');
  assert.equal(await page.getByLabel('Репозиторий источника').inputValue(),'');
  await page.getByRole('combobox',{name:'Продукт',exact:true}).selectOption('IWXA_ADMIN_CENTER');
  await page.getByLabel('Версия файла').fill('0.3.0');
  await page.getByRole('combobox',{name:'Платформа'}).selectOption('windows-x64');
  await page.getByLabel('Репозиторий источника').fill('Faust-S/Center');
  await page.getByLabel('Source commit (40 hex)').fill('a'.repeat(40));
  await page.getByLabel('Source tree (40 hex)').fill('b'.repeat(40));
  assert.equal(await saveInspected.isEnabled(),true);
  await page.evaluate(()=>{window.__publisherMockFailNextSave=true;});
  await saveInspected.click();
  const releaseFeedback=page.getByTestId('publisher-artifact-save-feedback');
  await releaseFeedback.waitFor();
  assert.equal(await releaseFeedback.getAttribute('role'),'alert');
  assert.match(await releaseFeedback.innerText(),/Не удалось сохранить/);
  assert.equal(await page.getByText('Проверенные файлы (0)').count(),1);
  assert.match(await page.locator('.inspected').innerText(),/iwxa-publisher.exe/);
  assert.equal(await page.getByLabel('Source commit (40 hex)').inputValue(),'a'.repeat(40));
  await saveInspected.click();
  await page.getByText('Проверенные файлы (1)').waitFor();
  assert.equal(await releaseFeedback.getAttribute('role'),'status');
  assert.match(await releaseFeedback.innerText(),/Источник и решение о публикации не подтверждены/);
  assert.equal(await saveInspected.isDisabled(),true,
    'A successful save must not create an accidental duplicate on repeated click');
  assert.match(await page.locator('.inspected').innerText(),/iwxa-publisher.exe/);
  const persistedArtifact=JSON.parse(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')));
  assert.equal(persistedArtifact.artifacts[0].productId,'IWXA_ADMIN_CENTER');
  assert.equal(persistedArtifact.artifacts[0].status,'BYTES_INSPECTED_NOT_APPROVED');
  checks.push('release-native-save-failure-retains-inspected-file-and-success-inline');
  checks.push('release-evidence-requires-explicit-product-and-is-not-authorized');
  await page.getByRole('button',{name:'Выбрать и проверить файл'}).click();
  assert.equal(await page.getByRole('combobox',{name:'Продукт',exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel('Версия файла').inputValue(),'');
  assert.equal(await page.getByLabel('Репозиторий источника').inputValue(),'');
  assert.equal(await saveInspected.isDisabled(),true,
    'Newly inspected EXE must not reuse the preceding release source metadata');
  checks.push('release-new-file-clears-previous-product-version-and-source');
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
  await page.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Клиент'})
    .selectOption('11111111-1111-4111-8111-111111111111');
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
    window.assertPersonRequest=(r,issuer)=>{
      if(r.environment!=='PRODUCTION'||r.kind!=='PERSON_LICENSE_REQUEST'||
         r.subject.type!=='PERSON'||r.product.id!=='IWXA_ATLAS'||
         r.deviceLimit!==3||r.seats!==1||r.status!=='UNSIGNED_REQUEST'||
         issuer!=='publisher:person:mock')throw Error('PERSON_TEST_REQUEST_SCOPE_MISMATCH');
      if(Object.hasOwn(r,'renewalOfRequestId')&&
         (typeof r.renewalOfRequestId!=='string'||
          r.renewalOfRequestId===r.requestId))
        throw Error('PERSON_TEST_RENEWAL_LINK_INVALID');
    };
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='publisher_draft_read')return sessionStorage.getItem('iwxa-publisher-person-fixture');
      if(command==='publisher_draft_save'){sessionStorage.setItem('iwxa-publisher-person-fixture',args.content);return true;}
      if(command==='publisher_t3_capabilities')return {operation:'TEST_CAPABILITIES',issuers:['test:owner'],activeSeats:0,productionActivation:false,commercialAuthorityProven:false};
      if(command==='publisher_t3_inventory')return {operation:'TEST_INVENTORY',licenses:[],activeSeats:0,productionActivation:false};
      if(command==='publisher_t3_person_capabilities'){
        if(!window.__personNativeEnabled)throw Error('PERSON_OWNER_NOT_ENROLLED');
        return {operation:'PERSON_CAPABILITIES',environment:'PRODUCTION',
          issuers:['publisher:person:mock','publisher:person:alternate'],activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_inventory'){
        if(window.__personMockFailNextInventory){
          window.__personMockFailNextInventory=false;
          throw Error('PERSON_T3_TEMPORARY_INVENTORY_UNAVAILABLE');
        }
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const matches=args.lookupId?
          ledger.filter(x=>x.licenseId===args.lookupId||
            x.requestId===args.lookupId||x.personId===args.lookupId):ledger;
        // Simulate a predecessor outside the recent 48 while the exact
        // original-owner lookup still finds its durable signed record.
        const visible=!args.lookupId&&window.__personMockHideOriginalRecent?
          matches.filter(x=>x.requestId!==window.__personMockHideOriginalRecent):
          matches;
        return {operation:'PERSON_INVENTORY',licenses:visible.slice(-48),
          total:ledger.length,truncated:matches.length>48,
          ...(args.lookupId?{lookupId:args.lookupId,matches:matches.length}:{}),
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_issue'){
        const r=JSON.parse(args.requestJson);
        window.assertPersonRequest(r,args.issuerAuthorityId);
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const issued=ledger.find(e=>e.requestId===r.requestId);
        if(issued)return {operation:'PERSON_ISSUE',outcome:'ALREADY_ISSUED',
          licenseId:issued.licenseId,requestId:r.requestId,
          activeSeats:0,productionActivation:false};
        const prior=r.renewalOfRequestId?
          ledger.find(e=>e.requestId===r.renewalOfRequestId):null;
        if(Object.hasOwn(r,'renewalOfRequestId')&&
          (!prior||!['ACTIVE','SUSPENDED'].includes(prior.status)||
           ledger.some(e=>e.renewalOfLicenseId===prior.licenseId)))
          throw Error('PERSON_TEST_RENEWAL_LEDGER_DENIED');
        const issuedAt=new Date().toISOString();
        const one={licenseId:prior?'license:person:mock:two':'license:person:mock:one',
          requestId:r.requestId,issuerAuthorityId:args.issuerAuthorityId,
          personId:r.subject.id,productId:r.product.id,
          ...(prior?{renewalOfLicenseId:prior.licenseId}:{}),
          deviceLimit:r.deviceLimit,quotaCount:r.quotas.length,
          issuedAt,notBefore:issuedAt,
          expiresAt:new Date(Date.now()+r.termDays*86400000).toISOString(),
          status:'NOT_ACTIVATED',sequence:0,activeSeats:0};
        ledger.push(one);
        sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
        return {operation:'PERSON_ISSUE',outcome:'ISSUED_NEW',
          licenseId:one.licenseId,requestId:r.requestId,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_change_status'){
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const one=ledger.find(e=>e.licenseId===args.licenseId);
        if(!one||one.status==='REVOKED')throw Error('PERSON_OWNER_REVOKED_TERMINAL');
        one.status=args.nextStatus;one.sequence+=1;
        one.statusIssuedAt=new Date().toISOString();
        one.statusValidUntil=new Date(Math.min(
          Date.now()+24*3600000,Date.parse(one.expiresAt))).toISOString();
        sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
        if(window.__personMockLoseNextStatusReceipt){
          window.__personMockLoseNextStatusReceipt=false;
          throw Error('PERSON_TEST_NATIVE_RESPONSE_LOST_AFTER_COMMIT');
        }
        return {operation:'PERSON_STATUS',licenseId:one.licenseId,
          state:one.status,sequence:one.sequence,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_export_public_trust')return {
        operation:'PERSON_TRUST_EXPORTED',publicOnly:true,bytes:850,
        sha256:'d'.repeat(64),keyCount:2,issuerCount:1,
        activeSeats:0,productionActivation:false};
      if(command==='publisher_t3_person_export')return {
        operation:'PERSON_IWXA_EXPORTED',licenseId:args.licenseId,
        bytes:1024,packageSha256:'c'.repeat(64),
        activeSeats:0,productionActivation:false};
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
  assert.equal(await personal.getByRole('button',{name:'Сохранить редакцию тарифа'}).isDisabled(),true);
  await personal.getByRole('combobox',{name:'Продукт',exact:true}).selectOption('IWXA_ATLAS');
  await personal.getByLabel('Код тарифа').fill('ATLAS_PERSONAL');
  await personal.getByLabel('Название тарифа').fill('Личный');
  await personal.getByRole('combobox',{name:'Тип клиента для тарифа'}).selectOption('PERSON');
  await personal.getByLabel('Устройства владельца').fill('3');
  await personal.getByLabel('Функции и модули').fill('WORKSPACE');
  assert.equal(await personal.getByLabel('Сотрудники организации').count(),0);
  await personal.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  await personal.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Тариф'})
    .selectOption('IWXA_ATLAS:PERSON:ATLAS_PERSONAL:1');
  await personal.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Клиент'})
    .selectOption('person:local-example');
  const personPreview=await personal.getByTestId('publisher-offline-offer-preview').innerText();
  assert.match(personPreview,/Устройства: 3/);
  assert.doesNotMatch(personPreview,/Сотрудники:/);
  assert.match(personPreview,/Неподписанная подготовка/);
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  const personalLicenseChoice=personal.getByTestId('publisher-tariff-proposal');
  await personalLicenseChoice.waitFor();
  assert.equal(await personal.getByRole('button',{name:'Сохранить подготовку по тарифу'}).isDisabled(),true);
  await personalLicenseChoice.getByRole('combobox',{name:'Тариф'}).selectOption('IWXA_ATLAS:PERSON:ATLAS_PERSONAL:1');
  await personalLicenseChoice.getByRole('combobox',{name:'Клиент'}).selectOption('person:local-example');
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
  assert.equal(await personal.getByRole('combobox',{name:'Подготовленный запрос'}).locator('option:not([value=""])').count(),0);
  checks.push('personal-test-issuer-unavailable-even-with-active-original-owner');

  // A synthetic native PERSON issuer may be enabled only after separate
  // explicit pre-enrollment. This is a UI double, not a signer or entitlement.
  await personal.evaluate(()=>{window.__personNativeEnabled=true;
    window.__personMockFailNextInventory=true;});
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByRole('button',{name:'Доверие и ключи'}).click();
  const personOwner=personal.getByTestId('publisher-person-owner');
  await personOwner.getByText('Журнал персональных лицензий T3 недоступен при запуске.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  assert.equal(await personOwner.getByTestId('publisher-person-refresh').isEnabled(),true);
  assert.match(await personOwner.innerText(),/Журнал пока не прочитан/);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-issuer-recovers-first-ledger-read-without-restart');
  // Native select options are intentionally hidden in Firefox.
  // selectOption waits for the exact option to be attached.
  await personOwner.getByTestId('publisher-person-public-trust-export').click();
  await personOwner.getByText('Публичное доверие издателя экспортировано',{exact:false}).waitFor();
  checks.push('person-owner-public-trust-export-original-t3-ipc');
  await personOwner.getByRole('combobox',{name:'Издатель'}).selectOption('publisher:person:mock');
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(directDraft.proposals[0].id);
  assert.match(await personOwner.getByTestId('publisher-person-issue-preview').innerText(),
    /Устройства|устройств: 3/);
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  await personOwner.getByLabel('Подтверждаю выпуск на указанных условиях').check();
  // A preflight read failure is not an ambiguous signed mutation.
  await personal.evaluate(()=>{window.__personMockFailNextInventory=true;});
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Предварительная проверка T3 не выполнена:',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isEnabled(),true);
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,0);
  checks.push('person-preflight-error-retry-does-not-create-ambiguous-signature');
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Подписанная лицензия сохранена в журнале издателя и выбрана.',{exact:false}).waitFor();
  await personOwner.getByTestId('publisher-person-already-issued').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /license:person:mock:one/);
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:one/,
    'Publisher must select the just-issued PERSON license after original T3 readback');
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true,
    'An already-signed original PERSON request must not offer repeated issue');
  await personOwner.getByRole('combobox',{name:'Издатель'})
    .selectOption('publisher:person:alternate');
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true,
    'Changing issuer must not permit the same signed request to be reissued');
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /издатель publisher:person:mock/);
  await personOwner.getByRole('combobox',{name:'Издатель'})
    .selectOption('publisher:person:mock');
  checks.push('person-signed-request-id-remains-unique-across-authorities');
  const personLicensePicker=personOwner.getByRole('combobox',{name:'Персональная лицензия',exact:true});
  assert.equal(await personOwner.getByRole('combobox',{name:'Лицензия',exact:true}).count(),0,
    'PERSON and TEST license selectors must have distinct accessible names');
  const firstIssuedLabel=await personLicensePicker.locator('option[value="license:person:mock:one"]').textContent();
  assert.match(firstIssuedLabel,/Первоначальный выпуск/);
  assert.match(firstIssuedLabel,/license:person:mock:one/);
  await personLicensePicker.selectOption('license:person:mock:one');
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /Выбрана запись T3: license:person:mock:one/);
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('ACTIVE');
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Подписанный статус сохранён.',{exact:false}).waitFor();
  const dates=await personOwner.getByTestId('publisher-person-license-dates').innerText();
  assert.match(dates,/Лицензия выдана:/);
  assert.match(dates,/Срок лицензии до:/);
  assert.match(dates,/Подписанный статус ACTIVE выдан/);
  assert.match(dates,/Действителен до:/);
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true,
    'Do not create redundant same-state signatures while current status has a full day left');
  checks.push('publisher-person-shows-separate-license-and-status-expiry');
  // A new PERSON subscription is a distinct unsigned follow-up tied to
  // the exact signed original entry. It must not silently reissue rights.
  await personOwner.getByRole('combobox',{name:'Тариф продления PERSON'})
    .selectOption('ATLAS_PERSONAL#1');
  await personOwner.getByTestId('publisher-person-prepare-renewal').click();
  await personOwner.getByText('Подготовка продления сохранена.',{exact:false}).waitFor();
  const renewedDraft=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture')));
  assert.equal(renewedDraft.proposals.length,2);
  assert.equal(renewedDraft.proposals[1].previousProposalId,directDraft.proposals[0].id);
  assert.equal(renewedDraft.proposals[1].holderId,directDraft.proposals[0].holderId);
  assert.equal(renewedDraft.proposals[1].productId,directDraft.proposals[0].productId);
  assert.notEqual(renewedDraft.proposals[1].id,directDraft.proposals[0].id);
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .locator('option[value="'+renewedDraft.proposals[1].id+'"]:checked')
    .waitFor({state:'attached'});
  assert.equal(await personOwner.getByLabel('Подтверждаю выпуск на указанных условиях').isChecked(),false,
    'Auto-selecting the saved renewal must never imply consent to a signature');
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger'))).length,1);
  checks.push('person-renewal-prepared-from-signed-native-record');
  // Simulate the older signed predecessor missing from the recent inventory.
  // The renewal must use original T3's exact request lookup instead of
  // making the user recover the predecessor in the GUI first.
  await personal.evaluate(id=>{window.__personMockHideOriginalRecent=id;},
    directDraft.proposals[0].id);
  // Prior status readback can keep the old ID in an explicit search; reset
  // that search to exercise the actual bounded recent-inventory case.
  await personOwner.getByTestId('publisher-person-lookup-clear').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByRole('combobox',{name:'Персональная лицензия'})
    .locator('option[value="license:person:mock:one"]').count(),0);
  await personal.evaluate(()=>{window.__personMockHideOriginalRecent=null;});
  // Validate the complete public GUI -> native IPC request for the newly
  // prepared follow-up. The mock only echoes it; original T3 signs in the
  // private Windows qualification, never in this browser test.
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(renewedDraft.proposals[1].id);
  const renewalPreview=await personOwner.getByTestId('publisher-person-issue-preview').innerText();
  assert.match(renewalPreview,/устройств: 3/);
  await personOwner.getByLabel('Подтверждаю выпуск на указанных условиях').check();
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Подписанная лицензия сохранена в журнале издателя и выбрана.',{exact:false}).waitFor();
  await personOwner.getByTestId('publisher-person-already-issued').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /license:person:mock:two/);
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:two/,
    'Signed renewal must be selected after exact original T3 readback');
  checks.push('person-renewal-references-original-T3-even-when-older-than-recent-view');
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true,
    'A signed renewal cannot silently be issued a second time');
  const updatedLedger=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(updatedLedger.length,2);
  assert.equal(updatedLedger[1].requestId,renewedDraft.proposals[1].id);
  assert.equal(updatedLedger[1].renewalOfLicenseId,'license:person:mock:one');
  // The original T3 journal readback is asynchronous. Do not inspect a
  // newly signed renewal before the public owner UI has reconciled it.
  // Native <option> elements are not visible in Firefox: read textContent.
  await personOwner.getByText('В журнале: 2.',{exact:false}).waitFor({timeout:15000});
  const visibleOptions=await personLicensePicker.locator('option').allTextContents();
  assert.equal(visibleOptions.length,3,
    'Renewal must appear as a second selectable record: '+JSON.stringify(visibleOptions));
  const renewedLicenseLabel=await personLicensePicker.locator(
    'option[value="license:person:mock:two"]').textContent();
  assert.match(renewedLicenseLabel,/Продление/);
  assert.match(renewedLicenseLabel,/license:person:mock:two/);
  assert.notEqual(renewedLicenseLabel,firstIssuedLabel,
    'Two signed records for the same PERSON/product must not be indistinguishable');
  await personLicensePicker.selectOption('license:person:mock:two');
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /Продление лицензии license:person:mock:one/);
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('ACTIVE');
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Подписанный статус сохранён.',{exact:false}).waitFor();
  checks.push('person-renewal-issued-over-native-ipc-with-source-request-identity');
  checks.push('person-original-and-renewal-requests-cannot-be-reissued-by-ui');
  await personOwner.getByRole('combobox',{name:'Персональная лицензия',exact:true})
    .selectOption('license:person:mock:one');
  await personOwner.getByTestId('publisher-person-export').click();
  await personOwner.getByText('Подписанный пакет .iwxa сохранён',{exact:false}).waitFor();
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('REVOKED');
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByTestId('publisher-person-revoke-confirmation').waitFor();
  assert.equal(await personOwner.getByRole('button',{name:'Подтвердить отзыв',exact:true}).count(),0,
    'TEST and PERSON terminal revocations need distinct accessible names');
  assert.equal(await personOwner.getByRole('button',{name:'Подтвердить отзыв PERSON'}).count(),1);
  await personOwner.getByRole('button',{name:'Подтвердить отзыв PERSON'}).click();
  await personOwner.getByText('Подписанный отзыв сохранён.',{exact:false}).waitFor();
  const received=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(received.length,2);
  assert.equal(received[0].status,'REVOKED');
  assert.equal(received[0].sequence,2);
  assert.equal(received[0].activeSeats,0);
  assert.equal(received[1].status,'ACTIVE');
  assert.equal(received[1].sequence,1);
  assert.equal(received[1].renewalOfLicenseId,'license:person:mock:one');
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true);
  checks.push('publisher-person-owner-mocked-signed-native-route');
  checks.push('person-original-and-renewal-selectors-show-distinct-native-license-ids');
  checks.push('person-and-test-license-selectors-distinct-accessibility-names');
  // The actual owner can commit a signed state and still lose the IPC answer.
  // The next click must NOT issue another status sequence until the durable
  // T3 inventory has been read back, regardless of the in-memory UI state.
  await personLicensePicker.selectOption('license:person:mock:two');
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('SUSPENDED');
  await personal.evaluate(()=>{window.__personMockLoseNextStatusReceipt=true;});
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Операция могла сохраниться в T3',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true);
  const committedWithoutReceipt=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(committedWithoutReceipt[1].status,'SUSPENDED');
  assert.equal(committedWithoutReceipt[1].sequence,2);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true,
    'Selected new status already exists in original T3 after readback');
  const afterLostResponse=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(afterLostResponse[1].sequence,2,
    'Reading ledger must not create another signed native status');
  checks.push('person-lost-native-status-response-blocks-retry-until-exact-ledger-refresh');
  // An unexpired license may have a nearly expired signed STATUS. T3 Owner
  // supports a new monotonic status sequence without issuing a new LICENSE.
  await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[1].statusIssuedAt=new Date(Date.now()-55*60*1000).toISOString();
    ledger[1].statusValidUntil=new Date(Date.now()+5*60*1000).toISOString();
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  });
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-status').isEnabled(),true,
    'Owner should be able to refresh an expiring SUSPENDED status without issuing a new license');
  assert.equal(await personOwner.getByTestId('publisher-person-status').innerText(),
    'Обновить подпись статуса');
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Подписанный статус сохранён.',{exact:false}).waitFor();
  const refreshedStatus=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(refreshedStatus.length,2);
  assert.equal(refreshedStatus[1].status,'SUSPENDED');
  assert.equal(refreshedStatus[1].sequence,3);
  assert.ok(Date.parse(refreshedStatus[1].statusValidUntil)>Date.now()+6*60*60*1000);
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true,
    'Fresh signed status cannot be needlessly re-signed');
  checks.push('person-same-state-status-refresh-uses-next-original-T3-sequence');

  // Historical signed licenses must remain usable after the T3 inventory
  // exceeds its bounded recent view. No second signature is allowed.
  await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    for(let i=0;i<51;i++)ledger.push({
      licenseId:'license:historical:'+i,requestId:'request:historical:'+i,
      issuerAuthorityId:'publisher:person:mock',personId:'person:other:'+i,
      productId:'IWXA_ATLAS',deviceLimit:1,quotaCount:0,
      issuedAt:new Date().toISOString(),notBefore:new Date().toISOString(),
      expiresAt:new Date(Date.now()+30*86400000).toISOString(),
      statusIssuedAt:new Date().toISOString(),
      statusValidUntil:new Date(Date.now()+86400000).toISOString(),
      status:'ACTIVE',sequence:1,activeSeats:0
    });
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  });
  await personOwner.getByTestId('publisher-person-lookup-clear').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  const oldLicense='license:person:mock:one';
  assert.equal(await personOwner.getByRole('combobox',{name:'Персональная лицензия'})
    .locator('option[value="'+oldLicense+'"]').count(),0);
  await personOwner.getByTestId('publisher-person-lookup-input').fill(oldLicense);
  await personOwner.getByTestId('publisher-person-lookup').click();
  await personOwner.getByText('Поиск в исходном T3: найдено записей 1.',{exact:true}).waitFor();
  assert.equal(await personOwner.getByRole('combobox',{name:'Персональная лицензия'}).inputValue(),oldLicense);
  assert.equal(await personOwner.getByTestId('publisher-person-export').isEnabled(),true);
  checks.push('person-historical-license-search-and-export-remain-available-after-48-records');
  // The already-issued original request is absent from the recent 48.
  // Issue must consult original T3 and recover the old signed record.
  await personOwner.getByTestId('publisher-person-lookup-clear').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(directDraft.proposals[0].id);
  await personOwner.getByRole('checkbox',{name:'Подтверждаю выпуск на указанных условиях'}).check();
  assert.equal(await personOwner.getByTestId('publisher-person-already-issued').count(),0);
  const countBefore=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger'))).length;
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Эта подготовка уже подписана исходным T3.',{exact:false}).waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /license:person:mock:one/);
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:one/, 'Recovered signed license must be selected from exact original T3 readback');
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger'))).length,countBefore);
  checks.push('person-original-owner-lookup-prevents-duplicate-issue-outside-recent-48');
  // A signed renewal remains recoverable even if the ORIGINAL has later
  // been terminally revoked and both records left the recent 48.
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(renewedDraft.proposals[1].id);
  await personOwner.getByRole('checkbox',{name:'Подтверждаю выпуск на указанных условиях'}).check();
  assert.equal(await personOwner.getByTestId('publisher-person-already-issued').count(),0);
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Эта подготовка уже подписана исходным T3.',{exact:false}).waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:two/);
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger'))).length,countBefore);
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  checks.push('person-signed-renewal-recoverable-after-original-revocation');

  // A second client type can use the same tariff code, product and revision.
  // This is one shared catalog, not a separate personal issuer or format.
  await personal.getByRole('button',{name:'Клиенты',exact:true}).click();
  await personal.getByLabel('Тип субъекта').selectOption('ORGANIZATION');
  await personal.getByLabel('Идентификатор клиента').fill('org:atlas-test');
  await personal.getByLabel('Название / имя').fill('Atlas Organization');
  await personal.getByRole('button',{name:'Сохранить клиента'}).click();
  await personal.getByText('Клиенты (2)').waitFor();
  await personal.getByRole('button',{name:'Тарифы и лимиты',exact:true}).click();
  assert.equal(await personal.getByRole('button',{name:'Сохранить редакцию тарифа'}).isDisabled(),true,
    'Newly reopened tariff editor must not reuse the previous product selection');
  await personal.getByRole('combobox',{name:'Продукт',exact:true}).selectOption('IWXA_ATLAS');
  await personal.getByLabel('Код тарифа').fill('ATLAS_PERSONAL');
  await personal.getByLabel('Название тарифа').fill('Команда Atlas');
  await personal.getByLabel('Функции и модули').fill('WORKSPACES');
  await personal.getByRole('button',{name:'Сохранить редакцию тарифа'}).click();
  await personal.getByText('Сохранённые тарифы (2)').waitFor();
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  const orgSelector=personal.getByTestId('publisher-tariff-proposal')
    .getByRole('combobox',{name:'Тариф'});
  await orgSelector.selectOption('IWXA_ATLAS:ORGANIZATION:ATLAS_PERSONAL:1');
  assert.equal(await personal.getByRole('button',{name:'Сохранить подготовку по тарифу'}).isDisabled(),true);
  await personal.getByTestId('publisher-tariff-proposal').getByRole('combobox',{name:'Клиент'})
    .selectOption('org:atlas-test');
  assert.match(await personal.getByTestId('publisher-offline-offer-preview').innerText(),/Сотрудники: 10/);
  await personal.getByRole('button',{name:'Сохранить подготовку по тарифу'}).click();
  await personal.getByText('Подготовленные запросы (3)').waitFor();
  const sharedCatalog=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture')));
  assert.deepEqual(sharedCatalog.proposals.map(p=>p.tariffSnapshot.holderType),
    ['PERSON','PERSON','ORGANIZATION']);
  assert.ok(sharedCatalog.proposals.every(p=>p.status==='DRAFT_NOT_ISSUED'));
  await personal.reload();
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByText('Подготовленные запросы (3)').waitFor();
  checks.push('same-code-person-and-organization-tariffs-remain-independent-after-restart');
  // A signed PERSON owner ledger is authoritative even if the local proposal
  // remains DRAFT_NOT_ISSUED. Deleting it would break later renewal.
  const signedCountBefore=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length;
  await personal.evaluate(()=>{window.__personMockFailNextInventory=true;});
  await personal.getByRole('button',{name:'Удалить',exact:true}).first().click();
  await personal.getByText('Журнал T3 недоступен: нельзя подтвердить',{exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).proposals.length,3,
    'Lost native ledger must preserve a possibly signed PERSON proposal');
  await personal.getByRole('button',{name:'Удалить',exact:true}).first().click();
  await personal.getByText('Подписанный PERSON-запрос нельзя удалить',{exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).proposals.length,3,
    'Deleting a signed T3 source request would break its renewal lineage');
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,signedCountBefore);
  checks.push('signed-person-proposal-retained-after-ledger-failure-and-owner-readback');
  // Unsigned organization drafts remain removable without a PERSON owner
  // or a second Publisher-side license status store.
  await personal.getByRole('button',{name:'Удалить',exact:true}).last().click();
  await personal.getByText('Подготовленные запросы (2)').waitFor();
  checks.push('unsigned-organization-proposal-remains-removable');
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
