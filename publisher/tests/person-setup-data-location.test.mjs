import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync('publisher/src-tauri/src/main.rs','utf8');
const native=readFileSync('native/t3_product_component.rs','utf8');
const admin=readFileSync('src-tauri/src/main.rs','utf8');
test('Publisher 0.4 follows the selected Setup Core data folder for drafts and PERSON owner',()=>{
 assert.match(main,/fn setup_core_publisher_data_root\(\)/);
 assert.match(main,/SetupCore\\\\Products\\\\iwxa\.publisher/);
 assert.match(main,/DataLocation/);
 assert.match(main,/RegGetValueW\(/);
 assert.match(main,/PUBLISHER_SETUP_CORE_DATA_LOCATION_NOT_ABSOLUTE/);
 assert.match(main,/fn publisher_root\(app: &AppHandle\)/);
 assert.match(main,/setup_core_publisher_data_root\(\)\?/);
 assert.match(main,/app\.path\(\)\.app_local_data_dir\(\)/);
 assert.match(native,/crate::t3_product_app_root\(app\)/);
 assert.match(main,/fn t3_product_app_root\(app: &AppHandle\)/);
 assert.match(main,/t3_product_app_root\([\s\S]*?publisher_root\(app\)/);
 assert.match(native,/"owner-person" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-person"\)\)/);
 assert.doesNotMatch(native,/crypto::sign|privateKeyPem|newSigner|PRIVATE KEY/);
});
test('source adapter keeps TEST and PERSON owner roots independent',()=>{
 assert.match(native,/"owner" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-test"\)\)/);
 assert.match(native,/"owner-person" => Ok\(\("iwxa-t3-product-owner\.exe", "t3-owner-person"\)\)/);
 assert.match(native,/let base = crate::t3_product_app_root\(app\)/);
 assert.match(admin,/fn t3_product_app_root\(app: &AppHandle\)/);
 assert.match(admin,/t3_product_app_root\([\s\S]*?path_for\(app\)/);
 assert.match(admin,/mod t3_consumer;/);
 assert.match(admin,/t3_consumer::center_cen04_t3_import/);
 assert.doesNotMatch(admin,/publisher_root\(/);
 assert.match(main,/t3_product_app_root\([\s\S]*?publisher_root\(app\)/);
 assert.match(native,/"master-secret\.dpapi\.json"/);
 assert.match(native,/"administrator\.dpapi\.json"/);
});
test('signed PERSON owner receipt remains a read-only original T3 command',()=>{
  const native=readFileSync('publisher/src-tauri/src/t3_owner.rs','utf8');
  const app=readFileSync('publisher/src-tauri/src/main.rs','utf8');
  const start=native.indexOf('pub async fn publisher_t3_person_signed_readback(');
  const end=native.indexOf('pub async fn publisher_t3_person_issue(',start);
  assert.ok(start>0&&end>start);
  const source=native.slice(start,end);
  assert.match(source,/call_person\(app,"person-readback"/);
  assert.match(source,/PERSON_SIGNED_READBACK/);
  assert.match(source,/recipientConfirmed/);
  assert.doesNotMatch(source,/person-issue|person-status|\.save\(|signRecord\(/);
  assert.match(app,/t3_owner::publisher_t3_person_signed_readback/);
});
