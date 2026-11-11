// Publisher's native UI uses only the privately built original T3 Owner
// executable. The public Center repo does not contain a signer or private T3
// source, and never falls back to an installed Node executable.
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
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
pub async fn publisher_t3_inventory(app:AppHandle)->Result<Value,String>{
    let v=call(app,"inventory",vec![]).await?;
    t3::validate_test_result(&v,"TEST_INVENTORY")?;
    if !v.get("licenses").is_some_and(Value::is_array){
        return Err("PUBLISHER_T3_INVENTORY_REQUIRED".into());
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
    if path.extension().and_then(|v|v.to_str())!=Some("iwxa"){
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


// PERSON uses the original private T3 owner binary, but only the separately
// pre-enrolled production root. The public bridge never signs or imports trust.
const PERSON_REQUEST_LIMIT: usize = 32 * 1024;
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
    if v.get("environment").and_then(Value::as_str)!=Some("PRODUCTION") ||
       !v.get("issuers").is_some_and(Value::is_array) {
        return Err("PUBLISHER_PERSON_T3_ISSUER_REQUIRED".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_inventory(app:AppHandle)->Result<Value,String>{
    let v=call_person(app,"person-inventory",vec![]).await?;
    t3::validate_test_result(&v,"PERSON_INVENTORY")?;
    if !v.get("licenses").is_some_and(Value::is_array) {
        return Err("PUBLISHER_PERSON_T3_INVENTORY_REQUIRED".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_issue(
    app:AppHandle,request_json:String,issuer_authority_id:String
)->Result<Value,String>{
    let request=validate_person_request(&request_json)?;
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
    let v=call_person(app,"person-issue",vec![
        file.to_string_lossy().into_owned(),issuer_authority_id]).await?;
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
    app:AppHandle,license_id:String,next_status:String
)->Result<Value,String>{
    if !t3::valid_identifier(&license_id) ||
       !["ACTIVE","SUSPENDED","REVOKED"].contains(&next_status.as_str()){
        return Err("PUBLISHER_PERSON_T3_STATUS_INPUT_INVALID".into());
    }
    let v=call_person(app,"person-status",vec![
        license_id.clone(),next_status.clone()]).await?;
    t3::validate_test_result(&v,"PERSON_STATUS")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("state").and_then(Value::as_str)!=Some(next_status.as_str()) ||
       !v.get("sequence").and_then(Value::as_u64).is_some_and(|n|n>0){
        return Err("PUBLISHER_PERSON_T3_STATUS_RECEIPT_MISMATCH".into());
    }
    Ok(v)
}
#[tauri::command]
pub async fn publisher_t3_person_export(
    app:AppHandle,license_id:String
)->Result<Option<Value>,String>{
    if !t3::valid_identifier(&license_id){
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
    if path.extension().and_then(|v|v.to_str())!=Some("iwxa"){
        return Err("PUBLISHER_PERSON_T3_EXPORT_EXTENSION_REQUIRED".into());
    }
    if path.exists(){return Err("PUBLISHER_PERSON_T3_EXPORT_OVERWRITE_DENIED".into());}
    let output_path=path.to_string_lossy().into_owned();
    let v=call_person(app,"person-export",vec![
        license_id.clone(),output_path.clone()]).await?;
    t3::validate_test_result(&v,"PERSON_IWXA_EXPORTED")?;
    let declared=v.get("bytes").and_then(Value::as_u64)
        .ok_or("PUBLISHER_PERSON_T3_EXPORT_SIZE_REQUIRED")?;
    let hash=v.get("packageSha256").and_then(Value::as_str)
        .ok_or("PUBLISHER_PERSON_T3_EXPORT_DIGEST_REQUIRED")?;
    if v.get("licenseId").and_then(Value::as_str)!=Some(license_id.as_str()) ||
       v.get("path").and_then(Value::as_str)!=Some(output_path.as_str()) ||
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

// One-step signed delivery: the original T3 issuer exports an existing signed
// license, then the original T3 age operator encrypts it. Neither the signed
// plaintext nor private issuer keys cross WebView IPC; plaintext is removed
// with the short-lived native staging directory, even on cancellation/error.
fn signed_age_export(app:&AppHandle,license_id:&str,raw_recipients:&str,person:bool)
 ->Result<Option<Value>,String>{
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
    let tmp=crate::t3_age_transport::TransientPackage::new()?;
    let signed=t3::run(app,role,action,&[
        license_id.to_string(),tmp.path.to_string_lossy().into_owned()
    ])?;
    t3::validate_test_result(&signed,expected)?;
    let declared=signed["bytes"].as_u64().ok_or("PUBLISHER_AGE_SIGNED_EXPORT_INVALID")?;
    let source_hash=signed["packageSha256"].as_str()
        .ok_or("PUBLISHER_AGE_SIGNED_EXPORT_INVALID")?;
    if signed["licenseId"]!=license_id ||
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
    let encrypted=crate::t3_age_transport::encrypt_source(
       app,&age_root,&tmp.path,raw_recipients)?;
    let Some(encrypted)=encrypted else{return Ok(None)};
    if encrypted["sourceSha256"]!=source_hash||
       encrypted["admitted"]!=false||
       encrypted["deliveryState"]!="NOT_CONFIRMED"{
        return Err("PUBLISHER_AGE_TRANSPORT_RECEIPT_INVALID".into());
    }
    Ok(Some(serde_json::json!({
      "operation":if person{"PERSON_AGE_EXPORTED"}else{"TEST_AGE_EXPORTED"},
      "licenseId":license_id,
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
    tauri::async_runtime::spawn_blocking(move||
       signed_age_export(&app,&license_id,&recipients,false))
       .await.map_err(|_|"PUBLISHER_AGE_EXPORT_WORKER_FAILED".to_string())?
}
#[tauri::command]
pub async fn publisher_t3_person_export_age(
    app:AppHandle,license_id:String,recipients:String
)->Result<Option<Value>,String>{
    tauri::async_runtime::spawn_blocking(move||
       signed_age_export(&app,&license_id,&recipients,true))
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
