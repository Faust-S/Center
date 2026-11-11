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
     value["assignableSeats"]!=0 {
    return Err("CEN04_T3_NATIVE_INTAKE_CAPABILITIES_REQUIRED".into());
  }
  Ok(value)
}
#[tauri::command]
pub async fn center_cen04_t3_read(app:AppHandle,organization_id:String)->Result<Value,String>{
  let org=scope(&organization_id)?;
  let value=invoke_t3(app,"read",org.clone(),vec![]).await?;
  t3::validate_test_result(&value,"TEST_READ")?;
  let view=&value["view"];
  if view["organizationId"]!=Value::String(org) ||
     view["productId"]!="IWXA_ADMIN_CENTER" ||
     view["productionActivation"]!=Value::Bool(false) ||
     view["activeSeats"]!=Value::from(0) ||
     !view["licenses"].is_array() {
    return Err("CEN04_T3_NATIVE_VERIFIED_READBACK_REQUIRED".into());
  }
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
  t3::validate_test_result(&receipt,"TEST_RECEIVE")?;
  if receipt["organizationId"]!=Value::String(org) ||
     receipt["signatureVerified"]!=true ||
     receipt["statusVerified"]!=true ||
     receipt["activeSeats"]!=0 ||
     !receipt["licenseId"].as_str().is_some_and(t3::valid_identifier) {
    return Err("CEN04_T3_NATIVE_SIGNED_RECEIPT_REQUIRED".into());
  }
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
    t3::validate_test_result(&result,"TEST_RECEIVE")?;
    if result["organizationId"]!=Value::String(org) ||
       result["signatureVerified"]!=true ||
       result["statusVerified"]!=true ||
       result["activeSeats"]!=0 ||
       !result["licenseId"].as_str().is_some_and(t3::valid_identifier) {
      return Err("CEN04_T3_AGE_SIGNED_RECEIPT_REQUIRED".into());
    }
    Ok(Some(result))
  }).await.map_err(|_|"CEN04_T3_AGE_WORKER_FAILED".to_string())?
}
