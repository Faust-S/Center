// Native corporate port for the ORIGINAL, privately packaged T3 owner.
// It does not implement Reconciliation, D1 IAM, signatures, Store or Kernel.
// There is one trusted executable already owned by the T3 distribution;
// absent original provisioning means NOT_CONNECTED, never a test fallback.
use serde_json::{json,Value};
use std::{fs::{self,OpenOptions},io::Write,path::{Path,PathBuf}};
use tauri::AppHandle;
use uuid::Uuid;
use crate::t3_product_component as t3;
use crate::t3_age_transport as age;

const MAX_REQUEST:usize=256*1024;
// The installed original private T3 IWXA parser has a 32 MiB carrier
// limit. The public D3 Host supports larger transfers, but this Windows
// original-owner integration must reject unsupported carriers up front.
const MAX_IWXA:u64=32*1024*1024;
const SCHEMA:&str="IWXA_T3_ADMIN_D3_NATIVE/1";
const SHA_LEN:usize=64;

fn check_org(organization_id:&str)->Result<(),String>{
    if !t3::valid_organization_scope_id(organization_id){
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
      "d3Inbox"|"d3Receive"|"d3ReceiveAge"|"d3ExportInvitation"=>{},
      "d3CreateTask"=>{
          if !input["task"].as_str().is_some_and(|s|
              !s.trim().is_empty()&&s.len()<=10000) {
              return Err("CEN_D3_SIGNED_TASK_TEXT_REQUIRED".into());
          }
          if !input["taskId"].as_str().is_some_and(|s|
              s.len()>5&&s.len()<=105&&s.starts_with("task:")&&
              s[5..].bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')){
              return Err("CEN_D3_ORIGINAL_TASK_OPERATION_ID_REQUIRED".into());
          }
      },
      "d3TaskReadback"=>{
          if !input["taskId"].as_str().is_some_and(|s|
              s.len()>5&&s.len()<=105&&s.starts_with("task:")&&
              s[5..].bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')){
              return Err("CEN_D3_ORIGINAL_TASK_OPERATION_ID_REQUIRED".into());
          }
      },
      "d3ExportTask"=>{
          if !input["taskId"].as_str().is_some_and(t3::valid_identifier) {
              return Err("CEN_D3_ORIGINAL_TASK_SELECTION_REQUIRED".into());
          }
      },
      "d3Preview"=>{
          if !validate_hex(sha){
              return Err("CEN_D3_PACKAGE_SHA_REQUIRED".into());
          }
          if !input["resultOffset"].is_null() &&
             !input["resultOffset"].as_u64().is_some_and(|n|n<=100000){
              return Err("CEN_D3_RESULT_REVIEW_OFFSET_INVALID".into());
          }
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
      "d3InspectAccepted"|"d3ApplyAccepted"|"d3RecoverApplied"=>{
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
fn supported_state(result:&Value,organization_id:&str,
    expected_operation:&str)->Result<Value,String>{
    if result["schema"]!=SCHEMA||result["operation"]!=expected_operation||
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
       !view["snapshot"]["d3ApplyAvailable"].is_boolean()||
       (view["snapshot"]["d3ApplyRecoverAvailable"]!=Value::Null&&
        !view["snapshot"]["d3ApplyRecoverAvailable"].is_boolean())||
       (view["snapshot"]["d3ApplyRecoverAvailable"]==true&&
        view["snapshot"]["d3ApplyAvailable"]!=true)||
       !view["snapshot"]["d3TaskIssueAvailable"].is_boolean()||
       !view["snapshot"]["tasks"].is_array()||
       !view["snapshot"]["totalTasks"].as_u64().is_some_and(|n|n<=256){

        return Err("CEN_D3_SIGNED_SESSION_READBACK_INVALID".into());
    }
    // Legacy originals do not advertise Kernel recovery. Never turn an
    // absent port into a UI action just because Center supports the command.
    let mut projected=view.clone();
    if projected["snapshot"]["d3ApplyRecoverAvailable"]==Value::Null {
        projected["snapshot"]["d3ApplyRecoverAvailable"]=Value::Bool(false);
    }
    Ok(projected)
}
fn exact_kernel_apply_capability(view:&Value,operation:&str)->bool{
    let snapshot=&view["snapshot"];
    match operation{
        "d3ApplyAccepted"=>snapshot["d3ApplyAvailable"]==true,
        "d3RecoverApplied"=>snapshot["d3ApplyRecoverAvailable"]==true&&
            snapshot["d3ApplyAvailable"]==true,
        _=>true,
    }
}
fn exact_binding(view:&Value,organization_id:&str,binding:&Value)->bool{
    let s=&view["snapshot"];
    binding["organizationId"]==organization_id&&
      binding["workspaceId"]==s["workspaceId"]&&
      binding["actorId"]==s["actorId"]&&
      binding["contextId"]==s["contextId"]&&
      binding["contextEpoch"]==s["contextEpoch"]
}
// The first APPLY and both cold-restart recoveries must prove the SAME
// original T2 object, event and signed Result selection. A matching event
// alone is not proof that the expected Result was stored.
fn valid_original_applied_graph(
    object:&Value,event:&Value,input:&Value,view:&Value
)->bool{
    let Some(effect)=event["idempotency_key"].as_str() else{return false;};
    let Some(acceptance)=input["acceptanceId"].as_str() else{return false;};
    let Some(wanted)=input["revisionIds"].as_array() else{return false;};
    let Some(actual)=event["payload"]["reconciliation_revision_ids"].as_array()
        else{return false;};
    let Some(records)=object["data"]["records"].as_array() else{return false;};
    if !validate_hex(Some(effect))||!validate_hex(Some(acceptance))||
       wanted.is_empty()||wanted.len()>32||
       wanted.len()!=actual.len()||records.len()!=wanted.len()||
       wanted.iter().any(|x|!validate_hex(x.as_str()))||
       actual.iter().any(|x|!validate_hex(x.as_str())){
        return false;
    }
    let mut expected:Vec<_>=wanted.iter().filter_map(Value::as_str).collect();
    let mut observed:Vec<_>=actual.iter().filter_map(Value::as_str).collect();
    if expected.len()!=wanted.len()||observed.len()!=actual.len(){return false;}
    expected.sort_unstable();
    observed.sort_unstable();
    if expected!=observed||
       expected.windows(2).any(|pair|pair[0]==pair[1]){
        return false;
    }
    let workspace=&view["snapshot"]["workspaceId"];
    let organization=&view["snapshot"]["organizationId"];
    if !workspace.as_str().is_some_and(t3::valid_identifier)||
       !organization.as_str().is_some_and(t3::valid_identifier)||
       object["workspace_id"]!=*workspace||
       object["object_id"]!=format!("result:applied:{effect}")||
       object["schema_id"]!="iwxa.admin.applied-results"||
       object["schema_version"]!="1.0.0"||
       object["revision"].as_u64()!=Some(1)||
       object["data"]["schema"]!="IWXA_T3_ADMIN_APPLIED_RESULTS/1"||
       event["workspace_id"]!=*workspace||
       event["event_type"]!="iwxa.admin.result.applied"||
       !event["event_id"].as_str().is_some_and(t3::valid_identifier)||
       (!event["object_id"].is_null()&&event["object_id"]!=object["object_id"])||
       (!event["revision"].is_null()&&event["revision"]!=object["revision"])||
       event["payload"]["reconciliation_acceptance_id"]!=acceptance {
        return false;
    }
    expected.iter().all(|revision|
       records.iter().filter(|record|
          record["acceptanceId"]==acceptance&&
          record["resultRevisionId"]==*revision&&
          record["workspaceId"]==*workspace&&
          record["organizationId"]==*organization&&
          record["result"].as_str().is_some()
       ).count()==1
    )
}
fn verify_kernel_recovery(result:&Value,input:&Value,view:&Value)->Result<(),String>{
    let bad=||"CEN_D3_KERNEL_RECOVERY_READBACK_INVALID".to_string();
    let confirmed=result["status"]=="ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED";
    if !confirmed && result["status"]!="OUTCOME_UNKNOWN" {
        return Err(bad());
    }
    let effect=result["effectKey"].as_str();
    if !validate_hex(effect)||result["automaticRetryAllowed"]!=false||
       result["kernelWriteReadback"]!=if confirmed {"CONFIRMED"} else {"NOT_CONFIRMED"}{
        return Err(bad());
    }
    if !confirmed{
        return if result["originalKernelReadback"].is_null()&&
            result["originalEventReadback"].is_null(){Ok(())}else{Err(bad())};
    }
    let object=&result["originalKernelReadback"]["object"];
    let event=&result["originalEventReadback"];
    let workspace=&view["snapshot"]["workspaceId"];
    if result["externalProductAcceptance"]!="NOT_ACCEPTED"||
       object["workspace_id"]!=*workspace||event["workspace_id"]!=*workspace||
       !object["object_id"].as_str().is_some_and(t3::valid_identifier)||
       !object["revision"].as_u64().is_some_and(|n|n>0&&n<=9_007_199_254_740_991)||
       !event["event_id"].as_str().is_some_and(t3::valid_identifier)||
       event["idempotency_key"]!=effect.unwrap()||
       (!event["object_id"].is_null()&&event["object_id"]!=object["object_id"])||
       (!event["revision"].is_null()&&event["revision"]!=object["revision"])||
       event["payload"]["reconciliation_acceptance_id"]!=input["acceptanceId"]{
        return Err(bad());
    }
    let expected=input["revisionIds"].as_array().ok_or_else(bad)?;
    let observed=event["payload"]["reconciliation_revision_ids"]
        .as_array().ok_or_else(bad)?;
    if observed.len()!=expected.len()||
       observed.iter().any(|id|!validate_hex(id.as_str())){
        return Err(bad());
    }
    let mut a:Vec<_>=expected.iter().filter_map(Value::as_str).collect();
    let mut b:Vec<_>=observed.iter().filter_map(Value::as_str).collect();
    if a.len()!=expected.len()||b.len()!=observed.len(){return Err(bad());}
    a.sort_unstable();b.sort_unstable();
    if a!=b||!valid_original_applied_graph(object,event,input,view){
        return Err(bad());
    }
    Ok(())
}
// Verify the ACTUAL first Kernel Apply result as strictly as recovery.
// A failed post-dispatch receipt check is OUTCOME_UNKNOWN, never a definite
// non-write: the separate recovery path must read original Object + Event.
fn verify_kernel_apply(result:&Value,input:&Value,view:&Value)->Result<(),String>{
    let bad=||"CEN_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED".to_owned();
    let workspace=&view["snapshot"]["workspaceId"];
    let accepted=&input["acceptanceId"];
    let wanted=input["revisionIds"].as_array().ok_or_else(bad)?;
    let receipt=&result["originalKernelReceipt"];
    let committed=&receipt["object"];
    let event=&receipt["event"];
    let read=&result["originalKernelReadback"]["object"];
    let effect=event["idempotency_key"].as_str().ok_or_else(bad)?;
    if result["kernelWriteReadback"]!="CONFIRMED"||
       result["reconciliationLedgerSync"]!="OWNER_FOLLOWUP_REQUIRED"||
       result["externalProductAcceptance"]!="NOT_ACCEPTED"||
       !validate_hex(Some(effect))||
       receipt["workspace_id"]!=*workspace||
       committed["workspace_id"]!=*workspace||
       read["workspace_id"]!=*workspace||
       !read["object_id"].as_str().is_some_and(t3::valid_identifier)||
       read["object_id"]!=format!("result:applied:{effect}")||
       committed["object_id"]!=read["object_id"]||
       committed["revision"]!=read["revision"]||
       !read["revision"].as_u64().is_some_and(|x|x>0&&x<=9_007_199_254_740_991)||
       read["schema_id"]!="iwxa.admin.applied-results"||
       committed["schema_id"]!=read["schema_id"]||
       read["schema_version"]!="1.0.0"||
       event["workspace_id"]!=*workspace||
       !event["event_id"].as_str().is_some_and(t3::valid_identifier)||
       event["event_type"]!="iwxa.admin.result.applied"||
       (!event["object_id"].is_null()&&event["object_id"]!=read["object_id"])||
       (!event["revision"].is_null()&&event["revision"]!=read["revision"])||
       event["payload"]["reconciliation_acceptance_id"]!=*accepted||
       read["data"]["schema"]!="IWXA_T3_ADMIN_APPLIED_RESULTS/1"{
        return Err(bad());
    }
    if !valid_original_applied_graph(read,event,input,view){return Err(bad());}
    let actual=event["payload"]["reconciliation_revision_ids"]
        .as_array().ok_or_else(bad)?;
    let records=read["data"]["records"].as_array().ok_or_else(bad)?;
    if actual.len()!=wanted.len()||records.len()!=wanted.len()||
       actual.iter().any(|id|!validate_hex(id.as_str())) {
        return Err(bad());
    }
    let mut requested:Vec<_>=wanted.iter().filter_map(Value::as_str).collect();
    let mut observed:Vec<_>=actual.iter().filter_map(Value::as_str).collect();
    if requested.len()!=wanted.len()||observed.len()!=actual.len(){
        return Err(bad());
    }
    requested.sort_unstable();
    observed.sort_unstable();
    if requested!=observed{return Err(bad());}
    for revision in &requested{
        if records.iter().filter(|record|
            record["acceptanceId"]==*accepted&&
            record["resultRevisionId"]==*revision&&
            record["workspaceId"]==*workspace&&
            record["organizationId"]==view["snapshot"]["organizationId"]&&
            record["result"].as_str().is_some()
        ).count()!=1{return Err(bad());}
    }
    Ok(())
}
fn source_file(path:&Path)->Result<(),String>{
    let meta=fs::symlink_metadata(path).map_err(|_|"CEN_D3_FILE_UNREADABLE")?;
    if meta.file_type().is_symlink()||!meta.is_file()||meta.len()==0||meta.len()>MAX_IWXA||
       !path.extension().and_then(|e|e.to_str())
          .is_some_and(|e|e.eq_ignore_ascii_case("iwxa")){
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
    supported_state(&result,organization_id,"D3_STATE")
}
fn corporate_age_root(app:&AppHandle,organization_id:&str)->Result<PathBuf,String>{
    Ok(t3::admin_d3_root(app,organization_id)?.join("age"))
}
#[tauri::command]
pub async fn center_corporate_age_status(
    app:AppHandle,organization_id:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    if !t3::admin_d3_availability(&app,&organization_id){
        return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        private_owner_state(&app,&organization_id)?;
        age::status(&app,&corporate_age_root(&app,&organization_id)?)
    }).await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_age_create_recipient(
    app:AppHandle,organization_id:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    if !t3::admin_d3_availability(&app,&organization_id){
        return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
    }
    let accepted=rfd::MessageDialog::new()
        .set_title("IWXA T3: ключ защищённого приёма")
        .set_description("Создать ключ age1 для этой организации? Закрытый ключ останется в её каталоге и будет защищён Windows DPAPI.")
        .set_buttons(rfd::MessageButtons::YesNo)
        .set_level(rfd::MessageLevel::Info).show();
    if accepted!=rfd::MessageDialogResult::Yes{
        return Err("CEN_D3_AGE_CREATION_CANCELLED".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        private_owner_state(&app,&organization_id)?;
        age::create_recipient(&app,&corporate_age_root(&app,&organization_id)?)
    }).await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_state(
    app:AppHandle,organization_id:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    // Public Center is fully functional for unsigned preparation/Atlas even
    // without a private signed original corporate owner installed.
    if !t3::admin_d3_availability(&app,&organization_id) {
        return Ok(json!({"status":"NOT_CONNECTED",
            "enrollmentAvailable":t3::binary_present(&app,"admin-d3")}));
    }
    tauri::async_runtime::spawn_blocking(move||
        private_owner_state(&app,&organization_id))
        .await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_enroll(
    app:AppHandle,organization_id:String,workspace_id:String,
    organization_name:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    if !t3::valid_identifier(&workspace_id)||
       organization_name.trim().is_empty()||
       organization_name.len()>120{
        return Err("CEN_D3_EXPLICIT_ORGANIZATION_REQUIRED".into());
    }
    if !t3::binary_present(&app,"admin-d3"){
        return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
    }
    // Original signed corporate Access is explicitly created under this
    // Windows account. No draft becomes an issuer without this ceremony.
    let answered=rfd::MessageDialog::new()
        .set_title("IWXA T3: подключить организацию")
        .set_description(&format!(
            "Создать подписанную организацию T3 «{}» для выбранной рабочей области? Полномочия будут закреплены за текущей учётной записью Windows.",
            organization_name.trim()))
        .set_buttons(rfd::MessageButtons::YesNo)
        .set_level(rfd::MessageLevel::Info)
        .show();
    if answered!=rfd::MessageDialogResult::Yes{
        return Err("CEN_D3_ENROLLMENT_CANCELLED".into());
    }
    tauri::async_runtime::spawn_blocking(move||{
        let data=json!({"organizationId":organization_id,
            "organizationName":organization_name.trim(),
            "workspaceId":workspace_id});
        let transient=store_request(&app,&data)?;
        let out=t3::run(&app,"admin-d3","d3-enroll",
            &[organization_id.clone(),transient.0.to_string_lossy().into_owned()])?;
        supported_state(&out,&organization_id,"D3_ENROLLED")
    }).await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_action(
    app:AppHandle,organization_id:String,operation:String,
    input:Value,binding:Value
)->Result<Value,String>{
    check_org(&organization_id)?;
    check_bound_request(&input,&operation)?;
    if !t3::admin_d3_availability(&app,&organization_id){
        return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
    }
    if matches!(operation.as_str(),"d3ApplyAccepted"|"d3RecoverApplied"){
        // Application is NOT implicit in ACCEPT. The original owner must
        // actually advertise a signed D1 Kernel port before Center can
        // offer either writing or recovery. Never ask for Human APPLY when
        // the only installed owner is the read-only Reconciliation recipient.
        let verified=private_owner_state(&app,&organization_id)?;
        if !exact_binding(&verified,&organization_id,&binding){
            return Err("CEN_D3_CONTEXT_CHANGED".into());
        }
        if !exact_kernel_apply_capability(&verified,&operation){
            return Err("CEN_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED".into());
        }
    }
    if operation=="d3ApplyAccepted"{
        let accepted=input["acceptanceId"].as_str().unwrap_or("");
        let count=input["revisionIds"].as_array().map(|v|v.len()).unwrap_or(0);
        let answer=rfd::MessageDialog::new()
            .set_title("IWXA T3: отдельное применение результата")
            .set_description(&format!(
                "ACCEPT уже записан в Reconciliation. Применить отдельно в оригинальный подписанный Kernel {} редакций для ACCEPT {}? Это самостоятельная операция, повторять её при потерянном ответе нельзя.",
                count,accepted))
            .set_buttons(rfd::MessageButtons::YesNo)
            .set_level(rfd::MessageLevel::Warning)
            .show();
        if answer!=rfd::MessageDialogResult::Yes{
            return Err("CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED".into());
        }
    }
    if operation=="d3Decide" {
        let kind=input["decision"].as_str().unwrap_or("?");
        let digest=input["packageSha256"].as_str().unwrap_or("");
        let answer=rfd::MessageDialog::new()
            .set_title("IWXA T3: подтвердить корпоративное решение")
            .set_description(&format!(
                "Подтвердить {} для подписанного пакета {}? Операция будет записана исходным Reconciliation.",
                kind,digest))
            .set_buttons(rfd::MessageButtons::YesNo)
            .set_level(rfd::MessageLevel::Warning)
            .show();
        if answer!=rfd::MessageDialogResult::Yes{
            return Err("CEN_D3_HUMAN_REVIEW_CANCELLED".into());
        }
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
    }else if operation=="d3ReceiveAge"{
        let Some(path)=age::choose_corporate_receive() else {
            return Ok(json!({"status":"CANCELLED"}));
        };
        Some(path)
    }else if matches!(operation.as_str(),"d3ExportTask"|"d3ExportInvitation"){
        // Native Windows Save dialog, not a WebView-supplied arbitrary path.
        // The original private owner writes & reads back exact signed bytes.
        let title=if operation=="d3ExportTask"{
            "Сохранить подписанную Task T3"
        }else{"Сохранить подписанное приглашение T3"};
        let name=if operation=="d3ExportTask"{
            "iwxa-signed-task.iwxa"
        }else{"iwxa-signed-invitation.iwxa"};
        let selection=rfd::FileDialog::new()
            .set_title(title).add_filter("IWXA",&["iwxa"])
            .set_file_name(name).save_file();
        let Some(path)=selection else {
            return Ok(json!({"status":"CANCELLED"}));
        };
        if !path.extension().and_then(|s|s.to_str())
            .is_some_and(|s|s.eq_ignore_ascii_case("iwxa")){
            return Err("CEN_D3_IWXA_DESTINATION_REQUIRED".into());
        }
        Some(path)
    }else{None};
    tauri::async_runtime::spawn_blocking(move||{
        // A changed actor or signed scope cancels the selected UI decision.
        // The ORIGINAL owner must revalidate at its own JIT as well.
        let observed=private_owner_state(&app,&organization_id)?;
        if !exact_binding(&observed,&organization_id,&binding){
            return Err("CEN_D3_CONTEXT_CHANGED".into());
        }
        if !exact_kernel_apply_capability(&observed,&operation){
            return Err("CEN_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED".into());
        }
        // The already installed ORIGINAL T3 age executable first verifies
        // ciphertext/X25519 and creates a short-lived, private plaintext
        // file. It stays alive only until ORIGINAL D3 Reconciliation finishes.
        let mut original_age_file=None;
        let (source_for_owner,decrypted)=if operation=="d3ReceiveAge"{
            let chosen=selected_path.as_ref().ok_or("CEN_D3_AGE_SOURCE_REQUIRED")?;
            let transient=age::TransientPackage::new()?;
            let receipt=age::decrypt_source(
                &app,&corporate_age_root(&app,&organization_id)?,
                chosen,&transient.path)?;
            let source=transient.path.clone();
            original_age_file=Some(transient);
            (Some(source),Some(receipt))
        }else{(selected_path,None)};
        let payload=json!({
            "organizationId":organization_id,
            "operation":if operation=="d3ReceiveAge"{"d3Receive"}else{operation.as_str()},
            "input":input,
            "binding":binding,
            "archivePath":source_for_owner.as_ref()
                .map(|p|p.to_string_lossy().to_string())
        });
        let temporary_request=store_request(&app,&payload)?;
        let output=t3::run(&app,"admin-d3","d3-action", &[
            organization_id.clone(),temporary_request.0.to_string_lossy().into_owned(),
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
        // Age decryption is NOT admission. The original T3 recipient must
        // prove it received the same signed archive as the age tool verified.
        let mut result=output["result"].clone();
        if operation=="d3ApplyAccepted"{
            verify_kernel_apply(&result,&input,&observed)?;
        }
        if operation=="d3RecoverApplied"{
            verify_kernel_recovery(&result,&input,&observed)?;
        }
        if let Some(proof)=decrypted{
            if proof["operation"]!="AGE_DECRYPTED"||
               proof["admitted"]!=false||
               proof["state"]!="DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED"||
               !validate_hex(proof["sourceSha256"].as_str())||
               !validate_hex(proof["ciphertextSha256"].as_str())||
               result["preview"]["packageSha256"]!=proof["sourceSha256"]||
               result["transportReceipt"]["packageSha256"]!=proof["sourceSha256"]{
                return Err("CEN_D3_AGE_ADMISSION_READBACK_UNKNOWN".into());
            }
            result["encryptedTransport"]=json!({
                "ciphertextSha256":proof["ciphertextSha256"],
                "sourceSha256":proof["sourceSha256"],
                "status":"DECRYPTED_THEN_RECEIVED_BY_ORIGINAL_T3"
            });
        }
        drop(original_age_file);
        // No implicit ACCEPT or Kernel Apply.
        Ok(result)
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
              "d3TaskIssueAvailable":true,"tasks":[],"totalTasks":0,
              "d3ApplyAvailable":false,"productionActivation":false,
              "T3_READY":false}}});
        let qualified=supported_state(&valid,"org:1","D3_STATE").unwrap();
        assert_eq!(qualified["snapshot"]["d3ApplyRecoverAvailable"],false);
        assert!(!exact_kernel_apply_capability(&qualified,"d3ApplyAccepted"));
        assert!(!exact_kernel_apply_capability(&qualified,"d3RecoverApplied"));
        assert!(exact_kernel_apply_capability(&qualified,"d3InspectAccepted"));
        let mut recovery_capable=valid.clone();
        recovery_capable["view"]["snapshot"]["d3ApplyAvailable"]=Value::Bool(true);
        recovery_capable["view"]["snapshot"]["d3ApplyRecoverAvailable"]=Value::Bool(true);
        assert_eq!(supported_state(&recovery_capable,"org:1","D3_STATE")
            .unwrap()["snapshot"]["d3ApplyRecoverAvailable"],true);
        let checked=supported_state(&recovery_capable,"org:1","D3_STATE").unwrap();
        assert!(exact_kernel_apply_capability(&checked,"d3ApplyAccepted"));
        assert!(exact_kernel_apply_capability(&checked,"d3RecoverApplied"));
        let mut no_recovery=checked.clone();
        no_recovery["snapshot"]["d3ApplyRecoverAvailable"]=Value::Bool(false);
        assert!(exact_kernel_apply_capability(&no_recovery,"d3ApplyAccepted"));
        assert!(!exact_kernel_apply_capability(&no_recovery,"d3RecoverApplied"));
        recovery_capable["view"]["snapshot"]["d3ApplyAvailable"]=Value::Bool(false);
        assert!(supported_state(&recovery_capable,"org:1","D3_STATE").is_err());
        assert!(supported_state(&valid,"org:2","D3_STATE").is_err());
        let mut forged=valid.clone();
        forged["view"]["snapshot"]["T3_READY"]=Value::Bool(true);
        assert!(supported_state(&forged,"org:1","D3_STATE").is_err());
        forged=valid.clone();forged["ownerMode"]=Value::String("TEST_OWNER".into());
        assert!(supported_state(&forged,"org:1","D3_STATE").is_err());
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
        assert!(check_bound_request(&json!({"packageSha256":"a".repeat(64),
            "resultOffset":4096}),"d3Preview").is_ok());
        assert!(check_bound_request(&json!({"packageSha256":"a".repeat(64),
            "resultOffset":-1}),"d3Preview").is_err());
        assert!(check_bound_request(&json!({"packageSha256":"a".repeat(64),
            "resultOffset":100001}),"d3Preview").is_err());
        assert!(check_bound_request(&json!({"task":"Подготовить смету",
            "taskId":"task:11111111-2222-3333-4444-555555555555"}),
            "d3CreateTask").is_ok());
        assert!(check_bound_request(&json!({"taskId":"task:11111111"}),
            "d3TaskReadback").is_ok());
        assert!(check_bound_request(&json!({"task":"Подготовить смету"}),
            "d3CreateTask").is_err());
        assert!(check_bound_request(&json!({"task":"  "}),
            "d3CreateTask").is_err());
        assert!(check_bound_request(&json!({"taskId":"task:one"}),
            "d3ExportTask").is_ok());
        assert!(check_bound_request(&json!({"decision":"ACCEPT",
            "operationId":"decision:one","packageSha256":"a".repeat(64),
            "previewDigest":"b".repeat(64)}),"d3Decide").is_ok());
        assert!(check_bound_request(&json!({"acceptanceId":"c".repeat(64),
            "revisionIds":["d".repeat(64),"d".repeat(64)]}),
            "d3ApplyAccepted").is_err());
    }
    #[test]
    fn first_kernel_apply_requires_original_committed_object_event_and_result(){
        let effect="a".repeat(64);
        let accepted="b".repeat(64);
        let revision="c".repeat(64);
        let view=json!({"snapshot":{"workspaceId":"workspace:1",
            "organizationId":"org:1"}});
        let selection=json!({"acceptanceId":accepted,
            "revisionIds":[revision]});
        let object_id=format!("result:applied:{effect}");
        let mut result=json!({
            "kernelWriteReadback":"CONFIRMED",
            "reconciliationLedgerSync":"OWNER_FOLLOWUP_REQUIRED",
            "externalProductAcceptance":"NOT_ACCEPTED",
            "originalKernelReceipt":{
                "workspace_id":"workspace:1",
                "object":{"workspace_id":"workspace:1",
                    "object_id":object_id,"revision":1,
                    "schema_id":"iwxa.admin.applied-results"},
                "event":{"event_id":"event:original-1",
                    "workspace_id":"workspace:1",
                    "object_id":format!("result:applied:{effect}"),
                    "revision":1,
                    "event_type":"iwxa.admin.result.applied",
                    "idempotency_key":effect,
                    "payload":{"reconciliation_acceptance_id":accepted,
                        "reconciliation_revision_ids":[revision]}}
            },
            "originalKernelReadback":{"object":{
                "workspace_id":"workspace:1",
                "object_id":format!("result:applied:{effect}"),
                "revision":1,"schema_id":"iwxa.admin.applied-results",
                "schema_version":"1.0.0",
                "data":{"schema":"IWXA_T3_ADMIN_APPLIED_RESULTS/1",
                    "records":[{"acceptanceId":accepted,
                        "resultRevisionId":revision,
                        "workspaceId":"workspace:1","organizationId":"org:1",
                        "result":"Результат принят"}]}}}
        });
        assert!(verify_kernel_apply(&result,&selection,&view).is_ok());
        result["originalKernelReceipt"]["event"]["idempotency_key"]
            =json!("d".repeat(64));
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalKernelReceipt"]["event"]["idempotency_key"]
            =json!(effect);
        result["originalKernelReadback"]["object"]["data"]["records"][0]
            ["resultRevisionId"]=json!("e".repeat(64));
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalKernelReadback"]["object"]["data"]["records"][0]
            ["resultRevisionId"]=selection["revisionIds"][0].clone();
        result["originalKernelReceipt"]["event"]["payload"]
            ["reconciliation_acceptance_id"]=json!("f".repeat(64));
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalKernelReceipt"]["event"]["payload"]
            ["reconciliation_acceptance_id"]=selection["acceptanceId"].clone();
        result["originalKernelReadback"]["object"]["workspace_id"]
            =json!("workspace:foreign");
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
    }
    #[test]
    fn recovery_requires_exact_original_event_object_and_acceptance_proof(){
        let digest="a".repeat(64);
        let accepted="c".repeat(64);
        let revision="d".repeat(64);
        let input=json!({"acceptanceId":accepted,"revisionIds":[revision]});
        let view=json!({"snapshot":{"workspaceId":"workspace:1",
            "organizationId":"org:1"}});
        let mut result=json!({
            "status":"ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED",
            "effectKey":digest,"kernelWriteReadback":"CONFIRMED",
            "automaticRetryAllowed":false,
            "externalProductAcceptance":"NOT_ACCEPTED",
            "originalKernelReadback":{"object":{
                "workspace_id":"workspace:1",
                "object_id":format!("result:applied:{digest}"),
                "revision":1,"schema_id":"iwxa.admin.applied-results",
                "schema_version":"1.0.0",
                "data":{"schema":"IWXA_T3_ADMIN_APPLIED_RESULTS/1",
                    "records":[{"acceptanceId":accepted,
                        "resultRevisionId":revision,
                        "workspaceId":"workspace:1","organizationId":"org:1",
                        "result":"Подписанный результат"}]}}},
            "originalEventReadback":{"workspace_id":"workspace:1",
                "event_id":"event:1","event_type":"iwxa.admin.result.applied",
                "object_id":format!("result:applied:{digest}"),
                "revision":1,"idempotency_key":digest,
                "payload":{"reconciliation_acceptance_id":accepted,
                    "reconciliation_revision_ids":[revision]}}
        });
        assert!(verify_kernel_recovery(&result,&input,&view).is_ok());
        result["originalEventReadback"]["idempotency_key"]=json!("b".repeat(64));
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result["originalEventReadback"]["idempotency_key"]=json!(digest);
        result["originalEventReadback"]["payload"]["reconciliation_acceptance_id"]
            =json!("d".repeat(64));
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result["originalEventReadback"]["payload"]["reconciliation_acceptance_id"]
            =json!(accepted);
        result["originalKernelReadback"]["object"]["workspace_id"]=json!("workspace:other");
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        // A superficially matching event must not turn an unrelated
        // Object or altered accepted Result into a successful recovery.
        let canonical=result.clone();
        result["originalKernelReadback"]["object"]["object_id"]=json!("object:foreign");
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical.clone();
        result["originalKernelReadback"]["object"]["schema_id"]=json!("other");
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical.clone();
        result["originalKernelReadback"]["object"]["data"]["records"][0]
            ["resultRevisionId"]=json!("f".repeat(64));
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical.clone();
        result["originalKernelReadback"]["object"]["data"]["records"][0]
            ["organizationId"]=json!("org:other");
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical.clone();
        result["originalEventReadback"]["event_type"]=json!("other");
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical.clone();
        result["originalKernelReadback"]["object"]["revision"]=json!(2);
        assert!(verify_kernel_recovery(&result,&input,&view).is_err());
        result=canonical;
        let unknown=json!({"status":"OUTCOME_UNKNOWN","effectKey":digest,
            "kernelWriteReadback":"NOT_CONFIRMED","automaticRetryAllowed":false});
        assert!(verify_kernel_recovery(&unknown,&input,&view).is_ok());
        let mut forged=unknown.clone();
        forged["originalEventReadback"]=json!({"event_id":"event:fake"});
        assert!(verify_kernel_recovery(&forged,&input,&view).is_err());
    }
}
