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
