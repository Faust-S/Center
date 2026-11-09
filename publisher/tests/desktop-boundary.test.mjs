import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
test('Publisher has a native-only user route; no browser draft or browser file download',()=>{
 const app=read('publisher/ui/App.tsx');
 assert.match(app,/__TAURI_INTERNALS__/);
 assert.match(app,/publisher_draft_read/);
 assert.match(app,/publisher_draft_save/);
 assert.match(app,/publisher_save_test_request/);
 assert.match(app,/publisher_compare_offline_copies/);
 assert.match(app,/publisher-desktop-required/);
 assert.doesNotMatch(app,/localStorage|sessionStorage|URL\.createObjectURL|document\.createElement\('a'\)|'Режим браузерного просмотра'/);
 assert.match(app,/самостоятельная настольная программа/);
 const tauri=JSON.parse(read('publisher/src-tauri/tauri.conf.json'));
 assert.equal(tauri.build.frontendDist,'../../publisher-dist');
 assert.equal(tauri.productName,'IWXA Publisher');
 assert.equal(tauri.identifier,'ru.iwxa.publisher');
 assert.ok(tauri.bundle.icon.includes('icons/icon.ico'));
 assert.equal(tauri.app.windows[0].minWidth,700);
 assert.ok(tauri.app.windows[0].height<=700,'Default desktop window must fit a 768px monitor with taskbar');
 const packageScripts=JSON.parse(read('package.json')).scripts;
 assert.equal(packageScripts['publisher:desktop:exe'],'cd publisher && npx tauri build --no-bundle');
});
test('Firefox preview is an isolated render harness, never a shippable browser product',()=>{
 const testCode=read('publisher/tests/browser-smoke.mjs');
 assert.match(testCode,/browser-without-tauri-cannot-run-desktop-publisher/);
 assert.match(testCode,/__TAURI_INTERNALS__=\{invoke:async/);
 assert.match(testCode,/sessionStorage\.setItem\('iwxa-publisher-test-native-draft'/);
 assert.match(testCode,/compact-desktop-navigation-no-horizontal-overflow/);
 assert.doesNotMatch(read('publisher/ui/App.tsx'),/__publisherMockNativeCommands|iwxa-publisher-test-native-draft/);
});

test('Offline two-copy command remains byte-only without approving releases or physical independence',()=>{
 const rust=read('publisher/src-tauri/src/main.rs');
 assert.match(rust,/fn publisher_compare_offline_copies\(\)/);
 assert.match(rust,/compare_offline_copies\(&first, &second\)/);
 assert.match(rust,/physical_independence_verified: false/);
 assert.match(rust,/publisher_authorized: false/);
 assert.match(rust,/signed_release_metadata_verified: false/);
 assert.match(rust,/OFFLINE_COPY_SAME_SELECTED_FILE/);
 assert.match(rust,/OFFLINE_COPY_SHA256_MISMATCH/);
 const app=read('publisher/ui/App.tsx');
 assert.match(app,/Сверка двух копий файла поставки/);
 assert.match(app,/Независимость физических носителей не подтверждена/);
 assert.doesNotMatch(app,/localStorage|URL\.createObjectURL/);
});

test('native desktop startup has visible loading fallback and React recovery rather than blank screen',()=>{
 const html=read('publisher/index.html');
 const entry=read('publisher/ui/main.tsx');
 assert.match(html,/id="publisher-startup"/);
 assert.match(html,/Загрузка интерфейса/);
 assert.match(html,/type="module" src="\/ui\/main\.tsx"/);
 assert.match(entry,/class PublisherRenderBoundary/);
 assert.match(entry,/PUBLISHER_DESKTOP_RENDER_FAILURE/);
 assert.match(entry,/data-testid="publisher-recovery"/);
 assert.match(entry,/Повторить запуск/);
 assert.doesNotMatch(entry,/localStorage|sessionStorage|new Store|issuerKey|signRecord/);
});
