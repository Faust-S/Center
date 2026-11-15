// Publisher's native UI uses only the privately built original T3 Owner
// executable. The public Center repo does not contain a signer or private T3
// source, and never falls back to an installed Node executable.
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path,PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use crate::t3_product_component as t3;

async fn call(app:AppHandle,action:&'static str,values:Vec<String>)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||t3::run(&app,"owner",action,&values))
      .await.map_err(|_|"PUBLISHER_T3_WORKER_FAILED".to_string())?
}
#[tauri::command]
pub async fn publisher_t3_capabilities(app:AppHandle)->Result<Value,String>{
    let v=call(app,"capabilities",vec![]).await?;
    t3::validate_test_result(&v,"TEST_CAPABILITIES")?;
    if !v.get("issuers").is_some_and(Value::is_array){
        return Err("PUBLISHER_T3_ISSUERS_REQUIRED".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_inventory(app:AppHandle,lookup_id:Option<String>)->Result<Value,String>{
    // The ORIGINAL Product Owner already supports bounded exact lookup for
    // old signed TEST licenses. Do not copy its ledger into Publisher.
    if lookup_id.as_deref().is_some_and(|id|!t3::valid_identifier(id)){
        return Err("PUBLISHER_T3_INVENTORY_LOOKUP_INVALID".into());
    }
    let args=lookup_id.iter().cloned().collect();
    let v=call(app,"inventory",args).await?;
    t3::validate_test_result(&v,"TEST_INVENTORY")?;
    if !v.get("licenses").is_some_and(Value::is_array){
        return Err("PUBLISHER_T3_INVENTORY_REQUIRED".into());
    }
    if let Some(id)=lookup_id.as_deref(){
        if v.get("lookupId").and_then(Value::as_str)!=Some(id)||
           v.get("matches").and_then(Value::as_u64).is_none(){
            return Err("PUBLISHER_T3_INVENTORY_LOOKUP_MISMATCH".into());
        }
    }
    Ok(v)
}
struct TransientRequest(PathBuf);
impl Drop for TransientRequest {
  fn drop(&mut self){let _=fs::remove_file(&self.0);}
}
#[tauri::command]
pub async fn publisher_t3_issue(app:AppHandle,request_json:String,issuer_authority_id:String)
 ->Result<Value,String>{
    super::validate_test_request(&request_json)?;
    let request:Value=serde_json::from_str(&request_json)
        .map_err(|_|"PUBLISHER_T3_REQUEST_JSON_INVALID")?;
    let request_id=request.get("requestId").and_then(Value::as_str)
        .ok_or("PUBLISHER_T3_REQUEST_ID_REQUIRED")?;
    if !t3::valid_identifier(&issuer_authority_id) {
        return Err("PUBLISHER_T3_ISSUER_INVALID".into());
    }
    if !t3::availability(&app,"owner"){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    let unique=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|"PUBLISHER_T3_TIME_INVALID")?.as_nanos();
    let file=std::env::temp_dir().join(format!(
        "iwxa-test-owner-request-{}-{}.json",std::process::id(),unique));
    {
      let mut handle=OpenOptions::new().write(true).create_new(true).open(&file)
         .map_err(|_|"PUBLISHER_T3_REQUEST_FILE_DENIED")?;
      handle.write_all(request_json.as_bytes())
         .map_err(|_|"PUBLISHER_T3_REQUEST_FILE_DENIED")?;
      handle.sync_all().map_err(|_|"PUBLISHER_T3_REQUEST_FILE_DENIED")?;
    }
    let _cleanup=TransientRequest(file.clone());
    let v=call(app,"issue",vec![file.to_string_lossy().into_owned(),issuer_authority_id]).await?;
    t3::validate_test_result(&v,"TEST_ISSUE")?;
    if !v.get("licenseId").and_then(Value::as_str).is_some_and(t3::valid_identifier) {
        return Err("PUBLISHER_T3_LICENSE_ID_REQUIRED".into());
    }
    if v.get("requestId").and_then(Value::as_str)!=Some(request_id) ||
       !matches!(v.get("outcome").and_then(Value::as_str),
                 Some("ISSUED_NEW"|"ALREADY_ISSUED")) {
        return Err("PUBLISHER_T3_ISSUE_RECEIPT_MISMATCH".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_change_status(app:AppHandle,license_id:String,next_status:String)
 ->Result<Value,String>{
    if !t3::valid_identifier(&license_id)||
       !["ACTIVE","SUSPENDED","REVOKED"].contains(&next_status.as_str()){
        return Err("PUBLISHER_T3_STATUS_INPUT_INVALID".into());
    }
    let v=call(app,"status",vec![license_id.clone(),next_status.clone()]).await?;
    t3::validate_test_result(&v,"TEST_STATUS")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("state").and_then(Value::as_str)!=Some(next_status.as_str()) ||
       !v.get("sequence").and_then(Value::as_u64).is_some_and(|n|n>0) {
        return Err("PUBLISHER_T3_STATUS_RECEIPT_MISMATCH".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_export(app:AppHandle,license_id:String)
 ->Result<Option<Value>,String>{
    if !t3::valid_identifier(&license_id){
        return Err("PUBLISHER_T3_LICENSE_ID_REQUIRED".into());
    }
    if !t3::availability(&app,"owner"){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    let selected=rfd::FileDialog::new()
        .set_title("Publisher — подписанная TEST лицензия .iwxa")
        .add_filter("IWXA",&["iwxa"])
        .set_file_name("iwxa-product-test-delivery.iwxa").save_file();
    let Some(path)=selected else{return Ok(None)};
    if !crate::is_iwxa_path(&path) {
        return Err("PUBLISHER_T3_EXPORT_IWXA_EXTENSION_REQUIRED".into());
    }
    if path.exists(){return Err("PUBLISHER_T3_EXPORT_OVERWRITE_DENIED".into());}
    let output_path=path.to_string_lossy().into_owned();
    let v=call(app,"export",vec![license_id.clone(),output_path.clone()]).await?;
    t3::validate_test_result(&v,"TEST_IWXA_EXPORTED")?;
    let declared=v.get("bytes").and_then(Value::as_u64)
        .ok_or("PUBLISHER_T3_EXPORT_SIZE_REQUIRED")?;
    let reported_hash=v.get("packageSha256").and_then(Value::as_str)
        .ok_or("PUBLISHER_T3_EXPORT_DIGEST_REQUIRED")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("path").and_then(Value::as_str)!=Some(output_path.as_str()) ||
       declared==0 || declared>4*1024*1024 ||
       reported_hash.len()!=64 ||
       !reported_hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)) {
        return Err("PUBLISHER_T3_EXPORT_RECEIPT_MISMATCH".into());
    }
    let metadata=fs::metadata(&path).map_err(|_|"PUBLISHER_T3_EXPORT_READBACK_MISSING")?;
    if !metadata.is_file() || metadata.len()!=declared {
        return Err("PUBLISHER_T3_EXPORT_SIZE_READBACK_MISMATCH".into());
    }
    let bytes=fs::read(&path).map_err(|_|"PUBLISHER_T3_EXPORT_READBACK_UNAVAILABLE")?;
    if bytes.len() as u64!=declared ||
       format!("{:x}",Sha256::digest(&bytes))!=reported_hash {
        return Err("PUBLISHER_T3_EXPORT_DIGEST_READBACK_MISMATCH".into());
    }
    Ok(Some(v))
}


// Public-only issuer trust export from the original T3 OWNER. The exported
// fingerprint is independently delivered to Admin Center before any signed
// license can be accepted. This command never provisions the recipient.
#[tauri::command]
pub async fn publisher_t3_export_test_trust(app:AppHandle)->Result<Option<Value>,String>{
    if !t3::availability(&app,"owner"){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    let selection=rfd::FileDialog::new()
       .set_title("Publisher — публичное доверие TEST-издателя")
       .add_filter("T3 public trust",&["json"])
       .set_file_name("publisher-test-trust.json").save_file();
    let Some(path)=selection else{return Ok(None)};
    if path.file_name().and_then(|p|p.to_str())!=Some("publisher-test-trust.json") ||
       path.exists() {
        return Err("PUBLISHER_TEST_TRUST_DESTINATION_INVALID".into());
    }
    let expected_path=path.to_string_lossy().into_owned();
    let result=call(app,"trust-export-test",vec![expected_path]).await?;
    t3::validate_test_result(&result,"TEST_TRUST_EXPORTED")?;
    if result["publicOnly"]!=true {
        return Err("PUBLISHER_TEST_TRUST_PRIVATE_MATERIAL_DENIED".into());
    }
    let bytes=result["bytes"].as_u64()
        .ok_or("PUBLISHER_TEST_TRUST_READBACK_REQUIRED")?;
    let digest=result["sha256"].as_str()
        .ok_or("PUBLISHER_TEST_TRUST_READBACK_REQUIRED")?;
    if bytes<3||bytes>1024*1024||digest.len()!=64||
       !digest.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("PUBLISHER_TEST_TRUST_RECEIPT_INVALID".into());
    }
    let stat=fs::symlink_metadata(&path)
        .map_err(|_|"PUBLISHER_TEST_TRUST_FILE_MISSING")?;
    if !stat.is_file()||stat.file_type().is_symlink()||stat.len()!=bytes {
        return Err("PUBLISHER_TEST_TRUST_FILE_CHANGED".into());
    }
    let actual=fs::read(&path).map_err(|_|"PUBLISHER_TEST_TRUST_READBACK_FAILED")?;
    if actual.len() as u64!=bytes ||
       format!("{:x}",Sha256::digest(&actual))!=digest ||
       actual.windows(11).any(|window|window==b"PRIVATE KEY"){
        return Err("PUBLISHER_TEST_TRUST_FILE_READBACK_INVALID".into());
    }
    Ok(Some(result))
}

// PERSON uses the original private T3 owner binary, but only the separately
// pre-enrolled production root. The public bridge never signs or imports trust.
const PERSON_REQUEST_LIMIT: usize = 32 * 1024;
// Checking only inside React leaves a second-window edit possible between
// the user preflight and the irreversible owner CLI invocation.
fn verify_person_draft_source(root:&Path,expected_sha256:&str)->Result<(),String>{
    if expected_sha256.len()!=64 || !expected_sha256.bytes().all(|b|
        b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("PUBLISHER_PERSON_EXPECTED_DRAFT_SHA256_INVALID".into());
    }
    let raw=crate::read_preparation(root)
        .map_err(|_|"PUBLISHER_PERSON_DRAFT_SOURCE_UNAVAILABLE")?
        .ok_or("PUBLISHER_PERSON_DRAFT_SOURCE_UNAVAILABLE")?;
    if format!("{:x}",Sha256::digest(raw.as_bytes()))!=expected_sha256 {
        return Err("PUBLISHER_DRAFT_CHANGED_ON_DISK".into());
    }
    Ok(())
}
// A second Publisher instance can save a new proposal after a SHA preflight
// but BEFORE the original T3 Owner finishes signing. Reuse the SAME Windows
// interprocess draft writer lock for the whole irreversible native issue.
// No signing, Store or trust logic is implemented here.
fn with_stable_person_draft_source<T>(
    root:&Path,expected_sha256:&str,
    issue:impl FnOnce()->Result<T,String>
)->Result<T,String>{
    #[cfg(windows)]
    let _draft_lock=crate::take_preparation_write_lock(root)?;
    verify_person_draft_source(root,expected_sha256)?;
    issue()
}
#[cfg(test)]
mod person_draft_issue_tests {
    use super::*;
    #[test]
    fn original_person_owner_never_receives_stale_or_missing_local_source(){
        let root=std::env::temp_dir().join(format!(
            "iwxa-publisher-person-draft-source-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let original=r#"{"format":"iwxa.publisher.preparation","version":1,"products":[],"holders":[],"proposals":[],"artifacts":[],"updatedAt":"2026-11-08T00:00:00.000Z"}"#;
        let hash=format!("{:x}",Sha256::digest(original.as_bytes()));
        assert_eq!(verify_person_draft_source(&root,&hash).unwrap_err(),
            "PUBLISHER_PERSON_DRAFT_SOURCE_UNAVAILABLE");
        crate::write_preparation(&root,original).unwrap();
        verify_person_draft_source(&root,&hash).unwrap();
        let updated=original.replace("\"products\":[]",
            "\"products\":[{\"id\":\"another-publisher\"}]");
        crate::write_preparation(&root,&updated).unwrap();
        assert_eq!(verify_person_draft_source(&root,&hash).unwrap_err(),
            "PUBLISHER_DRAFT_CHANGED_ON_DISK");
        let new_hash=format!("{:x}",Sha256::digest(updated.as_bytes()));
        verify_person_draft_source(&root,&new_hash).unwrap();
        assert_eq!(verify_person_draft_source(&root,"ABSENT").unwrap_err(),
            "PUBLISHER_PERSON_EXPECTED_DRAFT_SHA256_INVALID");
        let _=fs::remove_dir_all(&root);
    }
    #[cfg(windows)]
    #[test]
    fn person_issue_holds_existing_writer_lock_through_original_owner_call(){
        let root=std::env::temp_dir().join(format!(
            "iwxa-publisher-person-issue-writer-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let original=r#"{"format":"iwxa.publisher.preparation","version":2,"products":[],"holders":[],"tariffs":[],"proposals":[],"artifacts":[],"updatedAt":"2026-11-15T00:00:00.000Z"}"#;
        crate::write_preparation(&root,original).unwrap();
        let digest=format!("{:x}",Sha256::digest(original.as_bytes()));
        let updated=original.replace("\"products\":[]",
            "\"products\":[{\"id\":\"SECOND_PUBLISHER\"}]");
        let confirmed=with_stable_person_draft_source(&root,&digest,||{
            assert_eq!(crate::write_preparation_if_current(&root,&updated,&digest).unwrap_err(),
                "PUBLISHER_DRAFT_BUSY_OTHER_INSTANCE");
            assert_eq!(crate::draft_fingerprint(&root).unwrap(),digest);
            Ok("ORIGINAL_OWNER_CALLED")
        }).unwrap();
        assert_eq!(confirmed,"ORIGINAL_OWNER_CALLED");
        crate::write_preparation_if_current(&root,&updated,&digest).unwrap();
        let called=std::cell::Cell::new(false);
        assert_eq!(with_stable_person_draft_source(&root,&digest,||{
            called.set(true);
            Ok::<_,String>(())
        }).unwrap_err(),"PUBLISHER_DRAFT_CHANGED_ON_DISK");
        assert!(!called.get());
        assert_eq!(crate::read_preparation(&root).unwrap().as_deref(),Some(updated.as_str()));
        let _=fs::remove_dir_all(root);
    }
}
fn validate_person_request(raw:&str)->Result<Value,String>{
    if raw.is_empty() || raw.len()>PERSON_REQUEST_LIMIT {
        return Err("PUBLISHER_PERSON_REQUEST_SIZE_INVALID".into());
    }
    let value:Value=serde_json::from_str(raw)
        .map_err(|_|"PUBLISHER_PERSON_REQUEST_JSON_INVALID")?;
    let obj=value.as_object().ok_or("PUBLISHER_PERSON_REQUEST_FIELDS_INVALID")?;
    let keys=["schema","kind","requestId","requestedAt","environment",
        "subject","product","featureIds","termDays","seats",
        "deviceLimit","quotas","status"];
    // The original T3 schema supports one optional, strictly validated
    // renewal link. The public bridge does not decide whether that previous
    // request was issued: only the original T3 Owner ledger can do that.
    let renewal=obj.get("renewalOfRequestId");
    if obj.len()!=keys.len()+usize::from(renewal.is_some())||
       keys.iter().any(|k|!obj.contains_key(*k)) ||
        value["schema"]!="IWXA_PUBLISHER_PERSON_LICENSE_REQUEST/1" ||
        value["kind"]!="PERSON_LICENSE_REQUEST" ||
        value["environment"]!="PRODUCTION" ||
        value["status"]!="UNSIGNED_REQUEST" ||
        value["subject"]["type"]!="PERSON" ||
        value["seats"]!=1 {
        return Err("PUBLISHER_PERSON_REQUEST_PROFILE_INVALID".into());
    }
    let request=value["requestId"].as_str()
        .ok_or("PUBLISHER_PERSON_REQUEST_ID_INVALID")?;
    let holder=value["subject"]["id"].as_str()
        .ok_or("PUBLISHER_PERSON_SUBJECT_INVALID")?;
    let product=value["product"]["id"].as_str()
        .ok_or("PUBLISHER_PERSON_PRODUCT_INVALID")?;
    if let Some(prior)=renewal {
        let previous=prior.as_str().ok_or("PUBLISHER_PERSON_RENEWAL_ID_INVALID")?;
        if !t3::valid_identifier(previous)||previous==request{
            return Err("PUBLISHER_PERSON_RENEWAL_ID_INVALID".into());
        }
    }
    if !t3::valid_identifier(request) || !t3::valid_identifier(holder) ||
        holder.starts_with("holder:") ||
        !["IWXA_ATLAS","IWXA_PERSONAL_AGENT"].contains(&product) ||
        value["requestedAt"].as_str().is_none_or(str::is_empty) ||
        value["subject"]["name"].as_str().is_none_or(str::is_empty) ||
        value["product"]["version"].as_str().is_none_or(str::is_empty) ||
        value["featureIds"].as_array().is_none_or(|a|a.is_empty()||a.len()>30) ||
        value["quotas"].as_array().is_none_or(|a|a.len()>32) ||
        value["termDays"].as_u64().is_none_or(|n|n<1||n>3650) ||
        value["deviceLimit"].as_u64().is_none_or(|n|n<1||n>100) {
        return Err("PUBLISHER_PERSON_REQUEST_SCOPE_INVALID".into());
    }
    // T3 alone is the complete, authoritative source contract validator.
    Ok(value)
}
async fn call_person(app:AppHandle,action:&'static str,values:Vec<String>)
    ->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||
        t3::run(&app,"owner-person",action,&values))
        .await.map_err(|_|"PUBLISHER_PERSON_T3_WORKER_FAILED".to_string())?
}
#[tauri::command]
pub async fn publisher_t3_person_capabilities(app:AppHandle)->Result<Value,String>{
    let v=call_person(app,"person-capabilities",vec![]).await?;
    t3::validate_test_result(&v,"PERSON_CAPABILITIES")?;
    if v.get("statusSequenceCas")!=Some(&Value::Bool(true)) ||
       v.get("exportSequenceCas")!=Some(&Value::Bool(true)) {
        return Err("PUBLISHER_PERSON_T3_OWNER_UPDATE_REQUIRED".into());
    }
    if v.get("environment").and_then(Value::as_str)!=Some("PRODUCTION") ||
       !v.get("issuers").is_some_and(Value::is_array) {
        return Err("PUBLISHER_PERSON_T3_ISSUER_REQUIRED".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_inventory(
    app:AppHandle,lookup_id:Option<String>
)->Result<Value,String>{
    // Optional bounded lookup is served by the ORIGINAL T3 owner ledger.
    // It never changes the signing authority or copies the owner Store.
    if lookup_id.as_deref().is_some_and(|id|!t3::valid_identifier(id)){
        return Err("PUBLISHER_PERSON_T3_INVENTORY_LOOKUP_INVALID".into());
    }
    let args=lookup_id.iter().cloned().collect();
    let v=call_person(app,"person-inventory",args).await?;
    t3::validate_test_result(&v,"PERSON_INVENTORY")?;
    if !v.get("licenses").is_some_and(Value::is_array) {
        return Err("PUBLISHER_PERSON_T3_INVENTORY_REQUIRED".into());
    }
    if let Some(id)=lookup_id.as_deref(){
        if v.get("lookupId").and_then(Value::as_str)!=Some(id)||
           !v.get("matches").and_then(Value::as_u64).is_some_and(|n|
               n>=v["licenses"].as_array().map_or(0,|entries|entries.len()) as u64){
            return Err("PUBLISHER_PERSON_T3_INVENTORY_LOOKUP_MISMATCH".into());
        }
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_issue(
    app:AppHandle,request_json:String,issuer_authority_id:String,
    expected_draft_sha256:String
)->Result<Value,String>{
    let request=validate_person_request(&request_json)?;
    verify_person_draft_source(&crate::publisher_root(&app)?,&expected_draft_sha256)?;
    let request_id=request["requestId"].as_str()
        .ok_or("PUBLISHER_PERSON_T3_REQUEST_ID_REQUIRED")?.to_owned();
    if !t3::valid_identifier(&issuer_authority_id){
        return Err("PUBLISHER_PERSON_T3_ISSUER_INVALID".into());
    }
    if !t3::availability(&app,"owner-person"){
        return Err("T3_PERSON_NATIVE_OWNER_NOT_ENROLLED".into());
    }
    let unique=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_|"PUBLISHER_PERSON_T3_TIME_INVALID")?.as_nanos();
    let file=std::env::temp_dir().join(format!(
        "iwxa-person-owner-request-{}-{unique}.json",std::process::id()));
    {
        let mut handle=OpenOptions::new().write(true).create_new(true)
            .open(&file).map_err(|_|"PUBLISHER_PERSON_T3_REQUEST_FILE_DENIED")?;
        handle.write_all(request_json.as_bytes())
            .map_err(|_|"PUBLISHER_PERSON_T3_REQUEST_FILE_DENIED")?;
        handle.sync_all().map_err(|_|"PUBLISHER_PERSON_T3_REQUEST_FILE_DENIED")?;
    }
    let _cleanup=TransientRequest(file.clone());
    // Re-read the actual chosen Setup Core DataLocation in the same native
    // worker immediately before invoking original T3. No signer or Store
    // is copied into Publisher.
    let v=tauri::async_runtime::spawn_blocking(move||{
        let root=crate::publisher_root(&app)?;
        with_stable_person_draft_source(&root,&expected_draft_sha256,||{
            t3::run(&app,"owner-person","person-issue",&[
                file.to_string_lossy().into_owned(),issuer_authority_id])
        })
    }).await.map_err(|_|"PUBLISHER_PERSON_T3_WORKER_FAILED".to_string())??;
    t3::validate_test_result(&v,"PERSON_ISSUE")?;
    if !v.get("licenseId").and_then(Value::as_str)
        .is_some_and(t3::valid_identifier) ||
       v.get("requestId").and_then(Value::as_str)!=Some(request_id.as_str()) ||
       !matches!(v.get("outcome").and_then(Value::as_str),
                 Some("ISSUED_NEW"|"ALREADY_ISSUED")) {
        return Err("PUBLISHER_PERSON_T3_ISSUE_RECEIPT_MISMATCH".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_change_status(
    app:AppHandle,license_id:String,next_status:String,expected_sequence:u64
)->Result<Value,String>{
    let next_sequence=expected_sequence.checked_add(1)
        .ok_or("PUBLISHER_PERSON_T3_STATUS_SEQUENCE_INVALID")?;
    // Original T3 floor is a JavaScript safe-integer contract.
    if !t3::valid_identifier(&license_id) ||
       expected_sequence>9_007_199_254_740_990 ||
       !["ACTIVE","SUSPENDED","REVOKED"].contains(&next_status.as_str()){
        return Err("PUBLISHER_PERSON_T3_STATUS_INPUT_INVALID".into());
    }
    let v=call_person(app,"person-status",vec![
        license_id.clone(),next_status.clone(),expected_sequence.to_string()]).await?;
    t3::validate_test_result(&v,"PERSON_STATUS")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("state").and_then(Value::as_str)!=Some(next_status.as_str()) ||
       v.get("expectedSequence").and_then(Value::as_u64)!=Some(expected_sequence) ||
       v.get("sequence").and_then(Value::as_u64)!=Some(next_sequence){
        return Err("PUBLISHER_PERSON_T3_STATUS_RECEIPT_MISMATCH".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_export(
    app:AppHandle,license_id:String,expected_sequence:u64
)->Result<Option<Value>,String>{
    if !t3::valid_identifier(&license_id) ||
       expected_sequence==0 || expected_sequence>9_007_199_254_740_990 {
        return Err("PUBLISHER_PERSON_T3_LICENSE_ID_REQUIRED".into());
    }
    if !t3::availability(&app,"owner-person"){
        return Err("T3_PERSON_NATIVE_OWNER_NOT_ENROLLED".into());
    }
    let selected=rfd::FileDialog::new()
        .set_title("Publisher: подписанная персональная лицензия .iwxa")
        .add_filter("IWXA",&["iwxa"])
        .set_file_name("iwxa-person-license.iwxa").save_file();
    let Some(path)=selected else {return Ok(None)};
    if !crate::is_iwxa_path(&path) {
        return Err("PUBLISHER_PERSON_T3_EXPORT_EXTENSION_REQUIRED".into());
    }
    if path.exists(){return Err("PUBLISHER_PERSON_T3_EXPORT_OVERWRITE_DENIED".into());}
    let output_path=path.to_string_lossy().into_owned();
    let v=call_person(app,"person-export",vec![
        license_id.clone(),output_path.clone(),expected_sequence.to_string()]).await?;
    t3::validate_test_result(&v,"PERSON_IWXA_EXPORTED")?;
    let declared=v.get("bytes").and_then(Value::as_u64)
        .ok_or("PUBLISHER_PERSON_T3_EXPORT_SIZE_REQUIRED")?;
    let hash=v.get("packageSha256").and_then(Value::as_str)
        .ok_or("PUBLISHER_PERSON_T3_EXPORT_DIGEST_REQUIRED")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("path").and_then(Value::as_str)!=Some(output_path.as_str()) ||
       v.get("expectedSequence").and_then(Value::as_u64)!=Some(expected_sequence) ||
       declared==0 || declared>4*1024*1024 || hash.len()!=64 ||
       !hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("PUBLISHER_PERSON_T3_EXPORT_RECEIPT_MISMATCH".into());
    }
    let bytes=fs::read(&path).map_err(|_|"PUBLISHER_PERSON_T3_EXPORT_READBACK_UNAVAILABLE")?;
    if bytes.len() as u64!=declared ||
       format!("{:x}",Sha256::digest(&bytes))!=hash {
        return Err("PUBLISHER_PERSON_T3_EXPORT_READBACK_MISMATCH".into());
    }
    Ok(Some(v))
}
#[tauri::command]
pub async fn publisher_t3_person_export_public_trust(
    app:AppHandle
)->Result<Option<Value>,String>{
    if !t3::availability(&app,"owner-person"){
        return Err("T3_PERSON_NATIVE_OWNER_NOT_ENROLLED".into());
    }
    // Never install trust from incoming .iwxa: export only the original T3
    // public verifier policy for explicit packaging in IWXA Setup Core.
    let selected=rfd::FileDialog::new()
        .set_title("Publisher: публичное доверие издателя PERSON")
        .add_filter("JSON",&["json"])
        .set_file_name("publisher-person-trust.json").save_file();
    let Some(path)=selected else{return Ok(None)};
    if path.file_name().and_then(|s|s.to_str())!=Some("publisher-person-trust.json"){
        return Err("PUBLISHER_PERSON_TRUST_FILE_NAME_REQUIRED".into());
    }
    if path.exists(){return Err("PUBLISHER_PERSON_TRUST_OVERWRITE_DENIED".into());}
    let exported=call_person(app,"person-trust-export",
        vec![path.to_string_lossy().into_owned()]).await?;
    t3::validate_test_result(&exported,"PERSON_TRUST_EXPORTED")?;
    if exported.get("publicOnly")!=Some(&Value::Bool(true))||
       exported.get("bytes").and_then(Value::as_u64).is_none_or(|n|n<10||n>1024*1024)||
       exported.get("keyCount").and_then(Value::as_u64).is_none_or(|n|n==0)||
       exported.get("issuerCount").and_then(Value::as_u64).is_none_or(|n|n==0){
        return Err("PUBLISHER_PERSON_PUBLIC_TRUST_RECEIPT_INVALID".into());
    }
    let expected=exported.get("sha256").and_then(Value::as_str)
        .ok_or("PUBLISHER_PERSON_TRUST_DIGEST_REQUIRED")?;
    let contents=fs::read(&path)
        .map_err(|_|"PUBLISHER_PERSON_TRUST_READBACK_UNAVAILABLE".to_string())?;
    let value:Value=serde_json::from_slice(&contents)
        .map_err(|_|"PUBLISHER_PERSON_TRUST_READBACK_INVALID".to_string())?;
    if contents.len() as u64 != exported["bytes"].as_u64().unwrap_or(0)||
       format!("{:x}",Sha256::digest(&contents))!=expected||
       contents.windows(11).any(|w|w==b"PRIVATE KEY")||
       value["policy"]["environment"]!="PRODUCTION"||
       !value["policy"]["keys"].is_object()||
       !value["policy"]["authorities"].is_object()||
       !value["productLicenseIssuers"].is_object(){
        return Err("PUBLISHER_PERSON_TRUST_READBACK_MISMATCH".into());
    }
    Ok(Some(exported))
}
// Select the final destination on the native Tauri command path BEFORE
// dispatching a blocking T3 worker. Windows modal file pickers must not
// depend on the cryptographic subprocess worker or its thread apartment.
fn select_signed_age_destination(
    app:&AppHandle,license_id:&str,raw_recipients:&str,person:bool
)->Result<Option<PathBuf>,String>{
    if !t3::valid_identifier(license_id){
        return Err("PUBLISHER_AGE_LICENSE_ID_INVALID".into());
    }
    crate::t3_age_transport::recipients(raw_recipients)?;
    let role=if person{"owner-person"}else{"owner"};
    if !t3::availability(app,role){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    let suggested=if person{"iwxa-person-license.iwxa.age"}else{"iwxa-product-test-delivery.iwxa.age"};
    crate::t3_age_transport::select_encrypted_destination(suggested)
}

// One-step signed delivery: the original T3 issuer exports an existing signed
// license, then the original T3 age operator encrypts it. Neither the signed
// plaintext nor private issuer keys cross WebView IPC; plaintext is removed
// with the short-lived native staging directory, including on an error.
fn signed_age_export(
    app:&AppHandle,license_id:&str,raw_recipients:&str,person:bool,
    destination:&std::path::Path,expected_sequence:Option<u64>
)->Result<Option<Value>,String>{
    if person!=expected_sequence.is_some() ||
       expected_sequence.is_some_and(|n|n==0||n>9_007_199_254_740_990) {
        return Err("PUBLISHER_AGE_SIGNED_STATUS_SEQUENCE_INVALID".into());
    }
    if !t3::valid_identifier(license_id){
        return Err("PUBLISHER_AGE_LICENSE_ID_INVALID".into());
    }
    crate::t3_age_transport::recipients(raw_recipients)?;
    let role=if person{"owner-person"}else{"owner"};
    let action=if person{"person-export"}else{"export"};
    let expected=if person{"PERSON_IWXA_EXPORTED"}else{"TEST_IWXA_EXPORTED"};
    if !t3::availability(app,role){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    // The modal dialog completed before this worker began. The original
    // T3 signed plaintext exists only during the bounded native operation.
    let tmp=crate::t3_age_transport::TransientPackage::new()?;
    let mut args=vec![license_id.to_string(),tmp.path.to_string_lossy().into_owned()];
    if let Some(n)=expected_sequence {args.push(n.to_string());}
    let signed=t3::run(app,role,action,&args)?;
    t3::validate_test_result(&signed,expected)?;
    let declared=signed["bytes"].as_u64().ok_or("PUBLISHER_AGE_SIGNED_EXPORT_INVALID")?;
    let source_hash=signed["packageSha256"].as_str()
        .ok_or("PUBLISHER_AGE_SIGNED_EXPORT_INVALID")?;
    if signed["licenseId"]!=license_id ||
       expected_sequence.is_some_and(|n|signed["expectedSequence"].as_u64()!=Some(n)) ||
       signed["path"]!=tmp.path.to_string_lossy().as_ref() ||
       declared==0||declared>4*1024*1024||source_hash.len()!=64||
       !source_hash.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("PUBLISHER_AGE_SIGNED_EXPORT_INVALID".into());
    }
    let signed_bytes=fs::read(&tmp.path)
        .map_err(|_|"PUBLISHER_AGE_SIGNED_READBACK_MISSING")?;
    if signed_bytes.len() as u64!=declared||
       format!("{:x}",Sha256::digest(&signed_bytes))!=source_hash {
        return Err("PUBLISHER_AGE_SIGNED_READBACK_MISMATCH".into());
    }
    let age_root=crate::publisher_root(app)?.join("t3-age");
    let encrypted=crate::t3_age_transport::encrypt_to_path(
       app,&age_root,&tmp.path,destination,raw_recipients)?;
    if encrypted["sourceSha256"]!=source_hash||
       encrypted["admitted"]!=false||
       encrypted["deliveryState"]!="NOT_CONFIRMED"{
        return Err("PUBLISHER_AGE_TRANSPORT_RECEIPT_INVALID".into());
    }
    Ok(Some(serde_json::json!({
      "operation":if person{"PERSON_AGE_EXPORTED"}else{"TEST_AGE_EXPORTED"},
      "licenseId":license_id,
      "expectedSequence":expected_sequence,
      "packageSha256":source_hash,
      "ciphertextSha256":encrypted["ciphertextSha256"],
      "bytes":encrypted["bytes"],
      "recipientCount":encrypted["recipientCount"],
      "deliveryState":"NOT_CONFIRMED",
      "admitted":false,
      "activeSeats":0,
      "productionActivation":false
    })))
}
#[tauri::command]
pub async fn publisher_t3_export_age(
    app:AppHandle,license_id:String,recipients:String
)->Result<Option<Value>,String>{
    let Some(destination)=select_signed_age_destination(&app,&license_id,&recipients,false)? else{
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move||
       signed_age_export(&app,&license_id,&recipients,false,&destination,None))
       .await.map_err(|_|"PUBLISHER_AGE_EXPORT_WORKER_FAILED".to_string())?
}
#[tauri::command]
pub async fn publisher_t3_person_export_age(
    app:AppHandle,license_id:String,recipients:String,expected_sequence:u64
)->Result<Option<Value>,String>{
    if expected_sequence==0 || expected_sequence>9_007_199_254_740_990 {
        return Err("PUBLISHER_AGE_SIGNED_STATUS_SEQUENCE_INVALID".into());
    }
    let Some(destination)=select_signed_age_destination(&app,&license_id,&recipients,true)? else{
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move||
       signed_age_export(&app,&license_id,&recipients,true,&destination,
           Some(expected_sequence)))
       .await.map_err(|_|"PUBLISHER_AGE_EXPORT_WORKER_FAILED".to_string())?
}

#[cfg(test)]
mod person_native_bridge_tests {
    use super::*;
    #[test]
    fn public_bridge_rejects_forged_person_authority(){
        let good=serde_json::json!({
            "schema":"IWXA_PUBLISHER_PERSON_LICENSE_REQUEST/1",
            "kind":"PERSON_LICENSE_REQUEST","requestId":"proposal:person:1",
            "requestedAt":"2026-11-10T10:00:00.000Z","environment":"PRODUCTION",
            "subject":{"type":"PERSON","id":"person:one","name":"Synthetic"},
            "product":{"id":"IWXA_ATLAS","version":"0.6.0"},
            "featureIds":["WORKSPACE"],"termDays":30,"seats":1,
            "deviceLimit":2,"quotas":[],"status":"UNSIGNED_REQUEST"
        });
        assert!(validate_person_request(&good.to_string()).is_ok());
        let mut forged=good.clone();
        forged["signature"]=Value::String("false".into());
        assert!(validate_person_request(&forged.to_string()).is_err());
        forged=good.clone();forged["product"]["id"]=Value::String("IWXA_ADMIN_CENTER".into());
        assert!(validate_person_request(&forged.to_string()).is_err());
        forged=good.clone();forged["subject"]["type"]=Value::String("ORGANIZATION".into());
        assert!(validate_person_request(&forged.to_string()).is_err());
        forged=good.clone();forged["deviceLimit"]=Value::from(0);
        assert!(validate_person_request(&forged.to_string()).is_err());
    }
    #[test]
    fn person_renewal_request_passes_public_bridge_only_with_valid_original_request_link(){
        let original=serde_json::json!({
            "schema":"IWXA_PUBLISHER_PERSON_LICENSE_REQUEST/1",
            "kind":"PERSON_LICENSE_REQUEST","requestId":"proposal:second",
            "renewalOfRequestId":"proposal:first",
            "requestedAt":"2026-11-10T10:00:00.000Z",
            "environment":"PRODUCTION",
            "subject":{"type":"PERSON","id":"person:one","name":"Synthetic"},
            "product":{"id":"IWXA_ATLAS","version":"0.6.0"},
            "featureIds":["WORKSPACE"],"termDays":30,"seats":1,
            "deviceLimit":2,"quotas":[],"status":"UNSIGNED_REQUEST"
        });
        let accepted=validate_person_request(&original.to_string()).unwrap();
        assert_eq!(accepted["renewalOfRequestId"],"proposal:first");
        let mut invalid=original.clone();
        invalid["renewalOfRequestId"]=Value::from("proposal:second");
        assert!(validate_person_request(&invalid.to_string()).is_err());
        invalid=original.clone();
        invalid["renewalOfRequestId"]=Value::from("holder:other");
        // Only original issuer ledger determines whether a structurally
        // valid identifier actually represents an eligible signed issue.
        assert!(validate_person_request(&invalid.to_string()).is_ok());
        invalid=original.clone();
        invalid["renewalOfRequestId"]=Value::from(33);
        assert!(validate_person_request(&invalid.to_string()).is_err());
        invalid=original.clone();
        invalid["signature"]=Value::from("forged");
        assert!(validate_person_request(&invalid.to_string()).is_err());
    }
}
