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
 assert.equal(tauri.app.windows[0].dataDirectory,'webview','WebView2 cache belongs to Publisher app-local data, not install root');
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
 assert.match(html,/id="publisher-startup-retry"/);
 assert.match(html,/<a href="\.\/" id="publisher-startup-retry">Повторить загрузку<\/a>/);
 assert.doesNotMatch(html,/<script>(?!<\/script>)/);
 assert.match(html,/type="module" src="\/ui\/main\.tsx"/);
 assert.match(entry,/class PublisherRenderBoundary/);
 assert.match(entry,/PUBLISHER_DESKTOP_RENDER_FAILURE/);
 assert.match(entry,/data-testid="publisher-recovery"/);
 assert.match(entry,/Повторить запуск/);
 assert.doesNotMatch(entry,/localStorage|sessionStorage|new Store|issuerKey|signRecord/);
});

test('native Publisher initializes WebView2 user data before the window and respects explicit override',()=>{
 const rust=read('publisher/src-tauri/src/main.rs');
 const declaration=rust.indexOf('fn configure_webview2_folder()');
 const call=rust.indexOf('configure_webview2_folder().expect(');
 const builder=rust.indexOf('tauri::Builder::default()');
 assert.ok(declaration>=0 && call>declaration && builder>call);
 assert.match(rust,/var_os\("LOCALAPPDATA"\)/);
 assert.match(rust,/var_os\("WEBVIEW2_USER_DATA_FOLDER"\)/);
 assert.match(rust,/set_var\("WEBVIEW2_USER_DATA_FOLDER", &folder\)/);
 assert.match(rust,/join\("ru\.iwxa\.publisher"\)\.join\("webview"\)/);
 assert.doesNotMatch(rust,/remove_dir_all\(&folder\)/);
 const windows=read('publisher/tests/installed-windows-publisher.ps1');
 assert.match(windows,/PUBLISHER_WEBVIEW_APP_LOCAL_FIRST_LAUNCH_PASS/);
 assert.match(windows,/PUBLISHER_WEBVIEW_APP_LOCAL_NORMAL_RESTART_PASS/);
 assert.match(windows,/PUBLISHER_NATIVE_WEBVIEW_INSTALL_ROOT_PROFILE_AFTER_NORMAL_RESTART/);
});

test('Publisher resets the native scrolling work area before switching sections',()=>{
 const app=read('publisher/ui/App.tsx');
 const ui=read('publisher/tests/browser-smoke.mjs');
 assert.match(app,/mainScrollRef=React\.useRef<HTMLElement>\(null\)/);
 assert.match(app,/mainScrollRef\.current\.scrollTop=0/);
 assert.match(app,/window\.scrollTo\(0,0\)/);
 assert.match(app,/<main className="main" ref=\{mainScrollRef\}>/);
 assert.match(ui,/native-desktop-section-navigation-resets-main-scroll/);
});

test('Publisher tariff and license preparation show true persistence outcomes next to their actions',()=>{
 const ui=read('publisher/ui/TariffPanel.tsx');
 const app=read('publisher/ui/App.tsx');
 const smoke=read('publisher/tests/browser-smoke.mjs');
 assert.match(app,/Promise<\{ok:boolean;message:string\}>/);
 assert.match(app,/await persistDraft\(next\)/);
 assert.match(app,/return \{ok:true,message:success\}/);
 assert.match(ui,/publisher-tariff-save-feedback/);
 assert.match(ui,/publisher-proposal-save-feedback/);
 assert.match(ui,/role=\{tariffFeedback\.ok\?'status':'alert'\}/);
 assert.match(ui,/role=\{proposalFeedback\.ok\?'status':'alert'\}/);
 assert.match(smoke,/tariff-native-save-failure-and-success-visible-beside-action/);
 assert.match(smoke,/proposal-native-save-failure-and-success-visible-beside-action/);
});

test('product and client drafts keep their form values when native persistence fails',()=>{
 const app=read('publisher/ui/App.tsx');
 const smoke=read('publisher/tests/browser-smoke.mjs');
 assert.match(app,/async function saveProduct\(e:React\.FormEvent\)/);
 assert.match(app,/async function saveClient\(e:React\.FormEvent\)/);
 assert.match(app,/if\(result\.ok\)\{setHolderName\(''\);setHolderSourceId\(''\);\}/);
 assert.match(app,/publisher-product-save-feedback/);
 assert.match(app,/publisher-client-save-feedback/);
 assert.match(smoke,/product-native-save-failure-retains-form-and-success-is-inline/);
 assert.match(smoke,/client-native-save-failure-retains-form-and-success-is-inline/);
});
