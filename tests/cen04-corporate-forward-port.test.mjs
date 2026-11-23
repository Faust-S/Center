import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Admin Center 0.4.1 keeps Publisher request when corporate T3 Consumer is added',()=>{
 const parent=readFileSync('src/Cen04LicensePanel.tsx','utf8');
 const child=readFileSync('src/Cen04CorporateIntakePanel.tsx','utf8');
 assert.match(parent,/prepareAdminPublisherTestRequest/);
 assert.match(parent,/center_export_publisher_test_request/);
 assert.match(parent,/Cen04CorporateIntakePanel/);
 assert.match(child,/center_cen04_corporate_t3_enroll/);
 assert.match(child,/center_cen04_corporate_t3_receive/);
 assert.match(child,/center_cen04_corporate_t3_read/);
 assert.match(child,/inspectCorporatePinnedTrust/);
 assert.match(child,/ALREADY_RECEIVED/);
 assert.doesNotMatch(child,/openSubjectScopedStore|signCorporateLicenseCandidate/);
});
test('original Windows Consumer remains single SHA-256-pinned executable',()=>{
 const adapter=readFileSync('native/t3_product_component.rs','utf8');
 const native=readFileSync('src-tauri/src/t3_consumer.rs','utf8');
 const main=readFileSync('src-tauri/src/main.rs','utf8');
 assert.match(adapter,/"consumer-corporate" => Ok\(\("iwxa-t3-product-consumer.exe", "t3-consumer-test"\)\)/);
 assert.match(native,/t3::run\(&app,"consumer-corporate"/);
 assert.match(native,/CORPORATE_NATIVE_SCHEMA/);
 assert.match(main,/t3_consumer::center_cen04_corporate_t3_receive/);
 assert.match(main,/center_export_publisher_test_request/);
});
