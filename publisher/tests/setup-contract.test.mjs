import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
test('Publisher declares a product-specific IWXA Setup Core manifest without forking installer logic',()=>{
 const m=read('publisher/setup/product.json');
 const app=read('publisher/src-tauri/tauri.conf.json');
 const keys=['schema','id','display_name','publisher','version','architecture','install_dir','entrypoint','data_namespace','requirements'];
 assert.deepEqual(Object.keys(m).sort(),keys.sort());
 assert.equal(m.schema,'IWXA_SETUP_PRODUCT/1');
 assert.match(m.id,/^[a-z][a-z0-9.-]{2,63}$/);
 assert.equal(m.id,'iwxa.publisher');
 assert.equal(m.data_namespace,app.identifier);
 assert.equal(m.display_name,app.productName);
 assert.equal(m.version,app.version);
 assert.equal(m.entrypoint,'iwxa-publisher.exe');
 assert.equal(m.install_dir,'IWXA Publisher');
 assert.equal(m.architecture,'windows-x64');
 assert.deepEqual(m.requirements,['webview2-evergreen']);
});
test('Publisher setup product identity is distinct from Admin Center and its data namespace',()=>{
 const m=read('publisher/setup/product.json'),admin=read('src-tauri/tauri.conf.json');
 assert.notEqual(m.data_namespace,admin.identifier);
 assert.notEqual(m.display_name,admin.productName);
 assert.notEqual(m.entrypoint,'iwxa-admin-center.exe');
});

test('Publisher full release EXE is assembled with Tauri resources before Setup Core packaging',()=>{
 const app=read('publisher/src-tauri/tauri.conf.json');
 const scripts=read('package.json').scripts;
 const workflow=readFileSync('.github/workflows/center.yml','utf8');
 const publisherJob=workflow.split('\n  publisher-windows:')[1];
 assert.ok(publisherJob,'Missing existing Publisher Windows job');
 assert.equal(app.build.beforeBuildCommand,'npm run publisher:build');
 assert.equal(app.build.frontendDist,'../../publisher-dist');
 assert.equal(scripts['publisher:desktop:build'],'cd publisher && npx tauri build');
 assert.equal(scripts['publisher:desktop:exe'],'cd publisher && npx tauri build --no-bundle');
 assert.match(publisherJob,/run:\s*npm run publisher:desktop:exe/);
 assert.doesNotMatch(publisherJob,/run:\s*cargo build --release/);
 assert.match(publisherJob,/run:\s*\.\/publisher\/tests\/installed-setupcore-publisher\.ps1/);
});

// Publisher 0.5 must have one product identity across the native app,
// original Setup Core package and installed acceptance tests. Admin Center's
// independent version is deliberately excluded.
test('Publisher development 0.5.0-dev.1 identity matches Rust, Tauri, Setup Core, UI and Windows acceptance',()=>{
 const m=read('publisher/setup/product.json');
 const app=read('publisher/src-tauri/tauri.conf.json');
 const cargo=readFileSync('publisher/src-tauri/Cargo.toml','utf8');
 const ui=readFileSync('publisher/ui/App.tsx','utf8');
 const installed=readFileSync('publisher/tests/installed-setupcore-publisher.ps1','utf8');
 assert.equal(m.version,'0.5.0-dev.1');
 assert.equal(m.version,app.version);
 const install=readFileSync('publisher/tests/installed-setupcore-publisher.ps1','utf8');
 const workflow=readFileSync('.github/workflows/center.yml','utf8');
 assert.match(install,/6603a11764ff86853e5abf4d209d55f79fddd8b1/);
 assert.match(install,/qualify-gui-layout-fast\.ps1 -Stub \$stub/);
 assert.match(install,/PUBLISHER_SETUP_ORIGINAL_UNIFIED_LAYOUT_QUALIFIED_PASS/);
 assert.doesNotMatch(install,/\$formType=\$stubAssembly\.GetType/);
 assert.doesNotMatch(install,/PUBLISHER_SETUP_SIDEBAR_OVERLAY_LAYOUT_REJECTED/);
 assert.match(workflow,/6603a11764ff86853e5abf4d209d55f79fddd8b1/);
 assert.equal(app.version,m.version);
 assert.match(cargo,/^version\s*=\s*"0\.4\.0-dev\.2"$/m);
 assert.ok(ui.includes('Publisher '+m.version+' ·'));
 assert.ok(installed.includes("version='"+m.version+"'"));
 assert.doesNotMatch([ui,cargo,installed].join('\n'),/0\.2\.0-dev\.2/);
 assert.equal(app.identifier,'ru.iwxa.publisher');
 assert.equal(m.data_namespace,'ru.iwxa.publisher');
});

test('installed Windows qualification repeats cold process launches and preserves draft storage',()=>{
 const installed=readFileSync('publisher/tests/installed-windows-publisher.ps1','utf8');
 assert.match(installed,/PUBLISHER_INSTALLED_COLD_PROCESS_LAUNCH_PASS cycle=\$cycle/);
 assert.match(installed,/PUBLISHER_COLD_LAUNCH_CHANGED_DRAFT_DATA/);
 assert.match(installed,/WEBVIEW2_USER_DATA_FOLDER/);
 assert.match(installed,/Find-Control 'Продукты' 'Button'/);
 assert.match(installed,/Find-Control 'Лицензии' 'Button'/);
 assert.match(installed,/publisher-cold-launch-\$cycle\.png/);
});

test('Publisher WebView2 cache is app-local and the installed Windows test rejects cache in install root',()=>{
 const cfg=read('publisher/src-tauri/tauri.conf.json');
 const native=readFileSync('publisher/tests/installed-windows-publisher.ps1','utf8');
 assert.equal(cfg.app.windows[0].dataDirectory,'webview');
 assert.match(native,/PUBLISHER_WEBVIEW_PROFILE_IN_INSTALL_ROOT/);
 assert.match(native,/PUBLISHER_WEBVIEW_INSTALL_ROOT_CLEAN_PASS/);
 assert.match(native,/PUBLISHER_WEBVIEW_APP_LOCAL_PROFILE_NOT_OBSERVED_UNDER_OVERRIDE/);
 assert.match(native,/ru\.iwxa\.publisher\\webview/);
});

test('native WebView2 profile is verified after initial launch and ordinary restart before uninstall',()=>{
 const rust=readFileSync('publisher/src-tauri/src/main.rs','utf8');
 const windows=readFileSync('publisher/tests/installed-windows-publisher.ps1','utf8');
 assert.match(rust,/configure_webview2_folder\(\)\.expect\(/);
 assert.match(windows,/PUBLISHER_NATIVE_WEBVIEW_APPLOCAL_FIRST_LAUNCH_MISSING/);
 assert.match(windows,/PUBLISHER_NATIVE_WEBVIEW_APPLOCAL_AFTER_RESTART_MISSING/);
 const setup=readFileSync('publisher/tests/installed-setupcore-publisher.ps1','utf8');
 assert.match(setup,/PUBLISHER_SETUP_UNINSTALL_WITNESS/);
});
