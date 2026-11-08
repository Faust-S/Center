import {firefox} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
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

  await page.reload();
  await page.getByRole('button',{name:'Запросы на лицензии'}).click();
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
