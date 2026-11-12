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
  if path.extension().and_then(|x|x.to_str())!=Some("iwxa"){
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

#[cfg(test)]
mod tests {
  use super::*;
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
