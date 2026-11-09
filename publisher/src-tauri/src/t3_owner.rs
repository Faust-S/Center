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
