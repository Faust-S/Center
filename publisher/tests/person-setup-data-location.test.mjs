import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync('publisher/src-tauri/src/main.rs','utf8');
const native=readFileSync('native/t3_product_component.rs','utf8');
test('Publisher 0.4 follows the selected Setup Core data folder for drafts and PERSON owner',()=>{
 assert.match(main,/fn setup_core_publisher_data_root\(\)/);
 assert.match(main,/SetupCore\\\\Products\\\\iwxa\.publisher/);
 assert.match(main,/DataLocation/);
 assert.match(main,/RegGetValueW\(/);
 assert.match(main,/PUBLISHER_SETUP_CORE_DATA_LOCATION_NOT_ABSOLUTE/);
 assert.match(main,/fn publisher_root\(app: &AppHandle\)/);
 assert.match(main,/setup_core_publisher_data_root\(\)\?/);
 assert.match(main,/app\.path\(\)\.app_local_data_dir\(\)/);
 assert.match(native,/crate::publisher_root\(app\)/);
 assert.match(native,/"owner-person" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-person"\)\)/);
 assert.doesNotMatch(native,/crypto::sign|privateKeyPem|newSigner|PRIVATE KEY/);
});
test('source adapter keeps TEST and PERSON owner roots independent',()=>{
 assert.match(native,/"owner" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-test"\)\)/);
 assert.match(native,/"owner-person" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-person"\)\)/);
 assert.match(native,/let base = crate::publisher_root\(app\)/);
 assert.match(native,/"master-secret\.dpapi\.json"/);
 assert.match(native,/"administrator\.dpapi\.json"/);
});
