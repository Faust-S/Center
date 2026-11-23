// A native Center Tauri port to the separately packaged ORIGINAL T3
// ProductLicenseConsumer. Only the T3 component verifies Ed25519, preinstalled
// out-of-band trust, signed status floors, encrypted Store and durable readback.
// Public Center does not implement/license issuer, verifier or secret vault.
use serde_json::Value;
use tauri::AppHandle;
use crate::t3_product_component as t3;

fn scope(organization_id:&str)->Result<String,String>{
  if !t3::valid_identifier(organization_id){
    return Err("CEN04_T3_ORGANIZATION_REQUIRED".into());
  }
  Ok(organization_id.to_owned())
}
async fn invoke_t3(app:AppHandle,action:&'static str,org:String,more:Vec<String>)
 ->Result<Value,String>{
  let mut args=vec![org];
  args.extend(more);
  tauri::async_runtime::spawn_blocking(move||
    t3::run(&app,"consumer",action,&args))
    .await.map_err(|_|"CEN04_T3_NATIVE_WORKER_FAILED".to_string())?
}
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// Never present a saved row as signature-verified unless every row returned
// by the ORIGINAL T3 Consumer passes the native boundary checks. Historical
// signed status verification and storage still belong exclusively to T3.
fn verify_readback(value:&Value,org:&str)->Result<(),String>{
  t3::validate_test_result(value,"TEST_READ")?;
  let view=&value["view"];
  if view["schema"]!="IWXA_T3_PRODUCT_LICENSE_CONSUMER_VIEW/1" ||
     view["organizationId"]!=org || view["productId"]!="IWXA_ADMIN_CENTER" ||
     view["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY" ||
     view["revision"].as_u64().is_none_or(|n|n>MAX_SAFE_INTEGER) ||
     view["productionActivation"]!=false || view["activeSeats"]!=0 ||
     view["assignableSeats"]!=0 {
    return Err("CEN04_T3_NATIVE_VERIFIED_READBACK_REQUIRED".into());
  }
  let licenses=view["licenses"].as_array()
    .ok_or("CEN04_T3_NATIVE_VERIFIED_READBACK_REQUIRED")?;
  let mut seen=std::collections::HashSet::new();
  for license in licenses {
    let license_id=license["licenseId"].as_str()
      .ok_or("CEN04_T3_NATIVE_UNVERIFIED_LICENSE_ROW")?;
    if !t3::valid_identifier(license_id) || !seen.insert(license_id) ||
       license["organizationId"]!=org ||
       license["productId"]!="IWXA_ADMIN_CENTER" ||
       !matches!(license["status"].as_str(),Some("ACTIVE"|"SUSPENDED"|"REVOKED")) ||
       license["sequence"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER) ||
       license["claimedSeats"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER) ||
       license["signatureVerified"]!=true || license["statusVerified"]!=true ||
       license["commercialAuthorityProven"]!=false ||
       license["productionActivation"]!=false ||
       license["activeSeats"]!=0 || license["assignableSeats"]!=0 {
      return Err("CEN04_T3_NATIVE_UNVERIFIED_LICENSE_ROW".into());
    }
  }
  Ok(())
}
fn verify_received(value:&Value,org:&str)->Result<(),String>{
  t3::validate_test_result(value,"TEST_RECEIVE")?;
  let id=value["licenseId"].as_str().unwrap_or("");
  if value["organizationId"]!=org || !t3::valid_identifier(id) ||
     !matches!(value["status"].as_str(),Some("ACTIVE"|"SUSPENDED"|"REVOKED")) ||
     !matches!(value["outcome"].as_str(),Some("VERIFIED_TEST_SAVED"|"ALREADY_RECEIVED")) ||
     value["sequence"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER) ||
     value["revision"].as_u64().is_none_or(|n|n>MAX_SAFE_INTEGER) ||
     value["signatureVerified"]!=true || value["statusVerified"]!=true ||
     value["activeSeats"]!=0 || value["assignableSeats"]!=0 ||
     value["productionActivation"]!=false {
    return Err("CEN04_T3_NATIVE_SIGNED_RECEIPT_REQUIRED".into());
  }
  Ok(())
}

// First use is an independent user action, never an effect of importing a
// license. The original T3 checks an out-of-band SHA-256 public trust pin and
// provisions a Windows CurrentUser DPAPI key with no private material in IPC.
#[tauri::command]
pub async fn center_cen04_t3_enroll(app:AppHandle,organization_id:String,
 expected_sha256:String)->Result<Option<Value>,String>{
  let org=scope(&organization_id)?;
  if expected_sha256.len()!=64 ||
     !expected_sha256.bytes().all(|b| b.is_ascii_digit() ||
        (b'a'..=b'f').contains(&b)) {
    return Err("CEN04_T3_TRUST_FINGERPRINT_REQUIRED".into());
  }
  let selected=rfd::FileDialog::new()
    .set_title("Admin Center — выбрать публичное доверие издателя T3")
    .add_filter("T3 public trust",&["json"]).pick_file();
  let Some(path)=selected else{return Ok(None)};
  if path.file_name().and_then(|f|f.to_str())!=Some("publisher-test-trust.json"){
    return Err("CEN04_T3_TRUST_FILE_NAME_INVALID".into());
  }
  let info=std::fs::symlink_metadata(&path)
    .map_err(|_|"CEN04_T3_TRUST_FILE_UNREADABLE")?;
  if !info.is_file() || info.file_type().is_symlink() ||
     info.len()<3 || info.len()>1024*1024 {
    return Err("CEN04_T3_TRUST_FILE_SIZE_INVALID".into());
  }
  let receipt=invoke_t3(app,"test-enroll",org.clone(),
    vec![path.to_string_lossy().into_owned(),expected_sha256.clone()]).await?;
  t3::validate_test_result(&receipt,"TEST_ENROLLED")?;
  if receipt["organizationId"]!=Value::String(org) ||
     receipt["fingerprint"]!=Value::String(expected_sha256) ||
     receipt["intakeConfigured"]!=true || receipt["publicOnly"]!=true ||
     receipt["assignableSeats"]!=0 {
    return Err("CEN04_T3_FIRST_USE_RECEIPT_INVALID".into());
  }
  Ok(Some(receipt))
}

#[tauri::command]
pub async fn center_cen04_t3_capabilities(app:AppHandle,organization_id:String)
 ->Result<Value,String>{
  let org=scope(&organization_id)?;
  // Only the original T3 Consumer decides whether out-of-band trust and its
  // Windows CurrentUser store are preconfigured. No prior status is declared
  // current just because intake is configured.
  let value=invoke_t3(app,"capabilities",org.clone(),vec![]).await?;
  t3::validate_test_result(&value,"TEST_CAPABILITIES")?;
  if value["organizationId"]!=Value::String(org) ||
     value["productId"]!="IWXA_ADMIN_CENTER" ||
     value["intakeConfigured"]!=true ||
     value["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY" ||
     value["assignableSeats"]!=0 {
    return Err("CEN04_T3_NATIVE_INTAKE_CAPABILITIES_REQUIRED".into());
  }
  Ok(value)
}
#[tauri::command]
pub async fn center_cen04_t3_read(app:AppHandle,organization_id:String)->Result<Value,String>{
  let org=scope(&organization_id)?;
  let value=invoke_t3(app,"read",org.clone(),vec![]).await?;
  verify_readback(&value,&org)?;
  Ok(value)
}
#[tauri::command]
pub async fn center_cen04_t3_import(app:AppHandle,organization_id:String)
 ->Result<Option<Value>,String>{
  let org=scope(&organization_id)?;
  if !t3::availability(&app,"consumer"){
    return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
  }
  let choice=rfd::FileDialog::new()
    .set_title("Admin Center — проверить подписанную TEST лицензию .iwxa")
    .add_filter("IWXA",&["iwxa"]).pick_file();
  let Some(path)=choice else{return Ok(None)};
  if !path.extension().and_then(|x|x.to_str())
      .is_some_and(|x|x.eq_ignore_ascii_case("iwxa")){
    return Err("CEN04_T3_IWXA_EXTENSION_REQUIRED".into());
  }
  let size=std::fs::metadata(&path).map_err(|_|"CEN04_T3_IWXA_UNREADABLE")?;
  if !size.is_file()||size.len()==0||size.len()>4*1024*1024{
    return Err("CEN04_T3_IWXA_SIZE_INVALID".into());
  }
  let receipt=invoke_t3(app,"receive",org.clone(),
    vec![path.to_string_lossy().into_owned()]).await?;
  verify_received(&receipt,&org)?;
  Ok(Some(receipt))
}

// One product action: select encrypted delivery -> original T3 X25519/DPAPI
// decrypt -> original signed license Consumer.receiveIwxa -> durable readback.
// The plaintext never crosses IPC and its temporary file is removed on exit.
#[tauri::command]
pub async fn center_cen04_t3_import_age(app:AppHandle,organization_id:String)
 ->Result<Option<Value>,String>{
  let org=scope(&organization_id)?;
  // Choose the file on the same native command path used for ordinary .iwxa.
  // Only the subsequent bounded decrypt + original T3 verifier need a
  // blocking worker. The modal picker never enters that worker.
  if !t3::availability(&app,"consumer"){
    return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
  }
  let selected=rfd::FileDialog::new()
    .set_title("Admin Center — получить защищённую лицензию .iwxa.age")
    .add_filter("IWXA age",&["age"]).pick_file();
  let Some(source)=selected else{return Ok(None)};
  tauri::async_runtime::spawn_blocking(move||{
    let temporary=crate::t3_age_transport::TransientPackage::new()?;
    let age_root=crate::center_age_data_root(&app)?;
    let transport=crate::t3_age_transport::decrypt_source(
      &app,&age_root,&source,&temporary.path)?;
    if transport["admitted"]!=false ||
       transport["state"]!="DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED" ||
       !transport["bytes"].as_u64().is_some_and(|n|n>0 && n<=4*1024*1024) {
      return Err("CEN04_T3_AGE_TRANSPORT_UNVERIFIED".into());
    }
    // Original T3 has its own preinstalled trust, signed status, anti-rollback
    // and encrypted SubjectScopedStore; age transport alone grants nothing.
    let result=t3::run(&app,"consumer","receive", &[
      org.clone(),temporary.path.to_string_lossy().into_owned()
    ])?;
    verify_received(&result,&org)?;
    Ok(Some(result))
  }).await.map_err(|_|"CEN04_T3_AGE_WORKER_FAILED".to_string())?
}

// Transport integrity only: the original T3 has not yet provided its
// CORPORATE ProductLicenseConsumer. No package is parsed, no trust is enrolled,
// no license is admitted, and no rights or recipient receipt are created.
const CORPORATE_CARRIER_LIMIT:u64=4*1024*1024;

fn inspect_corporate_file_hash(
 path:&std::path::Path,org:&str,expected_sha256:&str,expected_bytes:u64
)->Result<Value,String>{
 use sha2::{Digest,Sha256};
 use std::io::Read;
 scope(org)?;
 if expected_sha256.len()!=64||
    !expected_sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) {
   return Err("CEN04_CORPORATE_CARRIER_SHA256_REQUIRED".into());
 }
 if expected_bytes==0||expected_bytes>CORPORATE_CARRIER_LIMIT{
   return Err("CEN04_CORPORATE_CARRIER_SIZE_REQUIRED".into());
 }
 if !path.extension().and_then(|p|p.to_str())
   .is_some_and(|x|x.eq_ignore_ascii_case("iwxa")) {
   return Err("CEN04_CORPORATE_CARRIER_IWXA_REQUIRED".into());
 }
 let info=std::fs::symlink_metadata(path)
   .map_err(|_|"CEN04_CORPORATE_CARRIER_UNREADABLE")?;
 if !info.is_file()||info.file_type().is_symlink()||
    info.len()!=expected_bytes {
   return Err("CEN04_CORPORATE_CARRIER_FILE_SIZE_MISMATCH".into());
 }
 let mut file=std::fs::File::open(path)
   .map_err(|_|"CEN04_CORPORATE_CARRIER_UNREADABLE")?;
 let mut hash=Sha256::new();
 let mut read=0u64;
 let mut chunk=[0_u8;8192];
 loop{
   let n=file.read(&mut chunk)
     .map_err(|_|"CEN04_CORPORATE_CARRIER_READ_INTERRUPTED")?;
   if n==0{break;}
   read=read.checked_add(n as u64)
     .ok_or("CEN04_CORPORATE_CARRIER_SIZE_INVALID")?;
   if read>CORPORATE_CARRIER_LIMIT {
     return Err("CEN04_CORPORATE_CARRIER_SIZE_INVALID".into());
   }
   hash.update(&chunk[..n]);
 }
 if read!=expected_bytes||file.metadata()
   .map_err(|_|"CEN04_CORPORATE_CARRIER_UNREADABLE")?.len()!=read{
   return Err("CEN04_CORPORATE_CARRIER_CHANGED_DURING_READ".into());
 }
 let actual=format!("{:x}",hash.finalize());
 if actual!=expected_sha256{
   return Err("CEN04_CORPORATE_CARRIER_SHA256_MISMATCH".into());
 }
 Ok(serde_json::json!({
   "operation":"CORPORATE_CARRIER_SHA256_MATCHED",
   "organizationId":org,"productId":"IWXA_ADMIN_CENTER",
   "packageSha256":actual,"bytes":read,
   "signatureVerified":false,"statusVerified":false,
   "recipientConfirmed":false,"activeSeats":0,
   "assignablePersonalAgentSeats":0,"productionActivation":false
 }))
}

// The native picker keeps the file path and entire .iwxa opaque to React.
// A checksum match proves *transport bytes*, not a T3 signature or entitlement.
#[tauri::command]
pub async fn center_cen04_corporate_verify_carrier(
 organization_id:String,expected_sha256:String,expected_bytes:u64
)->Result<Option<Value>,String>{
 let org=scope(&organization_id)?;
 if expected_sha256.len()!=64||
   !expected_sha256.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))||
   expected_bytes==0||expected_bytes>CORPORATE_CARRIER_LIMIT{
   return Err("CEN04_CORPORATE_CARRIER_EXPECTATION_REQUIRED".into());
 }
 let chosen=rfd::FileDialog::new()
   .set_title("Admin Center - сверить корпоративный файл Publisher")
   .add_filter("IWXA",&["iwxa"]).pick_file();
 let Some(path)=chosen else{return Ok(None)};
 tauri::async_runtime::spawn_blocking(move||
   inspect_corporate_file_hash(&path,&org,&expected_sha256,expected_bytes)
     .map(Some))
   .await.map_err(|_|"CEN04_CORPORATE_CARRIER_WORKER_FAILED".to_string())?
}

// Corporate PRODUCTION is NOT an alias of the TEST Consumer. It runs
// through the same SHA-256-pinned ORIGINAL T3 executable, with its own
// independently enrolled public trust, organization DPAPI custody and
// ORIGINAL SubjectScopedStore. No signature or seat logic lives in Center.
const CORPORATE_NATIVE_SCHEMA:&str="IWXA_T3_CORPORATE_CONSUMER_NATIVE_RECEIPT/1";
fn corporate_hex(s:&str)->bool{
  s.len()==64&&s.bytes().all(|x|x.is_ascii_digit()||(b'a'..=b'f').contains(&x))
}
fn corporate_opaque_read(receipt:&Value,org:&str)->Result<(),String>{
  if receipt["schema"]!=CORPORATE_NATIVE_SCHEMA||
     receipt["operation"]!="CORPORATE_READ"||
     receipt["activeSeats"]!=0||
     receipt["assignablePersonalAgentSeats"]!=0||
     receipt["productionActivation"]!=false {
    return Err("CEN04_CORPORATE_ORIGINAL_READ_REQUIRED".into());
  }
  let view=&receipt["view"];
  if view["schema"]!="IWXA_T3_CORPORATE_PRODUCT_LICENSE_CONSUMER_VIEW/1"||
     view["organizationId"]!=org||
     view["productId"]!="IWXA_ADMIN_CENTER"||
     view["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY"||
     view["revision"].as_u64().is_none_or(|n|n>MAX_SAFE_INTEGER)||
     view["activeSeats"]!=0||
     view["assignablePersonalAgentSeats"]!=0||
     view["productionActivation"]!=false {
    return Err("CEN04_CORPORATE_ORIGINAL_VIEW_INVALID".into());
  }
  let rows=view["licenses"].as_array()
    .ok_or("CEN04_CORPORATE_ORIGINAL_LICENSES_REQUIRED")?;
  let mut ids=std::collections::HashSet::new();
  for row in rows {
    let license_id=row["licenseId"].as_str().unwrap_or("");
    if !t3::valid_identifier(license_id)||!ids.insert(license_id)||
       row["organizationId"]!=org||
       row["productId"]!="IWXA_ADMIN_CENTER"||
       !t3::valid_identifier(row["requestId"].as_str().unwrap_or(""))||
       !t3::valid_identifier(row["issuerAuthorityId"].as_str().unwrap_or(""))||
       !t3::valid_identifier(row["tariffId"].as_str().unwrap_or(""))||
       row["tariffRevision"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER)||
       !matches!(row["status"].as_str(),
         Some("ACTIVE"|"SUSPENDED"|"REVOKED"|"EXPIRED"|"STATUS_STALE"))||
       row["sequence"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER)||
       row["signatureVerified"]!=true||
       row["statusVerified"]!=true||
       row["recipientConfirmed"]!=true||
       row["originalHolderReceiptRequired"]!=true||
       row["current"].as_bool().is_none()||
       row["activeSeats"]!=0||
       row["assignablePersonalAgentSeats"]!=0||
       row["productionActivation"]!=false {
      return Err("CEN04_CORPORATE_ORIGINAL_LICENSE_ROW_INVALID".into());
    }
  }
  Ok(())
}
fn corporate_received(receipt:&Value,org:&str,sha:&str)->Result<(),String>{
  if receipt["schema"]!=CORPORATE_NATIVE_SCHEMA||
     receipt["operation"]!="CORPORATE_RECEIVE"||
     receipt["organizationId"]!=org||
     receipt["productId"]!="IWXA_ADMIN_CENTER"||
     receipt["packageSha256"]!=sha||
     !corporate_hex(receipt["storedPackageSha256"].as_str().unwrap_or(""))||
     !matches!(receipt["outcome"].as_str(),
       Some("VERIFIED_CORPORATE_SAVED"|"ALREADY_RECEIVED"))||
     !matches!(receipt["status"].as_str(),
       Some("ACTIVE"|"SUSPENDED"|"REVOKED"|"EXPIRED"|"STATUS_STALE"))||
     receipt["sequence"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER)||
     receipt["revision"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER)||
     !t3::valid_identifier(receipt["licenseId"].as_str().unwrap_or(""))||
     !t3::valid_identifier(receipt["requestId"].as_str().unwrap_or(""))||
     !t3::valid_identifier(receipt["issuerAuthorityId"].as_str().unwrap_or(""))||
     !t3::valid_identifier(receipt["tariffId"].as_str().unwrap_or(""))||
     receipt["tariffRevision"].as_u64().is_none_or(|n|n==0||n>MAX_SAFE_INTEGER)||
     receipt["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY"||
     receipt["signatureVerified"]!=true||
     receipt["statusVerified"]!=true||
     receipt["statusFloorVerified"]!=true||
     receipt["signedLicenseAccepted"]!=true||
     receipt["recipientConfirmed"]!=true||
     receipt["originalHolderReceiptRequired"]!=true||
     receipt["holderApplied"]!=false||
     receipt["activeSeats"]!=0||
     receipt["assignablePersonalAgentSeats"]!=0||
     receipt["productionActivation"]!=false{
    return Err("CEN04_CORPORATE_ORIGINAL_SIGNED_RECEIPT_REQUIRED".into());
  }
  Ok(())
}
async fn corporate_t3(app:AppHandle,action:&'static str,
  organization_id:String,more:Vec<String>)->Result<Value,String>{
  let mut args=vec![organization_id];
  args.extend(more);
  tauri::async_runtime::spawn_blocking(move||
    t3::run(&app,"consumer-corporate",action,&args))
    .await.map_err(|_|"CEN04_CORPORATE_ORIGINAL_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_cen04_corporate_t3_enroll(
 app:AppHandle,organization_id:String,expected_sha256:String
)->Result<Option<Value>,String>{
  let org=scope(&organization_id)?;
  if !corporate_hex(&expected_sha256){
    return Err("CEN04_CORPORATE_PUBLIC_TRUST_SHA256_REQUIRED".into());
  }
  // First use needs only the exact independently pinned ORIGINAL T3 EXE,
  // not any previously provisioned publisher trust or local DPAPI key.
  if !t3::availability(&app,"consumer-corporate"){
    return Err("CEN04_CORPORATE_ORIGINAL_CONSUMER_NOT_BUNDLED".into());
  }
  let file=rfd::FileDialog::new()
    .set_title("Admin Center - выбрать публичное доверие корпоративного издателя")
    .add_filter("T3 public trust",&["json"]).pick_file();
  let Some(path)=file else{return Ok(None)};
  if path.file_name().and_then(|x|x.to_str())!=Some("publisher-corporate-trust.json"){
    return Err("CEN04_CORPORATE_PUBLIC_TRUST_FILE_NAME_INVALID".into());
  }
  let meta=std::fs::symlink_metadata(&path)
    .map_err(|_|"CEN04_CORPORATE_PUBLIC_TRUST_UNREADABLE")?;
  if !meta.is_file()||meta.file_type().is_symlink()||
     meta.len()<3||meta.len()>1024*1024{
    return Err("CEN04_CORPORATE_PUBLIC_TRUST_FILE_INVALID".into());
  }
  let v=corporate_t3(app,"corporate-enroll",org.clone(),
    vec![path.to_string_lossy().into_owned(),expected_sha256.clone()]).await?;
  if v["schema"]!=CORPORATE_NATIVE_SCHEMA||
     v["operation"]!="CORPORATE_ENROLLED"||
     v["organizationId"]!=org||
     v["fingerprint"]!=expected_sha256||
     v["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY"||
     v["intakeConfigured"]!=true||
     v["publicOnly"]!=true||
     v["recipientConfirmed"]!=false||
     v["activeSeats"]!=0||
     v["assignablePersonalAgentSeats"]!=0||
     v["productionActivation"]!=false{
    return Err("CEN04_CORPORATE_ORIGINAL_ENROLL_RECEIPT_INVALID".into());
  }
  Ok(Some(v))
}
#[tauri::command]
pub async fn center_cen04_corporate_t3_capabilities(
 app:AppHandle,organization_id:String
)->Result<Value,String>{
  let org=scope(&organization_id)?;
  let v=corporate_t3(app,"corporate-capabilities",org.clone(),vec![]).await?;
  if v["schema"]!=CORPORATE_NATIVE_SCHEMA||
     v["operation"]!="CORPORATE_CAPABILITIES"||
     v["organizationId"]!=org||
     v["productId"]!="IWXA_ADMIN_CENTER"||
     v["intakeConfigured"]!=true||
     v["trustOrigin"]!="HOST_PREINSTALLED_PUBLIC_POLICY"||
     v["recipientConfirmed"]!=false||
     v["activeSeats"]!=0||
     v["assignablePersonalAgentSeats"]!=0||
     v["productionActivation"]!=false{
    return Err("CEN04_CORPORATE_ORIGINAL_CAPABILITIES_INVALID".into());
  }
  Ok(v)
}
#[tauri::command]
pub async fn center_cen04_corporate_t3_read(
 app:AppHandle,organization_id:String
)->Result<Value,String>{
  let org=scope(&organization_id)?;
  let v=corporate_t3(app,"corporate-read",org.clone(),vec![]).await?;
  corporate_opaque_read(&v,&org)?;
  Ok(v)
}
#[tauri::command]
pub async fn center_cen04_corporate_t3_receive(
 app:AppHandle,organization_id:String,
 expected_sha256:String,expected_bytes:u64
)->Result<Option<Value>,String>{
  let org=scope(&organization_id)?;
  if !corporate_hex(&expected_sha256)||
     expected_bytes==0||expected_bytes>CORPORATE_CARRIER_LIMIT{
    return Err("CEN04_CORPORATE_EXPECTED_PACKAGE_REQUIRED".into());
  }
  if !t3::availability(&app,"consumer-corporate"){
    return Err("CEN04_CORPORATE_ORIGINAL_CONSUMER_NOT_BUNDLED".into());
  }
  let path=rfd::FileDialog::new()
    .set_title("Admin Center - получить подписанный корпоративный .iwxa через T3")
    .add_filter("IWXA",&["iwxa"]).pick_file();
  let Some(selected)=path else{return Ok(None)};
  if !selected.extension().and_then(|x|x.to_str())
    .is_some_and(|x|x.eq_ignore_ascii_case("iwxa")){
    return Err("CEN04_CORPORATE_IWXA_EXTENSION_REQUIRED".into());
  }
  let info=std::fs::symlink_metadata(&selected)
    .map_err(|_|"CEN04_CORPORATE_IWXA_UNREADABLE")?;
  if !info.is_file()||info.file_type().is_symlink()||
     info.len()!=expected_bytes {
    return Err("CEN04_CORPORATE_IWXA_SIZE_MISMATCH".into());
  }
  // The original T3 Host independently hashes and verifies THESE SAME
  // read bytes against the expected Publisher fingerprint before durable
  // receipt. The prior GUI file-check result is not trusted here.
  let v=corporate_t3(app,"corporate-receive",org.clone(),vec![
    selected.to_string_lossy().into_owned(),
    expected_sha256.clone(),expected_bytes.to_string()
  ]).await?;
  corporate_received(&v,&org,&expected_sha256)?;
  Ok(Some(v))
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn corporate_carrier_matches_exact_publisher_digest_without_grant(){
    use sha2::{Digest,Sha256};
    let base=std::env::temp_dir().join(format!(
      "center-cen04-corporate-{}",uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&base).unwrap();
    let path=base.join("original.iwxa");
    let bytes=b"opaque original T3 carrier bytes - not parsed here";
    std::fs::write(&path,bytes).unwrap();
    let digest=format!("{:x}",Sha256::digest(bytes));
    let value=inspect_corporate_file_hash(&path,"org:north",&digest,bytes.len() as u64).unwrap();
    assert_eq!(value["operation"],"CORPORATE_CARRIER_SHA256_MATCHED");
    assert_eq!(value["organizationId"],"org:north");
    assert_eq!(value["productId"],"IWXA_ADMIN_CENTER");
    assert_eq!(value["packageSha256"],digest);
    assert_eq!(value["bytes"],bytes.len() as u64);
    for key in ["signatureVerified","statusVerified","recipientConfirmed",
      "productionActivation"]{assert_eq!(value[key],false);}
    assert_eq!(value["activeSeats"],0);
    assert_eq!(value["assignablePersonalAgentSeats"],0);
    assert!(value.get("licenseId").is_none());
    assert!(value.get("entitlement").is_none());
    assert!(inspect_corporate_file_hash(
      &path,"org:north",&"0".repeat(64),bytes.len() as u64).is_err());
    assert!(inspect_corporate_file_hash(
      &path,"org:north",&digest,bytes.len() as u64+1).is_err());
    assert!(inspect_corporate_file_hash(
      &path,"../another",&digest,bytes.len() as u64).is_err());
    assert!(inspect_corporate_file_hash(
      &path,"org:north","BAD",bytes.len() as u64).is_err());
    assert!(inspect_corporate_file_hash(
      &path,"org:north",&digest,0).is_err());
    let other=base.join("draft.json");
    std::fs::write(&other,bytes).unwrap();
    assert!(inspect_corporate_file_hash(
      &other,"org:north",&digest,bytes.len() as u64).is_err());
    std::fs::remove_dir_all(base).unwrap();
  }
  #[test]
  fn original_corporate_receipt_requires_independent_production_signature_and_zero_seats(){
    let sha="a".repeat(64);
    let original="b".repeat(64);
    let good=serde_json::json!({
      "schema":CORPORATE_NATIVE_SCHEMA,
      "operation":"CORPORATE_RECEIVE","organizationId":"org:company",
      "productId":"IWXA_ADMIN_CENTER",
      "licenseId":"license:one","requestId":"request:one",
      "issuerAuthorityId":"publisher:original","tariffId":"TEAM",
      "tariffRevision":2,"status":"ACTIVE","sequence":1,"revision":1,
      "outcome":"VERIFIED_CORPORATE_SAVED","packageSha256":sha,
      "storedPackageSha256":original,
      "trustOrigin":"HOST_PREINSTALLED_PUBLIC_POLICY",
      "signatureVerified":true,"statusVerified":true,
      "statusFloorVerified":true,"signedLicenseAccepted":true,
      "recipientConfirmed":true,"originalHolderReceiptRequired":true,
      "holderApplied":false,"activeSeats":0,
      "assignablePersonalAgentSeats":0,"productionActivation":false
    });
    assert!(corporate_received(&good,"org:company",&sha).is_ok());
    assert!(corporate_received(&good,"org:wrong",&sha).is_err());
    assert!(corporate_received(&good,"org:company",&"c".repeat(64)).is_err());
    for (field,forged) in [
      ("operation",Value::String("TEST_RECEIVE".into())),
      ("signatureVerified",Value::Bool(false)),
      ("statusVerified",Value::Bool(false)),
      ("statusFloorVerified",Value::Bool(false)),
      ("signedLicenseAccepted",Value::Bool(false)),
      ("recipientConfirmed",Value::Bool(false)),
      ("holderApplied",Value::Bool(true)),
      ("productionActivation",Value::Bool(true)),
      ("activeSeats",Value::from(1)),
      ("assignablePersonalAgentSeats",Value::from(1)),
      ("status",Value::String("NOT_SIGNED".into())),
      ("revision",Value::from(0))
    ]{
      let mut invalid=good.clone();
      invalid[field]=forged;
      assert!(corporate_received(&invalid,"org:company",&sha).is_err(),
        "field {field}");
    }
  }
  #[test]
  fn original_corporate_view_keeps_historical_status_and_employer_scope(){
    let valid=serde_json::json!({
      "schema":CORPORATE_NATIVE_SCHEMA,"operation":"CORPORATE_READ",
      "activeSeats":0,"assignablePersonalAgentSeats":0,"productionActivation":false,
      "view":{"schema":"IWXA_T3_CORPORATE_PRODUCT_LICENSE_CONSUMER_VIEW/1",
        "organizationId":"org:company","productId":"IWXA_ADMIN_CENTER",
        "revision":2,"trustOrigin":"HOST_PREINSTALLED_PUBLIC_POLICY",
        "activeSeats":0,"assignablePersonalAgentSeats":0,"productionActivation":false,
        "licenses":[{
          "licenseId":"license:one","requestId":"request:one",
          "issuerAuthorityId":"publisher:original","organizationId":"org:company",
          "productId":"IWXA_ADMIN_CENTER","tariffId":"TEAM","tariffRevision":1,
          "status":"STATUS_STALE","sequence":2,
          "signatureVerified":true,"statusVerified":true,
          "recipientConfirmed":true,"originalHolderReceiptRequired":true,
          "current":false,"activeSeats":0,
          "assignablePersonalAgentSeats":0,"productionActivation":false
        }]
      }
    });
    assert!(corporate_opaque_read(&valid,"org:company").is_ok());
    assert!(corporate_opaque_read(&valid,"org:other").is_err());
    let mut wrong=valid.clone();
    wrong["view"]["licenses"][0]["organizationId"]=Value::String("org:other".into());
    assert!(corporate_opaque_read(&wrong,"org:company").is_err());
    let mut duplicate=valid.clone();
    let row=duplicate["view"]["licenses"][0].clone();
    duplicate["view"]["licenses"].as_array_mut().unwrap().push(row);
    assert!(corporate_opaque_read(&duplicate,"org:company").is_err());
    let mut forged=valid.clone();
    forged["view"]["licenses"][0]["activeSeats"]=Value::from(2);
    assert!(corporate_opaque_read(&forged,"org:company").is_err());
  }
  fn valid_read()->Value{
    serde_json::json!({
      "operation":"TEST_READ","activeSeats":0,"productionActivation":false,
      "view":{
        "schema":"IWXA_T3_PRODUCT_LICENSE_CONSUMER_VIEW/1",
        "organizationId":"org:one","productId":"IWXA_ADMIN_CENTER",
        "trustOrigin":"HOST_PREINSTALLED_PUBLIC_POLICY","revision":1,
        "activeSeats":0,"assignableSeats":0,"productionActivation":false,
        "licenses":[{
          "licenseId":"license:test:one","organizationId":"org:one",
          "productId":"IWXA_ADMIN_CENTER","status":"ACTIVE",
          "sequence":1,"claimedSeats":2,"signatureVerified":true,
          "statusVerified":true,"commercialAuthorityProven":false,
          "productionActivation":false,"activeSeats":0,"assignableSeats":0
        }]
      }
    })
  }
  #[test]
  fn readback_refuses_unverified_license_rows_and_duplicates(){
    let good=valid_read();
    assert!(verify_readback(&good,"org:one").is_ok());
    assert!(verify_readback(&good,"org:other").is_err());
    for (field,forged) in [
      ("signatureVerified",Value::Bool(false)),
      ("statusVerified",Value::Bool(false)),
      ("productionActivation",Value::Bool(true)),
      ("activeSeats",Value::from(3)),
      ("status",Value::String("PENDING".into())),
      ("sequence",Value::from(0))
    ] {
      let mut bad=good.clone();
      bad["view"]["licenses"][0][field]=forged;
      assert!(verify_readback(&bad,"org:one").is_err(),"field {field}");
    }
    let mut duplicate=good.clone();
    let row=duplicate["view"]["licenses"][0].clone();
    duplicate["view"]["licenses"].as_array_mut().unwrap().push(row);
    assert!(verify_readback(&duplicate,"org:one").is_err());
  }
  #[test]
  fn receiving_requires_signed_durable_status_receipt(){
    let good=serde_json::json!({
      "operation":"TEST_RECEIVE","organizationId":"org:one",
      "licenseId":"license:test:one","status":"REVOKED",
      "outcome":"VERIFIED_TEST_SAVED","sequence":2,"revision":2,
      "signatureVerified":true,"statusVerified":true,
      "activeSeats":0,"assignableSeats":0,"productionActivation":false
    });
    assert!(verify_received(&good,"org:one").is_ok());
    let mut invalid=good.clone();
    invalid["outcome"]=Value::String("UNVERIFIED".into());
    assert!(verify_received(&invalid,"org:one").is_err());
    invalid=good.clone();
    invalid["sequence"]=Value::from(1_000_000_000_000_000_000_u64);
    assert!(verify_received(&invalid,"org:one").is_err());
    invalid=good.clone();
    invalid["signatureVerified"]=Value::Bool(false);
    assert!(verify_received(&invalid,"org:one").is_err());
  }
}
