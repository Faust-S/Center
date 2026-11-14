// Native corporate port for the ORIGINAL, privately packaged T3 owner.
// It does not implement Reconciliation, D1 IAM, signatures, Store or Kernel.
// There is one trusted executable already owned by the T3 distribution;
// absent original provisioning means NOT_CONNECTED, never a test fallback.
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::{Path,PathBuf}};
use tauri::AppHandle;
use uuid::Uuid;
use crate::t3_product_component as t3;

const MAX_REQUEST:usize=256*1024;
const MAX_IWXA:u64=16*1024*1024;
const SCHEMA:&str="IWXA_T3_ADMIN_D3_NATIVE/1";
const SHA_LEN:usize=64;

fn check_org(organization_id:&str)->Result<(),String>{
    if !t3::valid_identifier(organization_id){
        return Err("CEN_D3_ORGANIZATION_REQUIRED".into());
    }
    Ok(())
}
fn validate_hex(value:Option<&str>)->bool{
    value.is_some_and(|s|s.len()==SHA_LEN &&
        s.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase()))
}
fn check_bound_request(input:&Value,operation:&str)->Result<(),String>{
    if !input.is_object(){return Err("CEN_D3_INPUT_INVALID".into());}
    let sha=input["packageSha256"].as_str();
    match operation {
      "d3Receive"=>{},
      "d3Preview"=>if !validate_hex(sha) {
          return Err("CEN_D3_PACKAGE_SHA_REQUIRED".into());
      },
      "d3Receipt"=>if !validate_hex(sha) ||
          !input["operationId"].as_str().is_some_and(t3::valid_identifier){
          return Err("CEN_D3_RECEIPT_QUERY_REQUIRED".into());
      },
      "d3Decide"=>if !validate_hex(sha)||
          !validate_hex(input["previewDigest"].as_str())||
          !input["operationId"].as_str().is_some_and(t3::valid_identifier)||
          !matches!(input["decision"].as_str(),Some("ACCEPT"|"REJECT"))||
          (input["decision"]=="REJECT" &&
           !input["reason"].as_str().is_some_and(|s|!s.trim().is_empty()&&s.len()<=1000)) {
          return Err("CEN_D3_EXPLICIT_DECISION_REQUIRED".into());
      },
      "d3InspectAccepted"|"d3ApplyAccepted"=>{
          let revisions=input["revisionIds"].as_array()
              .ok_or("CEN_D3_ACCEPTED_SOURCE_INVALID")?;
          if !validate_hex(input["acceptanceId"].as_str())||
              revisions.is_empty()||revisions.len()>32||
              revisions.iter().any(|r|!validate_hex(r.as_str())) {
              return Err("CEN_D3_ACCEPTED_SOURCE_INVALID".into());
          }
          let mut distinct=std::collections::HashSet::new();
          if revisions.iter().any(|r|!distinct.insert(r.as_str().unwrap())) {
              return Err("CEN_D3_ACCEPTED_SOURCE_INVALID".into());
          }
      },
      _=>return Err("CEN_D3_OPERATION_NOT_SUPPORTED".into())
    }
    Ok(())
}
fn supported_state(result:&Value,organization_id:&str)->Result<Value,String>{
    if result["schema"]!=SCHEMA||result["operation"]!="D3_STATE"||
       result["ownerMode"]!="ORIGINAL_SIGNED_CORPORATE_D3"||
       result["productionActivation"]!=false||
       result["T3_READY"]!=false||
       result["activeSeats"]!=0||
       result["organizationId"]!=organization_id {
        return Err("CEN_D3_ORIGINAL_OWNER_STATE_INVALID".into());
    }
    let view=&result["view"];
    if view["status"]!="D3_OWNER_READY"||
       view["snapshot"]["product"]!="admin"||
       view["snapshot"]["organizationId"]!=organization_id||
       view["snapshot"]["d3RecipientAvailable"]!=true||
       view["snapshot"]["productionActivation"]!=false||
       view["snapshot"]["T3_READY"]!=false||
       !view["snapshot"]["workspaceId"].as_str().is_some_and(t3::valid_identifier)||
       !view["snapshot"]["actorId"].as_str().is_some_and(t3::valid_identifier)||
       !view["snapshot"]["contextId"].as_str().is_some_and(t3::valid_identifier)||
       !view["snapshot"]["contextEpoch"].as_u64().is_some_and(|x|x>0&&x<=9_007_199_254_740_991)||
       !view["snapshot"]["d3ApplyAvailable"].is_boolean(){
        return Err("CEN_D3_SIGNED_SESSION_READBACK_INVALID".into());
    }
    Ok(view.clone())
}
fn exact_binding(view:&Value,organization_id:&str,binding:&Value)->bool{
    let s=&view["snapshot"];
    binding["organizationId"]==organization_id&&
      binding["workspaceId"]==s["workspaceId"]&&
      binding["actorId"]==s["actorId"]&&
      binding["contextId"]==s["contextId"]&&
      binding["contextEpoch"]==s["contextEpoch"]
}
fn source_file(path:&Path)->Result<(),String>{
    let meta=fs::symlink_metadata(path).map_err(|_|"CEN_D3_FILE_UNREADABLE")?;
    if meta.file_type().is_symlink()||!meta.is_file()||meta.len()==0||meta.len()>MAX_IWXA||
       path.extension().and_then(|e|e.to_str())!=Some("iwxa"){
        return Err("CEN_D3_CARRIER_INVALID".into());
    }
    Ok(())
}
struct EphemeralRequest(PathBuf);
impl Drop for EphemeralRequest{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
fn store_request(app:&AppHandle,data:&Value)->Result<EphemeralRequest,String>{
    let bytes=serde_json::to_vec(data).map_err(|_|"CEN_D3_REQUEST_INVALID")?;
    if bytes.is_empty()||bytes.len()>MAX_REQUEST{
        return Err("CEN_D3_REQUEST_TOO_LARGE".into());
    }
    // The file is ONLY a transient command carrier, NOT a Result Store.
    // The original private T3 owner validates all content and signed scope.
    let root=crate::center_product_data_root(app)?.join("t3-d3-ipc");
    fs::create_dir_all(&root).map_err(|_|"CEN_D3_IPC_FOLDER_UNAVAILABLE")?;
    let path=root.join(format!("request-{}.json",Uuid::new_v4()));
    let mut file=OpenOptions::new().write(true).create_new(true)
        .open(&path).map_err(|_|"CEN_D3_IPC_WRITE_FAILED")?;
    let cleanup=EphemeralRequest(path);
    file.write_all(&bytes).and_then(|_|file.sync_all())
        .map_err(|_|"CEN_D3_IPC_WRITE_FAILED")?;
    drop(file);
    Ok(cleanup)
}
fn private_owner_state(app:&AppHandle,organization_id:&str)->Result<Value,String>{
    let result=t3::run(app,"admin-d3","d3-state",&[organization_id.to_owned()])?;
    supported_state(&result,organization_id)
}
#[tauri::command]
pub async fn center_corporate_state(
    app:AppHandle,organization_id:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    // Public Center is fully functional for unsigned preparation/Atlas even
    // without a private signed original corporate owner installed.
    if !t3::availability(&app,"admin-d3") {
        return Ok(json!({"status":"NOT_CONNECTED"}));
    }
    tauri::async_runtime::spawn_blocking(move||
        private_owner_state(&app,&organization_id))
        .await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_action(
    app:AppHandle,organization_id:String,operation:String,
    input:Value,binding:Value
)->Result<Value,String>{
    check_org(&organization_id)?;
    check_bound_request(&input,&operation)?;
    if !t3::availability(&app,"admin-d3"){
        return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
    }
    // Deliberately no WebView-resolved path or arbitrary Node executable.
    // For received .iwxa, use the pre-existing native Windows file chooser:
    // large original bytes never cross the Tauri JSON IPC.
    let selected_path=if operation=="d3Receive"{
        let selection=rfd::FileDialog::new()
            .set_title("Admin Center - получить подписанный Result T3")
            .add_filter("IWXA",&["iwxa"])
            .pick_file();
        let Some(path)=selection else {
            return Ok(json!({"status":"CANCELLED"}));
        };
        source_file(&path)?;
        Some(path)
    }else{None};
    tauri::async_runtime::spawn_blocking(move||{
        // A changed actor or signed scope cancels the selected UI decision.
        // The ORIGINAL owner must revalidate at its own JIT as well.
        let observed=private_owner_state(&app,&organization_id)?;
        if !exact_binding(&observed,&organization_id,&binding){
            return Err("CEN_D3_CONTEXT_CHANGED".into());
        }
        let payload=json!({
            "organizationId":organization_id,
            "operation":operation,
            "input":input,
            "binding":binding,
            "archivePath":selected_path.as_ref().map(|p|p.to_string_lossy().to_string())
        });
        let transient=store_request(&app,&payload)?;
        let output=t3::run(&app,"admin-d3","d3-action", &[
            organization_id.clone(),transient.0.to_string_lossy().into_owned(),
        ])?;
        if output["schema"]!=SCHEMA||
           output["operation"]!="D3_ACTION"||
           output["ownerMode"]!="ORIGINAL_SIGNED_CORPORATE_D3"||
           output["organizationId"]!=organization_id||
           output["productionActivation"]!=false||
           output["T3_READY"]!=false||
           output["activeSeats"]!=0||
           output.get("result").is_none(){
            return Err("CEN_D3_ORIGINAL_OWNER_ACTION_INVALID".into());
        }
        // No implicit acceptance or write: preserve the original result.
        Ok(output["result"].clone())
    }).await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn state_must_be_genuinely_scoped_and_not_a_test_owner(){
        let valid=json!({"schema":SCHEMA,"operation":"D3_STATE",
            "ownerMode":"ORIGINAL_SIGNED_CORPORATE_D3",
            "organizationId":"org:1","productionActivation":false,
            "T3_READY":false,"activeSeats":0,
            "view":{"status":"D3_OWNER_READY","snapshot":{"product":"admin",
              "organizationId":"org:1","workspaceId":"workspace:1",
              "actorId":"person:manager","contextId":"context:one",
              "contextEpoch":4,"d3RecipientAvailable":true,
              "d3ApplyAvailable":false,"productionActivation":false,
              "T3_READY":false}}});
        assert!(supported_state(&valid,"org:1").is_ok());
        assert!(supported_state(&valid,"org:2").is_err());
        let mut forged=valid.clone();
        forged["view"]["snapshot"]["T3_READY"]=Value::Bool(true);
        assert!(supported_state(&forged,"org:1").is_err());
        forged=valid.clone();forged["ownerMode"]=Value::String("TEST_OWNER".into());
        assert!(supported_state(&forged,"org:1").is_err());
        assert!(exact_binding(&valid["view"],"org:1",&json!({
            "organizationId":"org:1","workspaceId":"workspace:1",
            "actorId":"person:manager","contextId":"context:one",
            "contextEpoch":4
        })));
    }
    #[test]
    fn original_d3_actions_require_exact_identifiers_and_hashes(){
        assert!(check_bound_request(&json!({"packageSha256":"a".repeat(64)}),
            "d3Preview").is_ok());
        assert!(check_bound_request(&json!({"packageSha256":"Z".repeat(64)}),
            "d3Preview").is_err());
        assert!(check_bound_request(&json!({"decision":"ACCEPT",
            "operationId":"decision:one","packageSha256":"a".repeat(64),
            "previewDigest":"b".repeat(64)}),"d3Decide").is_ok());
        assert!(check_bound_request(&json!({"acceptanceId":"c".repeat(64),
            "revisionIds":["d".repeat(64),"d".repeat(64)]}),
            "d3ApplyAccepted").is_err());
    }
}
