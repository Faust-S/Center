import {firefox} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

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

  await page.screenshot({path:'artifacts/publisher/overview-320.png',fullPage:true});
  await page.setViewportSize({width:1366,height:900});
  await page.screenshot({path:'artifacts/publisher/overview-1366.png',fullPage:true});
  assert.deepEqual(errors,[]);
  checks.push('no-browser-page-errors');
  const report={status:'PASS',checks,errors,environment:'Firefox Playwright; local preview without native issuer',issuer:'NOT_CONNECTED',signature:'NOT_TESTED'};
  writeFileSync('artifacts/publisher/browser-result.json',JSON.stringify(report,null,2));
  console.log('PUBLISHER_BROWSER_PREPARATION_PASS '+checks.join(', '));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
