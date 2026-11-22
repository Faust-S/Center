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
      if(command==='publisher_save_corporate_request'){
        sessionStorage.setItem('iwxa-publisher-corporate-unsigned-request',args.content);
        return true;
      }
      if(command==='publisher_pick_unsigned_admin_request')
        return window.__publisherMockAdminUnsignedRequest??null;
      if(command==='publisher_export_preparation_backup')return false;
      if(command==='publisher_pick_preparation_backup')return null;
      if(command==='publisher_inspect_artifact')return window.__publisherMockInspectedArtifact??null;
      if(command==='publisher_diagnostics')return {
        schema:'IWXA_DIAGNOSTICS/1',productId:'iwxa.publisher',version:'0.5.0-dev.1',
        application:'NATIVE_RUNNING',localPreparation:'READABLE',
        webviewProfile:'FOLDER_PRESENT',setupCore:'CHECK_IN_SETUP_CORE',
        licensing:'TEST_AND_PERSON_T3_BRIDGE',activeSeats:0,productionActivation:false,
        attentionRequired:false};
      if(command==='publisher_age_status')return {
        operation:'AGE_STATUS',available:false,recipient:null,
        provider:'WINDOWS_DPAPI_CURRENT_USER',
        toolchain:{ready:window.__publisherAgeToolchainReady!==false},admitted:false};
      if(command==='publisher_age_encrypt')return {
        operation:'AGE_ENCRYPTED',recipientCount:1,sourceSha256:'a'.repeat(64),
        ciphertextSha256:'b'.repeat(64),deliveryState:'NOT_CONFIRMED',admitted:false};
      if(command==='publisher_age_inspect')return {
        operation:'AGE_INSPECTED',recipientStanzas:1,admitted:false};
      if(command==='publisher_age_decrypt')return {
        operation:'AGE_DECRYPTED',sourceSha256:'a'.repeat(64),
        state:'DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED',admitted:false};
      if(command==='publisher_t3_corporate_capabilities'){
        if(window.__publisherMockCorporateEnrolled!==true)
          throw Error('CORPORATE_ORIGINAL_OWNER_NOT_ENROLLED');
        return {operation:'CORPORATE_CAPABILITIES',
          environment:'PRODUCTION',issuers:['issuer:corporate:fixture'],
          commercialAuthorityProven:false,activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_corporate_issue'){
        if(window.__publisherMockCorporateEnrolled!==true||
          args.issuerAuthorityId!=='issuer:corporate:fixture')
          throw Error('CORPORATE_ORIGINAL_ISSUER_DENIED');
        const request=JSON.parse(args.requestJson);
        if(request.kind!=='CORPORATE_LICENSE_REQUEST'||
          request.environment!=='PRODUCTION'||
          request.subject.type!=='ORGANIZATION')
          throw Error('CORPORATE_ORIGINAL_REQUEST_REJECTED');
        window.__publisherMockCorporateSignCount=
          (window.__publisherMockCorporateSignCount||0)+1;
        const entry={licenseId:'license:corporate:fixture',requestId:request.requestId,
          organizationId:request.subject.id,productId:'IWXA_ADMIN_CENTER',
          status:'NOT_ACTIVATED',sequence:0};
        sessionStorage.setItem('publisher-corporate-mock-signed',JSON.stringify(entry));
        return {operation:'CORPORATE_ISSUE',outcome:'ISSUED_NEW',
          licenseId:entry.licenseId,requestId:entry.requestId,
          productionActivation:false,activeSeats:0};
      }
      if(command==='publisher_t3_corporate_signed_readback'){
        const entry=JSON.parse(sessionStorage.getItem('publisher-corporate-mock-signed')||'null');
        if(!entry||entry.licenseId!==args.licenseId)
          throw Error('CORPORATE_ORIGINAL_SIGNED_ENTRY_MISSING');
        return {operation:'CORPORATE_SIGNED_READBACK',
          source:'ORIGINAL_T3_PRODUCT_ISSUE_LEDGER',
          ...entry,issuerAuthorityId:'issuer:corporate:fixture',
          tariffId:'TEAM',tariffRevision:1,productVersion:'0.5.0',
          licenseEnvelopeSha256:'e'.repeat(64),
          licenseSignatureVerifiedAtIssuance:true,
          statusEnvelopeSha256:null,statusSignatureVerifiedAtIssuance:false,
          statusFloorVerified:false,stateRevision:1,ledgerRevision:1,
          recipientConfirmed:false,activeSeats:0,
          assignablePersonalAgentSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_corporate_inventory'){
        const entry=JSON.parse(sessionStorage.getItem('publisher-corporate-mock-signed')||'null');
        const matches=entry&&
          [entry.licenseId,entry.requestId,entry.organizationId].includes(args.lookupId)
          ?[entry]:[];
        return {operation:'CORPORATE_INVENTORY',
          lookupId:args.lookupId,matches:matches.length,licenses:matches,
          total:entry?1:0,truncated:false,
          productionActivation:false,activeSeats:0};
      }
      if(command==='publisher_t3_export_test_trust')return {
        operation:'TEST_TRUST_EXPORTED',bytes:2048,sha256:'c'.repeat(64),
        publicOnly:true,activeSeats:0,productionActivation:false};
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
        const ledger=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
        const search=args?.lookupId;
        if(search){
          const matched=ledger.filter(x=>x.licenseId===search||
            x.requestId===search||x.organizationId===search);
          return {operation:'TEST_INVENTORY',
            licenses:matched.slice(-48),matches:matched.length,lookupId:search,
            total:ledger.length,truncated:matched.length>48,
            activeSeats:0,productionActivation:false};
        }
        const cap=window.__publisherMockRecentCap??48;
        return {operation:'TEST_INVENTORY',
          licenses:ledger.slice(-cap),total:ledger.length,
          truncated:ledger.length>cap,
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
        const previous=ledger.find(x=>x.requestId===req.requestId);
        const saved=previous??entry;
        if(!alreadyIssued&&!previous)ledger.push(entry);
        sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(ledger));
        return {operation:'TEST_ISSUE',outcome:alreadyIssued||!!previous?'ALREADY_ISSUED':'ISSUED_NEW',licenseId:saved.licenseId,
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
  assert.match(await page.locator('main').innerText(),/Статус выдачи — в журнале T3/);
  const corporatePrimary=page.getByTestId('publisher-corporate-primary');
  await corporatePrimary.waitFor();
  assert.match(await corporatePrimary.innerText(),/Корпоративная лицензия IWXA Admin Center/);
  assert.match(await corporatePrimary.innerText(),/только TEST-лицензия Admin Center/);
  assert.match(await corporatePrimary.innerText(),/Доступных для назначения мест: 0/);
  assert.equal(await corporatePrimary.getByRole('button',{name:'Подготовить корпоративную лицензию'}).count(),1);
  assert.equal(await page.evaluate(()=>{
    const first=document.querySelector('[data-testid="publisher-corporate-primary"]');
    const optional=document.querySelector('[data-testid="publisher-person-attention"]');
    return Boolean(first&&optional&&
      first.compareDocumentPosition(optional)&Node.DOCUMENT_POSITION_FOLLOWING);
  }),true,'Main corporate route must precede optional PERSON attention');
  checks.push('publisher-home-prioritizes-corporate-admin-center-license-and-zero-real-seats');

  assert.equal(await page.locator('.publisher-app .inspector').count(),0,
    'Legacy duplicate read-only inspector is replaced by a contextual dock');
  const dashboard=page.getByTestId('publisher-dashboard');
  await dashboard.waitFor();
  assert.equal(await dashboard.locator('[data-widget-id]').count(),9);
  assert.equal(await page.locator('.publisher-app .breadcrumb').count(),0);
  assert.equal(await page.locator('.publisher-section-eyebrow').count(),0);
  assert.equal(await page.locator('.publisher-version').count(),0);
  assert.equal(await page.getByText('Плотность интерфейса',{exact:true}).count(),0);
  assert.equal(await page.getByTestId('publisher-split-dock').count(),0);
  await page.getByTestId('publisher-dashboard-edit').click();
  assert.equal(await dashboard.locator('.pub-widget.editing').count(),9);
  // Arrow-key reorder works independently from mouse drag and persists.
  await dashboard.getByRole('button',{name:'Позже Лицензия организации'}).click();
  assert.equal(await dashboard.locator('[data-widget-id]').first().getAttribute('data-widget-id'),'person');
  await dashboard.getByRole('button',{name:'Ширина Продукты'}).click();
  assert.equal(await dashboard.locator('[data-widget-id="products"]').evaluate(el=>el.classList.contains('wide')),true);
  await page.getByTestId('publisher-dashboard-library').click();
  const sidecar=page.getByTestId('publisher-split-dock');
  await sidecar.waitFor();
  const library=page.getByTestId('publisher-widget-library');
  assert.equal(await library.locator('.pub-library-entry').count(),14);
  await library.getByRole('button',{name:'Добавить виджет Диагностика'}).click();
  assert.equal(await dashboard.locator('[data-widget-id="diagnostics"]').count(),1);
  const splitter=page.getByTestId('publisher-splitter');
  const widthBefore=Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  await splitter.press('ArrowLeft');
  const widthAfter=Number(await splitter.getAttribute('aria-valuenow'));
  assert.ok(widthAfter>widthBefore,'Keyboard splitter must resize dock');
  const geometry=await page.evaluate(()=>{
    const main=document.querySelector('.publisher-app .main').getBoundingClientRect();
    const dock=document.querySelector('[data-testid="publisher-split-dock"]').getBoundingClientRect();
    return {mainRight:main.right,dockLeft:dock.left,mainWidth:main.width,dockWidth:dock.width};
  });
  assert.ok(geometry.mainRight<=geometry.dockLeft+2&&geometry.mainWidth>250,
    'Dock must share a plane with main without covering the working form');
  const settingsSaved=JSON.parse(await page.evaluate(()=>
    localStorage.getItem('iwxa.publisher.ui.v2')));
  assert.equal(settingsSaved.widgets.length,10);
  assert.equal(settingsSaved.widgets[0].id,'person');
  assert.ok(settingsSaved.widgets.some(w=>w.id==='products'&&w.wide));
  assert.ok(!JSON.stringify(settingsSaved).includes('license:')&&
    !JSON.stringify(settingsSaved).includes('org:'),
    'UI-only settings must not persist business or entitlement data');
  await page.getByTestId('publisher-dock-close').click();
  await page.getByTestId('publisher-dashboard-edit').click();
  await page.reload();
  await page.getByTestId('publisher-dashboard').waitFor();
  assert.equal(await page.getByTestId('publisher-dashboard')
    .locator('[data-widget-id]').first().getAttribute('data-widget-id'),'person');
  assert.equal(await page.getByTestId('publisher-dashboard')
    .locator('[data-widget-id="diagnostics"]').count(),1);
  await page.getByTestId('publisher-dashboard-reset').click();
  assert.equal(await page.getByTestId('publisher-dashboard').locator('[data-widget-id]').count(),9);
  checks.push('v2-real-draggable-dashboard-add-remove-reorder-width-persistence-with-no-business-storage');
  checks.push('v2-side-by-side-dock-keyboard-resize-no-center-overlay-no-breadcrumb-version-or-density');
  assert.equal(await page.getByText('Действительные лицензии',{exact:true}).count(),0,
    'Local unsigned preparations cannot assert that original T3 has issued no licenses');
  checks.push('empty-owner-first-run-no-synthetic-license');
  checks.push('publisher-overview-reports-original-T3-as-license-owner');
  await page.setViewportSize({width:1024,height:640});
  assert.equal(await page.locator('.publisher-app .sidebar .nav-link').count(),8);
  assert.ok(await page.getByRole('button',{name:'Продукты',exact:true}).isVisible());
  assert.ok(await page.getByRole('button',{name:'Настройки',exact:true}).isVisible());
  checks.push('compact-desktop-icon-navigation-remains-accessible-without-duplicate-controls');
  // The native 680px window can be constrained further by Windows taskbars
  // and display scaling. Its whole navigation and footer must fit together.
  await page.setViewportSize({width:1024,height:520});
  const compactSidebar=await page.locator('.publisher-app .sidebar').evaluate(el=>{
    const viewport=el.getBoundingClientRect();
    const nav=el.querySelectorAll('.nav-link');
    if(nav.length!==8)return false;
    const last=nav[nav.length-1].getBoundingClientRect();
    return last.top>=viewport.top&&last.bottom<=viewport.bottom&&el.scrollTop===0;
  });
  assert.ok(compactSidebar,'At 520px height both the final navigation section and footer must be visible without sidebar scrolling');
  checks.push('compact-height-native-sidebar-all-sections-and-footer-visible');
  checks.push('compact-height-native-footer-clears-windows-taskbar-safe-inset');
  await page.setViewportSize({width:1366,height:900});
  await page.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  await page.getByTestId('publisher-age-exchange').waitFor();
  await page.getByTestId('publisher-t3-export-age').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-export-age').isEnabled(),false);
  assert.equal(await page.getByTestId('publisher-t3-export-test-trust').isEnabled(),true);
  await page.getByTestId('publisher-t3-export-test-trust').click();
  await page.getByTestId('publisher-t3-public-trust-fingerprint').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-public-trust-fingerprint').inputValue(),'c'.repeat(64));
  assert.match(await page.getByTestId('publisher-test-public-trust').innerText(),/SHA-256/);
  checks.push('original-T3-public-trust-export-returns-independent-fingerprint-not-license-grant');
  // The independently provisioned production PERSON owner is unavailable in
  // this TEST-only fake host. Its export controls must be ABSENT, not a
  // disabled control belonging to the unrelated TEST publisher.
  await page.getByTestId('publisher-person-owner-unavailable').waitFor();
  assert.equal(await page.getByTestId('publisher-person-export-age').count(),0);
  await page.getByTestId('publisher-age-recipients').fill('age1'+'q'.repeat(58));
  await page.getByTestId('publisher-age-encrypt').click();
  await page.getByTestId('publisher-age-success').waitFor();
  assert.match(await page.getByTestId('publisher-age-success').innerText(),/Доставка получателю не подтверждена/);
  await page.getByTestId('publisher-age-decrypt').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="publisher-age-success"]')
    ?.textContent?.includes('отдельно проверены T3')===true);
  checks.push('age-native-transport-ui-does-not-claim-licensing-or-delivery');
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
  await page.getByRole('button',{name:'Обзор',exact:true}).click();

  const mark=page.locator('.publisher-brand-logo');
  assert.equal(await mark.getAttribute('src'),'/favicon.svg');
  assert.equal(await mark.getAttribute('alt'),'IWXA');
  assert.equal(await page.locator('.publisher-version').count(),0,
    'Publisher version must not be shown outside Settings');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  assert.match(await page.getByTestId('publisher-settings').innerText(),/Версия программы/);
  assert.match(await page.getByTestId('publisher-settings').innerText(),/0.5.0-dev.1/);
  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  checks.push('publisher-version-is-settings-only-native-setup-identity');
  const brandSvg=await (await page.request.get('http://127.0.0.1:4175/favicon.svg')).text();
  assert.match(brandSvg,/fill="#FFFFFF"/);
  assert.match(brandSvg,/fill="#05070D"/);
  assert.match(brandSvg,/M29 14 L51 50 M51 14 L29 50/);
  assert.ok(!brandSvg.includes('#B6F24B'),'Publisher still uses Agent green background');
  const logoStyle=await mark.evaluate(el=>({w:el.getBoundingClientRect().width,loaded:el.complete&&el.naturalWidth>0}));
  assert.ok(logoStyle.loaded&&logoStyle.w>=36,'Publisher mark not rendered in agent shell');
  assert.equal(await page.locator('nav[aria-label="Разделы Publisher"] .nav-link svg').count(),8);
  checks.push('agent-exact-ix-glyph-white-logo-and-eight-vector-navigation-icons');
  assert.equal(await page.getByRole('button',{name:'Сохранить копию черновиков'}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Восстановить черновики'}).isEnabled(),true);
  assert.match(await page.getByTestId('publisher-preparation-backup').innerText(),/ключей издателя в копии нет/);
  checks.push('backup-bound-to-test-only-native-ipc-without-issuer-keys');
  await page.getByRole('button',{name:'Проверить программу'}).click();
  const diagnostics=page.getByTestId('publisher-diagnostics-result');
  await diagnostics.waitFor();
  assert.match(await diagnostics.innerText(),/IWXA Publisher · нативный запуск подтверждён/);
  assert.match(await diagnostics.innerText(),/Черновики: читаются/);
  assert.match(await diagnostics.innerText(),/проверки, восстановления или удаления/);
  const diag=JSON.parse(await page.getByRole('textbox',{name:'Сведения диагностики'}).inputValue());
  assert.equal(diag.schema,'IWXA_DIAGNOSTICS/1');
  assert.equal(diag.setupCore,'CHECK_IN_SETUP_CORE');
  assert.equal(diag.licensing,'TEST_AND_PERSON_T3_BRIDGE');
  assert.match(await diagnostics.innerText(),/TEST и PERSON через оригинальный T3/);
  assert.match(await diagnostics.innerText(),/Наличие подписанта, выдача лицензий и права получателя проверяются отдельно/);
  assert.doesNotMatch(await diagnostics.innerText(),/только TEST/);
  checks.push('native-diagnostics-describes-person-bridge-without-claiming-signing-or-rights');
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
        schema:'IWXA_DIAGNOSTICS/1',productId:'iwxa.publisher',version:'0.5.0-dev.1',
        application:'NATIVE_RUNNING',localPreparation:'NEEDS_ATTENTION',
        webviewProfile:'FOLDER_PRESENT',setupCore:'CHECK_IN_SETUP_CORE',
        licensing:'TEST_AND_PERSON_T3_BRIDGE',activeSeats:0,productionActivation:false,
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
  assert.match(await degradedReport.innerText(),/TEST и PERSON через оригинальный T3/);
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
  await page.getByRole('button',{name:'Клиенты',exact:true}).click();
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

  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
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
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
  await page.getByText('Подготовленные запросы (1)').waitFor();
  checks.push('tariff-proposal-unsigned-snapshot');
  const corporateReview=page.getByTestId('publisher-corporate-offer-reviews');
  await corporateReview.waitFor();
  assert.match(await corporateReview.innerText(),/Test Corporation/);
  assert.match(await corporateReview.innerText(),/Тариф: Команда \(TEAM\)/);
  assert.match(await corporateReview.innerText(),/Места Admin Center в подготовке: 5/);
  assert.match(await corporateReview.innerText(),/Лимит сотрудников: 10/);
  assert.match(await corporateReview.innerText(),/Мест Personal Agent к назначению: 0/);
  assert.match(await corporateReview.innerText(),/Число сотрудников не является числом лицензий агента/);
  assert.match(await corporateReview.innerText(),/Получение Admin Center не подтверждено/);
  checks.push('corporate-offer-keeps-tariff-source-and-does-not-invent-agent-seat-entitlement');
  const corporateRequestButton=corporateReview.getByTestId('publisher-export-corporate-request');
  assert.equal(await corporateRequestButton.isDisabled(),true,
    'A corporate employee seat count must be explicitly entered');
  await corporateReview.getByTestId('publisher-corporate-agent-seats').fill('0');
  await corporateRequestButton.click();
  const corporateRequest=JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-corporate-unsigned-request')));
  assert.equal(corporateRequest.schema,'IWXA_T3_CORPORATE_LICENSE_REQUEST/1');
  assert.equal(corporateRequest.kind,'CORPORATE_LICENSE_REQUEST');
  assert.equal(corporateRequest.environment,'PRODUCTION');
  assert.equal(corporateRequest.subject.id,'11111111-1111-4111-8111-111111111111');
  assert.equal(corporateRequest.tariff.id,'TEAM');
  assert.equal(corporateRequest.tariff.revision,1);
  assert.equal(corporateRequest.limits.adminCenterSeats,5);
  assert.equal(corporateRequest.limits.employeeLimit,10);
  assert.equal(corporateRequest.limits.personalAgentSeats,0);
  assert.equal(corporateRequest.status,'UNSIGNED_REQUEST');
  assert.equal(Object.hasOwn(corporateRequest,'signature'),false);
  checks.push('native-corporate-request-export-exact-unsigned-t3-profile-no-agent-authority');

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
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
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
  await page.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  const corp=page.getByTestId('publisher-corporate-native-owner');
  await corp.waitFor();
  assert.match(await corp.innerText(),
    /Коммерческих мест без независимого приёма в Admin Center: 0/);
  assert.equal(await corp.getByTestId('publisher-corporate-native-issue').count(),0);
  await corp.getByTestId('publisher-corporate-owner-check').click();
  await corp.getByRole('alert').waitFor();
  assert.match(await corp.getByRole('alert').innerText(),/NOT_ENROLLED/);
  assert.equal(await page.evaluate(()=>window.__publisherMockCorporateSignCount||0),0);
  checks.push('corporate-owner-not-enrolled-no-signing-and-no-fake-entitlement');
  // UI-only qualified-host mock; real Ed25519 is checked in the One Core CI.
  await page.evaluate(()=>{window.__publisherMockCorporateEnrolled=true;});
  await corp.getByTestId('publisher-corporate-owner-check').click();
  await corp.getByLabel('Подготовленное предложение организации').selectOption({index:1});
  await corp.getByTestId('publisher-corporate-native-seats').fill('0');
  await corp.getByRole('button',{name:'Проверить условия перед подписью'}).click();
  await corp.getByTestId('publisher-corporate-signing-preview').waitFor();
  assert.equal(await corp.getByTestId('publisher-corporate-native-issue').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.__publisherMockCorporateSignCount||0),0);
  await corp.getByRole('checkbox',{name:'Подтверждаю выдачу организации по этим условиям'}).check();
  await corp.getByTestId('publisher-corporate-native-issue').click();
  await corp.getByTestId('publisher-corporate-native-readback').waitFor();
  assert.match(await corp.getByTestId('publisher-corporate-native-readback').innerText(),
    /Подписано издателем T3, не принято получателем/);
  assert.match(await corp.getByTestId('publisher-corporate-native-readback').innerText(),
    /Назначаемых мест: 0/);
  assert.equal(await page.evaluate(()=>window.__publisherMockCorporateSignCount||0),1);
  checks.push('corporate-owner-ui-human-consent-cold-signed-readback-no-recipient-grant');
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
  const issuerExplanation=await page.locator('main').innerText();
  assert.match(issuerExplanation,/TEST-подпись доступна только через ранее зарегистрированного владельца/);
  assert.match(issuerExplanation,/Действие лицензии подтверждается установленным продуктом/);
  assert.doesNotMatch(issuerExplanation,/подпись издателя не подключена/);
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
  assert.equal(await page.getByTestId('publisher-t3-export').isDisabled(),true,
    'Unsigned TEST status cannot be delivered as an active signed license');
  assert.equal(await page.getByTestId('publisher-t3-export-age').isDisabled(),true);
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true,
    'Status change must require a new explicit status choice');
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('ACTIVE');
  await page.getByTestId('publisher-t3-change-status').click();
  await page.getByText('Новый подписанный TEST-статус сохранён в T3: ACTIVE').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
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
  // A delivery key belongs to the selected license, not to the whole form.
  await page.getByTestId('publisher-t3-age-recipients').fill('age1'+'q'.repeat(58));
  await ownerPanel.getByRole('combobox',{name:'Лицензия',exact:true})
    .selectOption('license:test:native-ui:two');
  assert.equal(await page.getByTestId('publisher-t3-age-recipients').inputValue(),'',
    'Changing the organization license must clear the previous age recipient');
  assert.equal(await page.getByTestId('publisher-t3-export-age').isDisabled(),true);
  checks.push('test-age-recipient-is-scoped-to-selected-organization');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('iwxa-publisher-test-native-draft')),
    draftsBefore,'Admin request must not mutate local Publisher drafts');
  checks.push('admin-unsigned-request-signing-through-original-T3-owner');
  // The old signed request is no longer in the short recent list, but the
  // ORIGINAL owner returns ALREADY_ISSUED. Exact native readback must
  // recover its real ID and prevent a second signed issue.
  await page.evaluate(()=>{
    window.__publisherMockRecentCap=1;
    window.__publisherMockNextAlreadyIssued=true;
  });
  await page.getByTestId('publisher-t3-refresh').click();
  await page.getByText('Журнал T3 обновлён. Подписи и права не изменены.').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-issue').isEnabled(),true);
  await page.getByTestId('publisher-t3-issue').click();
  await ownerPanel.getByText('Ранее выпущенная TEST-лицензия найдена в журнале T3.').waitFor();
  assert.equal(await page.getByTestId('publisher-t3-issue').isDisabled(),true);
  assert.equal(JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('publisher-t3-mock-licenses'))).length,2);
  checks.push('old-test-already-issued-recovers-with-exact-owner-lookup');
  // The ORIGINAL T3 exposes a bounded exact lookup for any historical
  // signed TEST record. The Publisher must find, select and export it even
  // when it is no longer in the recent native inventory window.
  const historicalTest={...externalLedger[0],
    licenseId:'license:test:historical:42',requestId:'request:archived:42',
    organizationId:'org:archived:42',status:'ACTIVE',sequence:3};
  const historicalOther={...historicalTest,
    licenseId:'license:test:historical:43',requestId:'request:archived:43'};
  await page.evaluate(records=>{
    const existing=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
    existing.unshift(...records);
    sessionStorage.setItem('publisher-t3-mock-licenses',JSON.stringify(existing));
    window.__publisherMockRecentCap=2;
  },[historicalTest,historicalOther]);
  await page.getByTestId('publisher-t3-refresh').click();
  await page.getByText('Журнал T3 обновлён. Подписи и права не изменены.').waitFor();
  const historicalLicenseChoice=ownerPanel.getByRole('combobox',{name:'Лицензия',exact:true});
  assert.equal(await historicalLicenseChoice.locator('option[value="license:test:historical:42"]').count(),0,
    'The historical signed TEST record must not be in the last-two native view');
  await page.getByTestId('publisher-t3-lookup-input').fill(historicalTest.requestId);
  await page.getByTestId('publisher-t3-lookup').click();
  await ownerPanel.getByText('Поиск в исходном T3: найдено записей 1.').waitFor();
  assert.equal(await historicalLicenseChoice.inputValue(),historicalTest.licenseId);
  assert.equal(await page.getByTestId('publisher-t3-export').isEnabled(),true);
  await page.getByTestId('publisher-t3-export').click();
  await page.getByText('Пакет .iwxa выпущен T3 и подтверждён повторным чтением.').waitFor();
  assert.equal(await historicalLicenseChoice.inputValue(),historicalTest.licenseId,
    'Export readback must keep the exact historical signed record selected');
  await ownerPanel.getByRole('combobox',{name:'Новый TEST-статус'}).selectOption('SUSPENDED');
  await page.getByTestId('publisher-t3-change-status').click();
  await page.getByText('Новый подписанный TEST-статус сохранён в T3: SUSPENDED').waitFor();
  assert.equal(await historicalLicenseChoice.inputValue(),historicalTest.licenseId,
    'Original T3 status readback must keep the historical record selected');
  const historicalReadback=JSON.parse(await page.evaluate(()=>
    sessionStorage.getItem('publisher-t3-mock-licenses')))
    .find(x=>x.licenseId===historicalTest.licenseId);
  assert.equal(historicalReadback.status,'SUSPENDED');
  assert.equal(historicalReadback.sequence,historicalTest.sequence+1);
  checks.push('test-original-T3-exact-old-license-readback-export-and-signed-status');
  await page.getByTestId('publisher-t3-lookup-input').fill(historicalTest.organizationId);
  await page.getByTestId('publisher-t3-lookup').click();
  await ownerPanel.getByText('Поиск в исходном T3: найдено записей 2.').waitFor();
  assert.equal(await historicalLicenseChoice.inputValue(),'',
    'Ambiguous organization lookup must never auto-select a signed license');
  assert.equal(await page.getByTestId('publisher-t3-change-status').isDisabled(),true);
  checks.push('multiple-old-test-licenses-require-explicit-recipient-selection');
  await page.evaluate(records=>{
    const ids=new Set(records.map(x=>x.licenseId));
    const entries=JSON.parse(sessionStorage.getItem('publisher-t3-mock-licenses')||'[]');
    sessionStorage.setItem('publisher-t3-mock-licenses',
      JSON.stringify(entries.filter(x=>!ids.has(x.licenseId))));
    window.__publisherMockRecentCap=null;
  },[historicalTest,historicalOther]);
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();

  await page.reload();
  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
  assert.equal(await page.getByTestId('publisher-test-simulation-result').count(),0,'simulation was incorrectly persisted');
  await page.getByText('Подготовленные запросы (2)').waitFor();
  assert.match(await page.locator('main').innerText(),/Test Corporation/);
  checks.push('same-origin-restart-persistence');

  await page.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  assert.match(await page.locator('main').innerText(),/TEST-подпись доступна только через ранее зарегистрированного владельца/);
  await page.getByRole('button',{name:'Релизы',exact:true}).click();
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
  assert.equal(await page.getByRole('button',{name:'Обзор',exact:true}).isVisible(),true,
    'V2 icon rail remains available at 700px without the old overlay menu');

  await page.getByRole('button',{name:'Обзор',exact:true}).click();
  const dimensions=await page.evaluate(()=>({viewport:window.innerWidth,body:document.body.scrollWidth,doc:document.documentElement.scrollWidth}));
  assert.ok(dimensions.body<=dimensions.viewport && dimensions.doc<=dimensions.viewport,JSON.stringify(dimensions));
  checks.push('compact-desktop-navigation-no-horizontal-overflow');

  await page.getByRole('button',{name:'Лицензии',exact:true}).click();
  const requestWidth=await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth));
  assert.ok(requestWidth<=700,'TEST request interface overflows desktop minimum 700px: '+requestWidth);
  checks.push('compact-desktop-test-license-request-no-horizontal-overflow');

  await page.getByRole('button',{name:'Обзор',exact:true}).click();


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
  // A second Publisher process must not silently replace a draft edited by
  // another process while this window was open. Reopen the actual source
  // snapshot before any later PERSON signature or tariff edit.
  const parallel=await browser.newPage({viewport:{width:1100,height:720}});
  parallel.on('pageerror',e=>errors.push('parallel draft: '+e.message));
  await parallel.addInitScript(()=>{
    const name='publisher-parallel-preparation';
    const hash=async raw=>{
      if(raw===null)return 'ABSENT';
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
    };
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==='publisher_draft_read')return sessionStorage.getItem(name);
      if(command==='publisher_draft_save'){
        if(window.__parallelMockOtherWriterBusyOnce){
          window.__parallelMockOtherWriterBusyOnce=false;
          throw Error('PUBLISHER_DRAFT_BUSY_OTHER_INSTANCE');
        }
        const current=sessionStorage.getItem(name);
        if(args.expectedSha256!==await hash(current))
          throw Error('PUBLISHER_DRAFT_CHANGED_ON_DISK');
        sessionStorage.setItem(name,args.content);
        return true;
      }
      throw Error('UNEXPECTED_PARALLEL_DRAFT_IPC:'+command);
    }};
  });
  await parallel.goto('http://127.0.0.1:4175');
  await parallel.getByRole('button',{name:'Продукты',exact:true}).click();
  await parallel.getByLabel('Идентификатор продукта').fill('IWXA_ATLAS');
  await parallel.getByLabel('Название').fill('Original Draft Product');
  await parallel.getByLabel('Версия',{exact:true}).fill('0.5.0');
  await parallel.getByRole('button',{name:'Сохранить продукт'}).click();
  await parallel.getByText('Продукты (1)').waitFor();
  // Simulate only a real external file change, not a second signer or Store.
  const savedAfterExternalChange=await parallel.evaluate(()=>{
    const key='publisher-parallel-preparation';
    const draft=JSON.parse(sessionStorage.getItem(key));
    draft.products[0].name='Updated by Other Publisher Window';
    const next=JSON.stringify(draft);
    sessionStorage.setItem(key,next);
    return next;
  });
  await parallel.getByLabel('Идентификатор продукта').fill('IWXA_PERSONAL_AGENT');
  await parallel.getByLabel('Название').fill('Needs Fresh Draft');
  await parallel.getByLabel('Версия',{exact:true}).fill('0.5.0');
  await parallel.getByRole('button',{name:'Сохранить продукт'}).click();
  await parallel.getByTestId('publisher-draft-reload').waitFor();
  assert.equal(await parallel.evaluate(()=>sessionStorage.getItem('publisher-parallel-preparation')),
    savedAfterExternalChange,'Stale native save overwrote another Publisher');
  assert.equal(await parallel.getByRole('button',{name:'Сохранить продукт'}).count(),0,
    'Stale draft must not expose editing controls');
  await parallel.getByTestId('publisher-draft-reload').click();
  await parallel.getByText('Updated by Other Publisher Window').waitFor();
  await parallel.getByRole('button',{name:'Сохранить продукт'}).click();
  await parallel.getByText('Продукты (2)').waitFor();
  assert.equal(JSON.parse(await parallel.evaluate(()=>
    sessionStorage.getItem('publisher-parallel-preparation'))).products.length,2);
  // A Windows writer handle is exclusive even when both app instances
  // last read the same hash. Reject the losing save without changes,
  // then allow a deliberate reload and normal retry.
  const beforeBusySave=await parallel.evaluate(()=>
    sessionStorage.getItem('publisher-parallel-preparation'));
  await parallel.evaluate(()=>{window.__parallelMockOtherWriterBusyOnce=true;});
  await parallel.getByLabel('Идентификатор продукта').fill('IWXA_ADMIN_CENTER');
  await parallel.getByLabel('Название').fill('Publisher Busy Recovery');
  await parallel.getByLabel('Версия',{exact:true}).fill('0.5.0');
  await parallel.getByRole('button',{name:'Сохранить продукт'}).click();
  await parallel.getByTestId('publisher-draft-reload').waitFor();
  assert.equal(await parallel.evaluate(()=>
    sessionStorage.getItem('publisher-parallel-preparation')),
    beforeBusySave,'The losing native save modified the current disk snapshot');
  await parallel.getByTestId('publisher-draft-reload').click();
  await parallel.getByText('Актуальные черновики перечитаны',{exact:false}).waitFor();
  await parallel.getByRole('button',{name:'Сохранить продукт'}).click();
  await parallel.getByText('Продукты (3)').waitFor();
  await parallel.close();
  checks.push('native-draft-external-edit-refuses-overwrite-and-reloads-before-next-save');
  checks.push('windows-second-publisher-writer-busy-reload-and-retry');
  // Independent direct-to-product personal flow, using a bounded IPC test double.
  // It cannot claim that a PERSON license was signed by T3.
  const personal=await browser.newPage({viewport:{width:1050,height:820}});
  personal.on('pageerror',e=>errors.push('personal fixture: '+e.message));
  await personal.addInitScript(()=>{
    // Original T3 core canonical SHA-256, with mocked signatures/records.
    const canonical=value=>value===null||typeof value!=='object'?
      JSON.stringify(value):Array.isArray(value)?
      '['+value.map(canonical).join(',')+']':
      '{'+Object.keys(value).sort().map(k=>
        JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    const requestDigest=async request=>{
      const bytes=new TextEncoder().encode(canonical(request));
      const hash=await crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(hash),v=>
        v.toString(16).padStart(2,'0')).join('');
    };
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
      if(command==='publisher_pick_preparation_backup')return window.__personMockRestoreContent??null;
      if(command==='publisher_t3_capabilities')return {operation:'TEST_CAPABILITIES',issuers:['test:owner'],activeSeats:0,productionActivation:false,commercialAuthorityProven:false};
      if(command==='publisher_t3_inventory')return {operation:'TEST_INVENTORY',licenses:[],activeSeats:0,productionActivation:false};
      if(command==='publisher_t3_person_capabilities'){
        if(!window.__personNativeEnabled)throw Error('PERSON_OWNER_NOT_ENROLLED');
        return {operation:'PERSON_CAPABILITIES',environment:'PRODUCTION',
          issuers:['publisher:person:mock','publisher:person:alternate'],
          statusSequenceCas:!window.__personMockLegacyStatusCas,
          exportSequenceCas:!window.__personMockLegacyExportCas,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_inventory'){
        window.__personMockInventoryCalls=(window.__personMockInventoryCalls||0)+1;
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
      if(command==='publisher_t3_person_signed_readback'){
        window.__personMockSignedReadbackCalls=(window.__personMockSignedReadbackCalls||0)+1;
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const rec=ledger.find(x=>x.licenseId===args.licenseId);
        if(!rec)throw Error('PERSON_OWNER_READBACK_UNIQUE_SIGNED_LICENSE_REQUIRED');
        const signedProof={operation:'PERSON_SIGNED_READBACK',source:'ORIGINAL_T3_OWNER_STORE',
          licenseId:rec.licenseId,requestId:rec.requestId,
          issuerAuthorityId:rec.issuerAuthorityId,personId:rec.personId,
          productId:rec.productId,productVersion:'0.5.0',
          licenseKeyId:'publisher:mock:license:key',
          licenseEnvelopeSha256:'a'.repeat(64),
          licenseSignatureVerifiedAtIssuance:true,
          statusKeyId:rec.sequence?'publisher:mock:status:key':null,
          statusEnvelopeSha256:rec.sequence?'b'.repeat(64):null,
          statusSignatureVerifiedAtIssuance:rec.sequence>0,
          statusFloorVerified:rec.sequence>0,status:rec.status,
          sequence:rec.sequence,statusIssuedAt:rec.statusIssuedAt??null,
          statusValidUntil:rec.statusValidUntil??null,
          stateRevision:rec.sequence+1,ledgerRevision:ledger.length,
          recipientConfirmed:false,activeSeats:0,productionActivation:false};
        if(window.__personMockDivergeSignedReadbackAt===
           window.__personMockSignedReadbackCalls){
          window.__personMockDivergeSignedReadbackAt=null;
          return {...signedProof,statusEnvelopeSha256:'c'.repeat(64)};
        }
        return signedProof;
      }
      if(command==='publisher_t3_person_issue'){
        const latest=sessionStorage.getItem('iwxa-publisher-person-fixture');
        const hash=async raw=>Array.from(new Uint8Array(
          await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),
          byte=>byte.toString(16).padStart(2,'0')).join('');
        if(window.__personMockRaceBeforeNativeIssue){
          window.__personMockRaceBeforeNativeIssue=false;
          const external=JSON.parse(latest);
          external.products[0].name='Other Publisher changed file during IPC';
          sessionStorage.setItem('iwxa-publisher-person-fixture',JSON.stringify(external));
        }
        if(args.expectedDraftSha256!==await hash(
          sessionStorage.getItem('iwxa-publisher-person-fixture')))
          throw Error('PUBLISHER_DRAFT_CHANGED_ON_DISK');
        if(window.__personMockBusyBeforeOwner){
          // The existing Windows lock denied the request before the T3 signer.
          window.__personMockBusyBeforeOwner=false;
          throw Error('PUBLISHER_DRAFT_BUSY_OTHER_INSTANCE');
        }
        if(window.__personMockMismatchBeforeOwner){
          // A matching draft digest is insufficient if the request differs
          // from the actual reviewed tariff/subject at the native boundary.
          window.__personMockMismatchBeforeOwner=false;
          throw Error('PUBLISHER_PERSON_REQUEST_DRAFT_MISMATCH');
        }
        if(window.__personMockNoDraftBeforeOwner){
          window.__personMockNoDraftBeforeOwner=false;
          throw Error('PUBLISHER_PERSON_DRAFT_SOURCE_UNAVAILABLE');
        }
        window.__personMockIssueCalls=(window.__personMockIssueCalls||0)+1;
        const r=JSON.parse(args.requestJson);
        window.assertPersonRequest(r,args.issuerAuthorityId);
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const unsignedDigest=await requestDigest(r);
        const issued=ledger.find(e=>e.requestId===r.requestId);
        if(issued&&issued.requestDigest!==unsignedDigest)
          throw Error('PERSON_ISSUE_REQUEST_CONFLICT');
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
          requestDigest:unsignedDigest,issuedAt,notBefore:issuedAt,
          expiresAt:new Date(Date.parse(issuedAt)+r.termDays*86400000).toISOString(),
          status:'NOT_ACTIVATED',sequence:0,activeSeats:0};
        ledger.push(one);
        sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
        if(window.__personMockLoseNextIssueReceipt){
          // Signed Owner durable issuance occurred; its IPC answer did not.
          // Do NOT simulate a second issuance during publisher recovery.
          window.__personMockLoseNextIssueReceipt=false;
          throw Error('PERSON_TEST_ISSUE_ACK_LOST_AFTER_DURABLE_COMMIT');
        }
        return {operation:'PERSON_ISSUE',outcome:'ISSUED_NEW',
          licenseId:one.licenseId,requestId:r.requestId,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_change_status'){
        window.__personMockStatusCalls=(window.__personMockStatusCalls||0)+1;
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const one=ledger.find(e=>e.licenseId===args.licenseId);
        if(!one||one.status==='REVOKED')throw Error('PERSON_OWNER_REVOKED_TERMINAL');
        // Exact lookups can race another original signed status writer.
        if(window.__personMockRaceNextStatus){
          window.__personMockRaceNextStatus=false;
          one.status='SUSPENDED';one.sequence+=1;
          one.statusIssuedAt=new Date().toISOString();
          one.statusValidUntil=new Date(Math.min(
            Date.now()+24*3600000,Date.parse(one.expiresAt))).toISOString();
          sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
        }
        if(args.expectedSequence!==one.sequence)
          throw Error('PERSON_OWNER_STATUS_SEQUENCE_STALE');
        if(window.__personMockLoseBeforeStatusCommit){
          window.__personMockLoseBeforeStatusCommit=false;
          throw Error('PERSON_TEST_ACK_LOST_BEFORE_COMMIT');
        }
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
          expectedSequence:args.expectedSequence,
          activeSeats:0,productionActivation:false};
      }
      if(command==='publisher_t3_person_export_public_trust')return {
        operation:'PERSON_TRUST_EXPORTED',publicOnly:true,bytes:850,
        sha256:'d'.repeat(64),keyCount:2,issuerCount:1,
        activeSeats:0,productionActivation:false};
      if(command==='publisher_t3_person_export'){
        const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger')||'[]');
        const one=ledger.find(x=>x.licenseId===args.licenseId);
        window.__personMockExportCalls=(window.__personMockExportCalls||0)+1;
        if(!one)throw Error('PERSON_OWNER_LICENSE_NOT_ISSUED');
        if(window.__personMockRaceNextExport){
          window.__personMockRaceNextExport=false;
          one.sequence+=1;one.status='SUSPENDED';
          one.statusIssuedAt=new Date().toISOString();
          one.statusValidUntil=new Date(Math.min(
            Date.now()+24*3600000,Date.parse(one.expiresAt))).toISOString();
          sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
        }
        if(one.sequence!==args.expectedSequence)
          throw Error('PERSON_OWNER_EXPORT_SEQUENCE_STALE');
        return {operation:'PERSON_IWXA_EXPORTED',licenseId:args.licenseId,
          expectedSequence:args.expectedSequence,
          bytes:1024,packageSha256:'c'.repeat(64),
          activeSeats:0,productionActivation:false};
      }
      throw new Error('Unexpected personal fixture IPC '+command);
    }};
  });
  await personal.goto('http://127.0.0.1:4175');
  // The landing view reads no owner ledger without a deliberate request.
  await personal.getByTestId('publisher-person-attention-check').waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockInventoryCalls||0),0);
  await personal.getByTestId('publisher-person-attention-check').click();
  await personal.getByTestId('publisher-person-attention-result').waitFor();
  assert.match(await personal.getByTestId('publisher-person-attention-result').innerText(),
    /Подтверждено записей издателя: 0 из 0/);
  assert.match(await personal.getByTestId('publisher-person-attention-result').innerText(),
    /Получение лицензий клиентами не проверялось/);
  assert.equal(await personal.evaluate(()=>window.__personMockInventoryCalls||0),1);
  // An unavailable owner ledger is never represented as zero attention.
  await personal.evaluate(()=>{window.__personMockFailNextInventory=true;});
  await personal.getByTestId('publisher-person-attention-check').click();
  await personal.getByTestId('publisher-person-attention-error').waitFor();
  assert.equal(await personal.getByTestId('publisher-person-attention-result').count(),0);
  checks.push('person-overview-reads-original-owner-on-demand-and-fails-closed');
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
  assert.equal(await personal.getByRole('button',{name:'Подготовить TEST-запрос'}).count(),0,
    'PERSON license must not expose unsupported TEST issuance actions');
  assert.equal(await personal.getByRole('button',{name:'Моделировать TEST-ответ'}).count(),0);
  assert.equal(await personal.getByLabel('Места для TEST-запроса').count(),0);
  assert.equal(await personal.getByTestId('publisher-person-open-in-owner').count(),1);
  checks.push('personal-license-page-shows-only-supported-original-T3-person-actions');
  await personal.reload();
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByText('Подготовленные запросы (1)').waitFor();
  assert.match(await personal.locator('main').innerText(),/Напрямую в продукт/);
  assert.equal(await personal.getByTestId('publisher-person-proposal-reference').innerText(),
    'ID запроса: '+directDraft.proposals[0].id);
  await personal.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  await personal.getByTestId('publisher-person-issuer-unavailable').waitFor();
  assert.equal(await personal.getByTestId('publisher-t3-issue').isDisabled(),true);
  assert.equal(await personal.getByRole('combobox',{name:'Подготовленный запрос'}).locator('option:not([value=""])').count(),0);
  checks.push('personal-test-issuer-unavailable-even-with-active-original-owner');

  // Explicit pre-enrollment does not make an outdated native T3 owner safe
  // for a Publisher that requires original sequence compare-and-commit.
  await personal.evaluate(()=>{
    window.__personNativeEnabled=true;
    window.__personMockLegacyStatusCas=true;
  });
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  const personOwner=personal.getByTestId('publisher-person-owner');
  await personOwner.getByTestId('publisher-person-owner-unavailable').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-owner-unavailable').innerText(),
    /Обновите компонент T3 в Publisher/);
  assert.equal(await personOwner.getByTestId('publisher-person-issue').count(),0);
  checks.push('person-outdated-original-owner-shows-upgrade-requirement-not-fake-unenrollment');
  // An intermediate Owner supports STATUS CAS but still ignores the export
  // sequence argument. Reject it BEFORE showing native export controls.
  await personal.evaluate(()=>{
    window.__personMockLegacyStatusCas=false;
    window.__personMockLegacyExportCas=true;
  });
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
  await personal.getByTestId('publisher-person-owner-unavailable').waitFor();
  assert.match(await personal.getByTestId('publisher-person-owner-unavailable').innerText(),
    /экспортируемых пакетов/);
  assert.equal(await personal.getByTestId('publisher-person-export').count(),0);
  checks.push('person-original-owner-export-cas-upgrade-required-before-delivery');
  await personal.evaluate(()=>{
    window.__personMockLegacyExportCas=false;
    window.__personMockFailNextInventory=true;
  });
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.getByRole('button',{name:'Доверие и ключи',exact:true}).click();
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
  const identity=await personOwner.getByTestId('publisher-person-reviewed-identity').innerText();
  assert.match(identity,/Идентификатор получателя:/);
  assert.match(identity,/IWXA_ATLAS/);
  assert.match(identity,/publisher:person:mock/);
  assert.match(identity,/proposal:/);
  const reviewedTariff=await personOwner.getByTestId('publisher-person-reviewed-tariff').innerText();
  assert.match(reviewedTariff,/Подготовленный тариф:/);
  assert.match(reviewedTariff,/редакция 1/);
  assert.match(await personOwner.getByTestId('publisher-person-issue-preview').innerText(),
    /Цена, оплата и коммерческий договор не входят/);
  checks.push('person-issuer-shows-original-receiver-tariff-and-request-before-signer');
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
  // Another Publisher may modify the same preparation file after review.
  // A stale UI must not send even the first irreversible signed request.
  const originalPersonDraft=await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'));
  const beforeStaleDraftIssue=await personal.evaluate(()=>
    window.__personMockIssueCalls||0);
  await personal.evaluate(()=>{
    const key='iwxa-publisher-person-fixture';
    const newer=JSON.parse(sessionStorage.getItem(key));
    newer.products[0].name='Externally updated product';
    sessionStorage.setItem(key,JSON.stringify(newer));
  });
  await personOwner.getByTestId('publisher-person-issue').click();
  await personal.getByTestId('publisher-draft-reload').waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    beforeStaleDraftIssue,
    'Changed local source must not reach original T3 PERSON signing');
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,0);
  await personal.evaluate(prior=>
    sessionStorage.setItem('iwxa-publisher-person-fixture',prior),originalPersonDraft);
  await personal.getByTestId('publisher-draft-reload').click();
  await personOwner.getByTestId('publisher-person-issue').waitFor();
  await personOwner.getByRole('combobox',{name:'Издатель'})
    .selectOption('publisher:person:mock');
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(directDraft.proposals[0].id);
  await personOwner.getByLabel('Подтверждаю выпуск на указанных условиях').check();
  checks.push('person-signing-refuses-stale-local-draft-before-original-t3');
  // The disk may also change AFTER both React checks but at the native
  // command boundary. The Rust bridge must reject it before starting Owner.
  const beforeNativeRace=await personal.evaluate(()=>
    window.__personMockIssueCalls||0);
  await personal.evaluate(()=>{window.__personMockRaceBeforeNativeIssue=true;});
  await personOwner.getByTestId('publisher-person-issue').click();
  await personal.getByTestId('publisher-draft-reload').waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    beforeNativeRace,
    'Native request preflight must not invoke original signer for stale disk source');
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,0);
  await personal.evaluate(prior=>
    sessionStorage.setItem('iwxa-publisher-person-fixture',prior),originalPersonDraft);
  await personal.getByTestId('publisher-draft-reload').click();
  await personOwner.getByTestId('publisher-person-issue').waitFor();
  await personOwner.getByRole('combobox',{name:'Издатель'})
    .selectOption('publisher:person:mock');
  await personOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .selectOption(directDraft.proposals[0].id);
  await personOwner.getByLabel('Подтверждаю выпуск на указанных условиях').check();
  checks.push('person-native-bridge-refuses-draft-race-before-original-signer');
  // The shared Windows lock can be held by another Publisher before signing
  // starts. It is not the ambiguous state of a lost post-commit IPC response.
  const beforeBusyOwner=await personal.evaluate(()=>window.__personMockIssueCalls||0);
  await personal.evaluate(()=>{window.__personMockBusyBeforeOwner=true;});
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Другой экземпляр Publisher использует текущую подготовку.',
    {exact:false}).waitFor();
  assert.match(await personOwner.innerText(),/Подписание исходным T3 в этом окне не запускалось/);
  assert.doesNotMatch(await personOwner.innerText(),/операция могла сохраниться в T3/i);
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),beforeBusyOwner);
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,0);
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isEnabled(),true);
  checks.push('person-existing-writer-lock-busy-definite-no-issue-and-operator-recovery');
  // Native request-to-draft mismatches (and missing draft source) happen
  // before the original signer. They must never be reported as an uncertain
  // post-signature T3 write; no Owner call or signed receipt may appear.
  const beforeMismatchedTerms=await personal.evaluate(()=>
    window.__personMockIssueCalls||0);
  for(const flag of ['__personMockMismatchBeforeOwner','__personMockNoDraftBeforeOwner']){
    await personal.evaluate(name=>{window[name]=true;},flag);
    await personOwner.getByTestId('publisher-person-issue').click();
    await personOwner.getByText('Запрос PERSON не совпадает с сохранённой подготовкой',
      {exact:false}).waitFor();
    assert.match(await personOwner.innerText(),/Подписание в исходном T3 не запускалось/);
    assert.doesNotMatch(await personOwner.innerText(),/операция могла сохраниться в T3/i);
    assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
      beforeMismatchedTerms);
    assert.equal(JSON.parse(await personal.evaluate(()=>
      sessionStorage.getItem('publisher-person-mock-ledger')||'[]')).length,0);
    assert.equal(await personOwner.getByTestId('publisher-person-issue').isEnabled(),true);
  }
  checks.push('person-native-review-draft-mismatch-and-missing-source-definite-no-issue');
  // A signed requestId belongs to the ORIGINAL T3 ledger, not to an
  // arbitrary local draft. Refuse a different subject, including when the
  // conflicting record has already fallen outside the recent inventory.
  // All summary fields match; only the immutable full request differs.
  const conflictingStart=new Date().toISOString();
  const conflictingSignedSource={
    licenseId:'license:person:other:issuer:1',
    requestId:directDraft.proposals[0].id,
    issuerAuthorityId:'publisher:person:mock',
    personId:'person:local-example',
    productId:'IWXA_ATLAS',deviceLimit:3,quotaCount:0,
    requestDigest:'0'.repeat(64),
    issuedAt:conflictingStart,notBefore:conflictingStart,
    expiresAt:new Date(Date.parse(conflictingStart)+30*86400000).toISOString(),
    status:'NOT_ACTIVATED',sequence:0,activeSeats:0
  };
  const nativeIssueCallsBefore=await personal.evaluate(()=>
    window.__personMockIssueCalls||0);
  await personal.evaluate(({record,requestId})=>{
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify([record]));
    window.__personMockHideOriginalRecent=requestId;
  },{record:conflictingSignedSource,requestId:directDraft.proposals[0].id});
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isEnabled(),true);
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('PERSON_SIGNED_REQUEST_SCOPE_MISMATCH',{exact:false}).waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    nativeIssueCallsBefore,'Conflicting signed source must not reach original signer');
  await personal.evaluate(()=>{window.__personMockHideOriginalRecent=null;});
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByTestId('publisher-person-signed-source-conflict').waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  assert.equal(await personOwner.getByTestId('publisher-person-already-issued').count(),0);
  checks.push('person-signed-request-id-conflict-never-claimed-as-issued-or-resigned');
  checks.push('person-request-digest-rejects-different-rights-with-matching-summary');
  await personal.evaluate(()=>{
    sessionStorage.removeItem('publisher-person-mock-ledger');
  });
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  await personal.evaluate(()=>{window.__personMockLoseNextIssueReceipt=true;});
  const issuerCallsBeforeLostIssue=await personal.evaluate(()=>window.__personMockIssueCalls||0);
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Операция могла сохраниться в T3',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал прочитан. Неизвестный результат подписи',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true,
    'A generic ledger refresh must not re-enable original ISSUE signing');
  // The original inventory can say COMMITTED while independent cold
  // signed STATUS readback disagrees. Never clear OUTCOME_UNKNOWN or re-sign.
  const signedBefore=await personal.evaluate(()=>
    window.__personMockSignedReadbackCalls||0);
  await personal.evaluate(at=>{
    window.__personMockDivergeSignedReadbackAt=at+2;
  },signedBefore);
  await personOwner.getByTestId('publisher-person-reconcile-original').click();
  await personOwner.getByText('PERSON_OWNER_TWO_COLD_SIGNED_READBACK_DIVERGED',
    {exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-unknown-outcome').count(),1);
  assert.equal(await personOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    issuerCallsBeforeLostIssue+1,'Divergent native proof must not resend ISSUE');
  checks.push('person-unknown-issue-needs-two-cold-signed-envelopes');
  await personOwner.getByTestId('publisher-person-reconcile-original').click();
  await personOwner.getByText('Оригинальный T3 подтвердил подписанную запись',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-unknown-outcome').count(),0);
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    issuerCallsBeforeLostIssue+1,'A recovered signed ISSUE must never call original issuer twice');
  await personOwner.getByTestId('publisher-person-already-issued').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /license:person:mock:one/);
  checks.push('person-lost-issue-ack-reconciled-from-original-owner-without-second-signature');
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
  // Another Publisher can suspend the same license while this window still
  // shows ACTIVE. Refuse an unintended additional STATUS signature.
  const beforeExternalStatus=await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    const before={status:ledger[0].status,sequence:ledger[0].sequence};
    ledger[0].status='SUSPENDED';
    ledger[0].sequence+=1;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
    return before;
  });
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'})
    .selectOption('SUSPENDED');
  const statusCallsBefore=await personal.evaluate(()=>window.__personMockStatusCalls||0);
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('PERSON_STATUS_SIGNED_SOURCE_STALE_REFRESH_REQUIRED',
    {exact:false}).waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    statusCallsBefore,'Stale UI must not send a second native signed STATUS');
  await personal.evaluate(before=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[0].status=before.status;ledger[0].sequence=before.sequence;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },beforeExternalStatus);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-status-change-refuses-stale-owner-sequence');
  // Another signed status can commit AFTER the UI preflight. Original T3
  // must reject that stale sequence without signing a second transition.
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'})
    .selectOption('SUSPENDED');
  const beforeOwnerRace=await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    return {status:ledger[0].status,sequence:ledger[0].sequence,
      statusIssuedAt:ledger[0].statusIssuedAt,
      statusValidUntil:ledger[0].statusValidUntil};
  });
  await personal.evaluate(()=>{window.__personMockRaceNextStatus=true;});
  const signedCallsBeforeRace=await personal.evaluate(()=>window.__personMockStatusCalls||0);
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('последовательность статуса устарела',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-unknown-outcome').count(),0,
    'Original T3 STATUS sequence CAS failure is a definite pre-sign rejection');
  const ownerRaceState=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')))[0];
  assert.equal(ownerRaceState.status,'SUSPENDED');
  assert.equal(ownerRaceState.sequence,beforeOwnerRace.sequence+1);
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    signedCallsBeforeRace+1,'Failed T3 CAS must not call a second signer');
  await personal.evaluate(before=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    Object.assign(ledger[0],before);
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },beforeOwnerRace);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-original-owner-cas-refuses-race-after-preflight');
  // A signed carrier recipient belongs to THIS license. Auto-selection of a
  // newly issued renewal must not carry the previous delivery key forward.
  await personOwner.getByTestId('publisher-person-age-recipients')
    .fill('age1'+'q'.repeat(58));
  // A new PERSON subscription is a distinct unsigned follow-up tied to
  // the exact signed original entry. It must not silently reissue rights.
  await personOwner.getByRole('combobox',{name:'Тариф продления PERSON'})
    .selectOption('ATLAS_PERSONAL#1');
  // The selected ACTIVE state can become terminally REVOKED in another
  // Publisher session. No renewal draft may be saved from stale UI state.
  const originalSignedStatus=await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    const old={status:ledger[0].status,sequence:ledger[0].sequence};
    ledger[0].status='REVOKED';
    ledger[0].sequence+=1;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
    return old;
  });
  await personOwner.getByTestId('publisher-person-prepare-renewal').click();
  await personOwner.getByText('PERSON_RENEWAL_SIGNED_SOURCE_STALE_REFRESH_REQUIRED',
    {exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).proposals.length,1,
    'A revoked original license must not create a new renewal draft');
  await personal.evaluate(old=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[0].status=old.status;
    ledger[0].sequence=old.sequence;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },originalSignedStatus);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-renewal-preparation-refuses-stale-original-status');
  const originalSignedHash=await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    const hash=ledger[0].requestDigest;
    ledger[0].requestDigest='0'.repeat(64);
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
    return hash;
  });
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  await personOwner.getByTestId('publisher-person-prepare-renewal').click();
  await personOwner.getByText('PERSON_RENEWAL_SIGNED_SOURCE_DIGEST_MISMATCH',{exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).proposals.length,1,
    'Mismatched signed source must not create renewal');
  await personal.evaluate(hash=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[0].requestDigest=hash;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },originalSignedHash);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-renewal-preparation-checks-original-request-digest');
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
  await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[0].requestDigest='0'.repeat(64);
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  });
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  const nativeCallsBeforeRenewal=await personal.evaluate(()=>window.__personMockIssueCalls||0);
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('PERSON_RENEWAL_SIGNED_SOURCE_DIGEST_MISMATCH',{exact:false}).waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockIssueCalls||0),
    nativeCallsBeforeRenewal,'Changed original request must not reach T3 signer');
  await personal.evaluate(hash=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    ledger[0].requestDigest=hash;
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },originalSignedHash);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-renewal-signature-preflight-checks-original-request-digest');
  await personOwner.getByTestId('publisher-person-issue').click();
  await personOwner.getByText('Подписанная лицензия сохранена в журнале издателя и выбрана.',{exact:false}).waitFor();
  await personOwner.getByTestId('publisher-person-already-issued').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-already-issued').innerText(),
    /license:person:mock:two/);
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:two/,
    'Signed renewal must be selected after exact original T3 readback');
  checks.push('person-renewal-references-original-T3-even-when-older-than-recent-view');
  assert.equal(await personOwner.getByTestId('publisher-person-age-recipients').inputValue(),'',
    'Automatic signed-renewal selection must not inherit the original license recipient key');
  assert.equal(await personOwner.getByTestId('publisher-person-export-age').isDisabled(),true);
  checks.push('person-age-recipient-bound-to-signed-license-even-after-auto-selection');
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
  await personOwner.getByTestId('publisher-person-age-recipients').fill('age1'+'q'.repeat(58));
  await personLicensePicker.selectOption('license:person:mock:two');
  assert.equal(await personOwner.getByTestId('publisher-person-age-recipients').inputValue(),'',
    'Renewal must not inherit the previously selected PERSON recipient key');
  checks.push('person-age-recipient-is-scoped-to-selected-license');
  assert.match(await personOwner.getByTestId('publisher-person-selected-license').innerText(),
    /Продление лицензии license:person:mock:one/);
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('ACTIVE');
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Подписанный статус сохранён.',{exact:false}).waitFor();
  checks.push('person-renewal-issued-over-native-ipc-with-source-request-identity');
  checks.push('person-original-and-renewal-requests-cannot-be-reissued-by-ui');
  await personOwner.getByRole('combobox',{name:'Персональная лицензия',exact:true})
    .selectOption('license:person:mock:one');
  // A second Owner instance may change status after Publisher has read its
  // inventory but before the native Save dialog returns. No file may be
  // reported as exported for an unexpected signed status sequence.
  const beforeRaceExport=await personal.evaluate(()=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    return {status:ledger[0].status,sequence:ledger[0].sequence,
      statusIssuedAt:ledger[0].statusIssuedAt,
      statusValidUntil:ledger[0].statusValidUntil};
  });
  await personal.evaluate(()=>{window.__personMockRaceNextExport=true;});
  const exportCallsBefore=await personal.evaluate(()=>window.__personMockExportCalls||0);
  await personOwner.getByTestId('publisher-person-export').click();
  await personOwner.getByText('PERSON_OWNER_EXPORT_SEQUENCE_STALE',{exact:false}).waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockExportCalls||0),
    exportCallsBefore+1,'Stale signed export must not invoke native Owner twice');
  const raceExportLedger=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(raceExportLedger[0].status,'SUSPENDED');
  assert.equal(raceExportLedger[0].sequence,beforeRaceExport.sequence+1);
  await personal.evaluate(previous=>{
    const ledger=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    Object.assign(ledger[0],previous);
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(ledger));
  },beforeRaceExport);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  checks.push('person-original-owner-export-sequence-race-rejected-before-delivery');
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
  const receiptsBefore=await personal.evaluate(()=>window.__personMockSignedReadbackCalls||0);
  const statusBeforeOwnerReceipt=await personal.evaluate(()=>window.__personMockStatusCalls||0);
  await personOwner.getByTestId('publisher-person-owner-signed-readback').click();
  await personOwner.getByTestId('publisher-person-owner-signed-evidence').waitFor();
  assert.match(await personOwner.getByTestId('publisher-person-owner-signed-evidence').innerText(),
    /REVOKED|SHA-256 подписанного LICENSE|SHA-256 подписанного STATUS/);
  assert.equal(await personal.evaluate(()=>window.__personMockSignedReadbackCalls||0),
    receiptsBefore+2,'Two independent original signed Owner reads are required');
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    statusBeforeOwnerReceipt,
    'Read-only owner inspection must never call the signing operation again');
  checks.push('person-owner-exact-signed-envelope-readback-is-separate-from-holder-acceptance');
  // A changing signed STATUS/2 between the two original native processes
  // must not be presented as a stable verified owner proof. This fixture
  // emulates a concurrent issuer without producing a second signature.
  const beforeDivergence=await personal.evaluate(()=>
    window.__personMockSignedReadbackCalls||0);
  await personal.evaluate(at=>{
    window.__personMockDivergeSignedReadbackAt=at+2;
  },beforeDivergence);
  await personOwner.getByTestId('publisher-person-owner-signed-readback').click();
  await personOwner.getByText('PERSON_OWNER_TWO_COLD_SIGNED_READBACK_DIVERGED',
    {exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-owner-signed-evidence').count(),0,
    'A divergent historical signed status cannot remain visible as verified');
  assert.equal(await personOwner.getByTestId('publisher-person-owner-signed-readback').isDisabled(),true,
    'Divergence must require refreshing the original owner inventory');
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    statusBeforeOwnerReceipt,
    'A failed signed readback must never request another STATUS signature');
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал персональных лицензий обновлён.',{exact:false}).waitFor();
  await personOwner.getByTestId('publisher-person-owner-signed-readback').click();
  await personOwner.getByTestId('publisher-person-owner-signed-evidence').waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockSignedReadbackCalls||0),
    beforeDivergence+4,
    'A recovered signed status needs another full two-process verification');
  checks.push('person-owner-divergent-native-signed-status-requires-refresh-no-resign');
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
  const signerCallsBeforeRecovery=await personal.evaluate(()=>
    window.__personMockStatusCalls||0);
  const inventoryCallsBeforeRecovery=await personal.evaluate(()=>
    window.__personMockInventoryCalls||0);
  await personOwner.getByTestId('publisher-person-refresh').click();
  await personOwner.getByText('Журнал прочитан. Неизвестный результат подписи',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true,
    'A generic refresh must not unlock repeated STATUS signing');
  await personOwner.getByTestId('publisher-person-unknown-outcome').waitFor();
  await personOwner.getByTestId('publisher-person-reconcile-original').click();
  await personOwner.getByText('Оригинальный T3 подтвердил подписанную запись',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-unknown-outcome').count(),0);
  assert.ok((await personal.evaluate(()=>window.__personMockInventoryCalls||0))>=
    inventoryCallsBeforeRecovery+4,'Recovery requires two fresh owner reads and inventory readback');
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    signerCallsBeforeRecovery,'Recovery must never sign another STATUS');
  const afterLostResponse=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger')));
  assert.equal(afterLostResponse[1].sequence,2,
    'Original readback must not create another signed native status');
  checks.push('person-lost-status-ack-resolves-by-two-original-durable-readbacks-no-reapply');
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
  await personOwner.getByRole('combobox',{name:'Новый статус PERSON'}).selectOption('SUSPENDED');
  assert.equal(await personOwner.getByTestId('publisher-person-status').isEnabled(),true,
    'Owner should be able to refresh an expiring SUSPENDED status without issuing a new license');
  assert.equal(await personOwner.getByTestId('publisher-person-status').innerText(),
    'Обновить подпись статуса');
  await personal.evaluate(()=>{window.__personMockLoseBeforeStatusCommit=true;});
  await personOwner.getByTestId('publisher-person-status').click();
  await personOwner.getByText('Операция могла сохраниться в T3',{exact:false}).waitFor();
  const statusCallsAfterUnknown=await personal.evaluate(()=>window.__personMockStatusCalls||0);
  await personOwner.getByTestId('publisher-person-reconcile-original').click();
  await personOwner.getByText('Исходный T3 пока не подтвердил результат.',{exact:false}).waitFor();
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true);
  assert.equal((JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('publisher-person-mock-ledger'))))[1].sequence,2,
    'Uncommitted original STATUS must not be reported as accepted');
  // Model the original owner finishing an already-sent operation after the
  // IPC answer is lost. This browser fixture is NOT a signed-consumer test.
  await personal.evaluate(()=>{
    const rows=JSON.parse(sessionStorage.getItem('publisher-person-mock-ledger'));
    rows[1].status='SUSPENDED';rows[1].sequence+=1;
    rows[1].statusIssuedAt=new Date().toISOString();
    rows[1].statusValidUntil=new Date(Math.min(
      Date.now()+24*3600000,Date.parse(rows[1].expiresAt))).toISOString();
    sessionStorage.setItem('publisher-person-mock-ledger',JSON.stringify(rows));
  });
  await personOwner.getByTestId('publisher-person-reconcile-original').click();
  await personOwner.getByText('Оригинальный T3 подтвердил подписанную запись',{exact:false}).waitFor();
  assert.equal(await personal.evaluate(()=>window.__personMockStatusCalls||0),
    statusCallsAfterUnknown,'Unknown outcome recovery must never call original signer again');
  checks.push('person-lost-status-ack-does-not-reissue-until-original-ledger-confirmation');
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
      requestDigest:'f'.repeat(64),
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
  // A missing exact ID must clear the PREVIOUS license; otherwise the
  // operator can accidentally export or revoke that old record.
  await personOwner.getByTestId('publisher-person-lookup-input')
    .fill('license:person:unknown:1001');
  await personOwner.getByTestId('publisher-person-lookup').click();
  await personOwner.getByText('В исходном T3 нет лицензии с таким идентификатором.').waitFor();
  assert.equal(await personOwner.getByRole('combobox',{name:'Персональная лицензия'}).inputValue(),'');
  assert.equal(await personOwner.getByTestId('publisher-person-export').isDisabled(),true);
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true);
  checks.push('person-missing-lookup-clears-previously-selected-license-and-revocation');
  // Original and renewal belong to the SAME person. A lookup by personId
  // returns both, requiring an explicit choice instead of the first record.
  await personOwner.getByTestId('publisher-person-lookup-input')
    .fill(updatedLedger[0].personId);
  await personOwner.getByTestId('publisher-person-lookup').click();
  await personOwner.getByText('Поиск в исходном T3: найдено записей 2. Выберите конкретную лицензию из списка.').waitFor();
  assert.equal(await personOwner.getByRole('combobox',{name:'Персональная лицензия'}).inputValue(),'');
  assert.equal(await personOwner.getByTestId('publisher-person-export').isDisabled(),true);
  assert.equal(await personOwner.getByTestId('publisher-person-status').isDisabled(),true);
  await personOwner.getByRole('combobox',{name:'Персональная лицензия'})
    .selectOption(oldLicense);
  assert.equal(await personOwner.getByTestId('publisher-person-export').isEnabled(),true);
  checks.push('person-original-and-renewal-ambiguous-lookup-never-auto-selects');
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
  // The first proposal has a linked renewal and is already protected by
  // the draft model. Exercise the terminal SIGNED renewal (index 1) to
  // reach the original T3 inventory check rather than that earlier guard.
  await personal.getByRole('button',{name:'Удалить',exact:true}).nth(1).click();
  const afterUnavailable=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture')));
  const unavailableVisible=await personal.locator('main').innerText();
  assert.equal(afterUnavailable.proposals.length,3,
    'Lost native ledger must preserve PERSON proposal; UI: '+unavailableVisible.slice(-1200));
  assert.match(unavailableVisible,/Журнал T3 недоступен: нельзя подтвердить/,
    'The user must receive actionable failure feedback for an unreadable owner ledger');
  await personal.getByRole('button',{name:'Удалить',exact:true}).nth(1).click();
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
  // A backup from before signed renewal is well-formed but MUST NOT erase
  // the saved source request required for later original-T3 renewal/readback.
  const actualSignedDraft=JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture')));
  assert.equal(actualSignedDraft.proposals.length,2);
  await personal.getByRole('button',{name:'Обзор',exact:true}).click();
  const restoreButton=personal.getByRole('button',{name:'Восстановить черновики'});
  const replaceButton=personal.getByRole('button',{name:'Заменить текущие черновики'});
  const chooseBackup=async backup=>{
    await personal.evaluate(content=>{window.__personMockRestoreContent=content;},
      JSON.stringify(backup));
    await restoreButton.click();
    await personal.getByTestId('publisher-restore-confirmation').waitFor();
    await replaceButton.click();
  };
  await chooseBackup({...actualSignedDraft,proposals:[actualSignedDraft.proposals[0]]});
  await personal.getByText('Подписанный PERSON-запрос нельзя удалить или изменить',
    {exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).proposals.length,2,
    'Old backup must not discard a signed T3 renewal source');
  await personal.getByRole('button',{name:'Отмена восстановления'}).click();
  checks.push('restore-rejects-dropping-a-signed-renewal-request');
  // Keeping the ID while changing the recipient also invalidates the
  // already-signed source, and must never silently rebind that identity.
  const changedSubject=structuredClone(actualSignedDraft);
  changedSubject.holders[0].name='Replaced Person Name';
  await chooseBackup(changedSubject);
  await personal.getByText('Подписанный PERSON-запрос нельзя удалить или изменить',
    {exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).holders[0].name,
    actualSignedDraft.holders[0].name);
  await personal.getByRole('button',{name:'Отмена восстановления'}).click();
  checks.push('restore-rejects-rebinding-the-same-signed-person-request');
  // An unchanged signed source must NOT block ordinary backup recovery.
  const intact={...actualSignedDraft,
    updatedAt:new Date(Date.now()+1000).toISOString()};
  await chooseBackup(intact);
  await personal.getByText('Черновики восстановлены из копии и сохранены.',{exact:false}).waitFor();
  assert.equal(JSON.parse(await personal.evaluate(()=>
    sessionStorage.getItem('iwxa-publisher-person-fixture'))).updatedAt,intact.updatedAt);
  checks.push('restore-preserves-signed-person-identity-and-recovers-unchanged-draft');
  await personal.getByRole('button',{name:'Лицензии',exact:true}).click();
  await personal.evaluate(()=>{window.__personNativeEnabled=true;});
  const renewalRequestId=actualSignedDraft.proposals[1].id;
  await personal.getByTestId('publisher-person-open-in-owner').nth(1).click();
  const selectedOwner=personal.getByTestId('publisher-person-owner');
  await selectedOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .waitFor({state:'visible'});
  // Native inventory readback is asynchronous. Observe the authoritative
  // lookup result before asserting the controlled exact request selection.
  await selectedOwner.getByText('Поиск в исходном T3: найдено записей 1.',
    {exact:false}).waitFor();
  assert.equal(await selectedOwner.getByRole('combobox',{name:'Подготовленная лицензия'})
    .inputValue(),renewalRequestId,
    'The prepared PERSON request must navigate to its exact T3 issue source');
  assert.equal(await selectedOwner.getByTestId('publisher-person-lookup-input').inputValue(),
    renewalRequestId);
  assert.match(await selectedOwner.getByTestId('publisher-person-selected-license').innerText(),
    /license:person:mock:two/);
  assert.equal(await selectedOwner.getByTestId('publisher-person-issue').isDisabled(),true);
  checks.push('prepared-person-request-opens-exact-original-T3-signed-record');
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
