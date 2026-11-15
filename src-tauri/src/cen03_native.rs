// Native corporate port for the ORIGINAL, privately packaged T3 owner.
// It does not implement Reconciliation, D1 IAM, signatures, Store or Kernel.
// There is one trusted executable already owned by the T3 distribution;
// absent original provisioning means NOT_CONNECTED, never a test fallback.
use serde_json::{json,Value};
 use std::{fs::{self,OpenOptions},io::{BufRead,BufReader,Read,Write},
    path::{Path,PathBuf},process::{Child,ChildStdin},
    sync::{mpsc::{self,Receiver},Mutex},time::Duration};
use tauri::{AppHandle,Emitter,Manager};
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

// Match the original T3 JavaScript .length contract (UTF-16 code units).
// UTF-8 bytes would reject ordinary Russian Task text at half the UI limit.
fn original_text_len(value:&str)->usize{value.encode_utf16().count()}
fn valid_enrollment_details(workspace_id:&str,organization_name:&str)->bool{
    t3::valid_identifier(workspace_id)&&
    !organization_name.trim().is_empty()&&
    original_text_len(organization_name)<=120
}

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
              !s.trim().is_empty()&&original_text_len(s)<=10000) {
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
           !input["reason"].as_str().is_some_and(|s|!s.trim().is_empty()&&original_text_len(s)<=1000)) {
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
    // One Core independently re-reads the committed event from the same T2
    // Kernel. The commit receipt alone must never qualify Human APPLY.
    let witnessed=&result["originalEventReadback"];
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
    if !valid_original_applied_graph(read,event,input,view)||
       !valid_original_applied_graph(read,witnessed,input,view)||
       witnessed["event_id"]!=event["event_id"]||
       witnessed["event_type"]!=event["event_type"]||
       witnessed["idempotency_key"]!=event["idempotency_key"]{
        // A missing or different independent Event readback means the write
        // MAY have committed. Recovery is read-only, never a second APPLY.
        return Err(bad());
    }
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
// CEN03 owns only the lifetime of the EXACT private signed D3 executable
// already shipped by the original T3 product owner. Its stdin calls use the
// original runtime, one product.lock and one signed DPAPI owner; no new
// Kernel, Store, issuer, Reconciliation or external sidecar is created.
const D3_HOST_CALL:&str="IWXA_T3_D3_NATIVE_OWNER_CALL/1";
const D3_HOST_REPLY:&str="IWXA_T3_D3_NATIVE_OWNER_REPLY/1";
#[derive(Default)]
pub struct Session{owner:Option<OriginalOwner>}
struct OriginalOwner{
    organization_id:String,
    child:Child,
    input:ChildStdin,
    responses:Receiver<Result<Vec<u8>,String>>,
    next_id:u64,
}
impl Drop for OriginalOwner{
    fn drop(&mut self){
        // Ending the installed Center or changing organizations MUST release
        // the original product.lock before any other owner may open it.
        let _=self.child.kill();
        let _=self.child.wait();
    }
}
fn host_reply(reply:&Value,id:u64)->Result<Value,String>{
    if reply["schema"]!=D3_HOST_REPLY||reply["id"]!=id{
        return Err("CEN_D3_ORIGINAL_HOST_REPLY_INVALID".into());
    }
    match reply["ok"].as_bool(){
        Some(false)=>{
            let code=reply["code"].as_str().unwrap_or("");
            if code.len()<5||code.len()>100||
               !code.bytes().all(|b|b.is_ascii_uppercase()||
                   b.is_ascii_digit()||b==b'_'){
                return Err("CEN_D3_ORIGINAL_HOST_REJECTED".into());
            }
            Err(code.to_owned())
        },
        Some(true)=>{
            let value=&reply["result"];
            if value["schema"]!=SCHEMA||
               value["ownerMode"]!="ORIGINAL_SIGNED_CORPORATE_D3"||
               value["productionActivation"]!=false||
               value["T3_READY"]!=false||value["activeSeats"]!=0{
                return Err("CEN_D3_ORIGINAL_HOST_RESULT_INVALID".into());
            }
            Ok(value.clone())
        },
        None=>Err("CEN_D3_ORIGINAL_HOST_REPLY_INVALID".into()),
    }
}
impl OriginalOwner{
    fn open(app:&AppHandle,organization_id:&str)->Result<Self,String>{
        let child=t3::spawn_admin_d3_host(app,organization_id)?;
        Self::from_child(child,organization_id)
    }
    fn from_child(mut child:Child,organization_id:&str)->Result<Self,String>{
        let input=match child.stdin.take(){
            Some(input)=>input,
            None=>{
                // std::process::Child drop does NOT terminate a process.
                // Without cleanup this orphan could hold product.lock.
                let _=child.kill();let _=child.wait();
                return Err("CEN_D3_ORIGINAL_HOST_STDIN_UNAVAILABLE".into());
            }
        };
        let output=match child.stdout.take(){
            Some(output)=>output,
            None=>{
                let _=child.kill();let _=child.wait();
                return Err("CEN_D3_ORIGINAL_HOST_STDOUT_UNAVAILABLE".into());
            }
        };
        // Read only the SAME pinned owner's line-delimited native receipts.
        // A bounded channel avoids unbounded queued responses. A timeout
        // kills this owner; callers must use original read-only recovery
        // instead of redispatching a possibly committed action.
        let (sender,responses)=mpsc::sync_channel(1);
        std::thread::spawn(move||{
            let mut reader=BufReader::new(output);
            loop{
                let mut line=Vec::new();
                // Bounded read prevents a malformed native response from
                // allocating an unlimited line before the size check.
                let read=reader.by_ref().take((MAX_REQUEST+1) as u64)
                    .read_until(b'\n',&mut line);
                let result=match read{
                    Ok(0)=>Err("CEN_D3_ORIGINAL_HOST_EOF".to_owned()),
                    Ok(_) if line.len()>MAX_REQUEST=>
                        Err("CEN_D3_ORIGINAL_HOST_OUTPUT_TOO_LARGE".to_owned()),
                    Ok(_)=>Ok(line),
                    Err(_)=>Err("CEN_D3_ORIGINAL_HOST_READ_FAILED".to_owned()),
                };
                let stop=result.is_err();
                if sender.send(result).is_err()||stop{break;}
            }
        });
        Ok(Self{organization_id:organization_id.into(),
            child,input,responses,next_id:0})
    }
    fn call(&mut self,verb:&str,body:&Value)->Result<Value,String>{
        if self.child.try_wait().map_err(|_|"CEN_D3_ORIGINAL_HOST_WAIT_FAILED")?
            .is_some(){
            return Err("CEN_D3_ORIGINAL_HOST_EXITED".into());
        }
        let id=self.next_id.checked_add(1)
            .filter(|id|*id<=9_007_199_254_740_991)
            .ok_or("CEN_D3_ORIGINAL_HOST_REQUEST_ID_EXHAUSTED")?;
        self.next_id=id;
        let request=json!({"schema":D3_HOST_CALL,"id":id,"verb":verb,
            "body":body});
        let mut bytes=serde_json::to_vec(&request)
            .map_err(|_|"CEN_D3_ORIGINAL_HOST_INPUT_INVALID")?;
        if bytes.len()+1>MAX_REQUEST{
            return Err("CEN_D3_ORIGINAL_HOST_INPUT_TOO_LARGE".into());
        }
        bytes.push(b'\n');
        self.input.write_all(&bytes).and_then(|_|self.input.flush())
            .map_err(|_|"CEN_D3_ORIGINAL_HOST_SEND_FAILED")?;
        let line=self.responses.recv_timeout(Duration::from_secs(90))
            .map_err(|_|"CEN_D3_ORIGINAL_HOST_OUTCOME_UNKNOWN")??;
        let reply:Value=serde_json::from_slice(&line)
            .map_err(|_|"CEN_D3_ORIGINAL_HOST_JSON_INVALID")?;
        host_reply(&reply,id)
    }
}
// These errors originate ONLY in the existing One Core D3 read-only
// Workspace preflight, before Human APPLY and before commitObjectGraph.
// The installed owner keeps its signed Context and browser Kernel alive so
// the manager can provision the same original Workspace and retry a NEW
// explicit Human decision. All unknown/post-dispatch failures still close
// this native owner and require original cold readback.
fn definite_d3_pre_apply_workspace_refusal(
    verb:&str,body:&Value,result:&Result<Value,String>
)->bool{
    verb=="action"&&body["operation"]=="d3ApplyAccepted"&&
    matches!(result,Err(code) if matches!(code.as_str(),
        "T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED"|
        "T3_D3_ORIGINAL_WORKSPACE_DELETED"|
        "T3_D3_ORIGINAL_WORKSPACE_READ_ONLY"))
}
fn original_owner_call(app:&AppHandle,organization_id:&str,verb:&str,
    body:Value)->Result<Value,String>{
    let state=app.state::<Mutex<Session>>();
    let mut guard=state.lock()
        .map_err(|_|"CEN_D3_ORIGINAL_HOST_SESSION_UNAVAILABLE")?;
    if guard.owner.as_ref()
        .map(|owner|owner.organization_id.as_str())!=Some(organization_id){
        // A signed Workspace must never survive a switch to another
        // organization while the old DPAPI owner is released.
        close_original_signed_workspace(app)?;
        guard.owner.take();
        guard.owner=Some(OriginalOwner::open(app,organization_id)?);
    }
    let result=guard.owner.as_mut()
        .ok_or("CEN_D3_ORIGINAL_HOST_SESSION_UNAVAILABLE")?
        .call(verb,&body);
    if result.is_err()&&
        !definite_d3_pre_apply_workspace_refusal(verb,&body,&result){
        // Unknown or post-dispatch error: original T2 may have committed
        // before ACK was lost. Revoke the browser and require cold readback.
        let _=close_original_signed_workspace(app);
        guard.owner.take();
    }
    result
}
fn close_original_owner(app:&AppHandle)->Result<(),String>{
    let state=app.state::<Mutex<Session>>();
    let mut guard=state.lock()
        .map_err(|_|"CEN_D3_ORIGINAL_HOST_SESSION_UNAVAILABLE")?;
    close_original_signed_workspace(app)?;
    guard.owner.take();
    Ok(())
}
fn private_owner_state(app:&AppHandle,organization_id:&str)->Result<Value,String>{
    let result=original_owner_call(app,organization_id,"state",Value::Null)?;
    supported_state(&result,organization_id,"D3_STATE")
}
// The original signed Workspace is a child WebView of Admin Center's ONE
// desktop window. Never open an external browser, another Tauri window, or a
// caller-supplied URL. The signed D3 owner supplies its two loopback origins.
const SIGNED_WORKSPACE_WEBVIEW:&str="iwxa-t3-signed-workspace";
fn original_signed_workspace_origins(view:&Value)
    ->Result<(tauri::Url,String,String),String>{
    let s=&view["snapshot"];
    if s["product"]!="admin"||s["d3RecipientAvailable"]!=true||
        s["T3_READY"]!=false||
        !s["originalControlEpoch"].as_u64().is_some_and(|n|n>0) {
        return Err("CEN_D3_ORIGINAL_CONTROL_NOT_CONNECTED".into());
    }
    let expected=s["originalControlOrigin"].as_str()
        .ok_or("CEN_D3_ORIGINAL_CONTROL_NOT_CONNECTED")?;
    let selected=s["originalIsolatedWorkspaceUrl"].as_str()
        .ok_or("CEN_D3_ORIGINAL_CONTROL_NOT_CONNECTED")?;
    let trusted=tauri::Url::parse(expected)
        .map_err(|_|"CEN_D3_ORIGINAL_CONTROL_ORIGIN_INVALID")?;
    let url=tauri::Url::parse(selected)
        .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_URL_INVALID")?;
    let local=|u:&tauri::Url|u.scheme()=="http"&&
        u.host_str()==Some("127.0.0.1")&&
        u.port().is_some()&&u.username().is_empty()&&
        u.password().is_none()&&u.query().is_none();
    if !local(&trusted)||!local(&url)||trusted.path()!="/"||
        trusted.fragment().is_some()||
        url.path()!="/workspace/isolated-signed-workspace.html"||
        trusted.origin()==url.origin(){
        return Err("CEN_D3_ORIGINAL_WORKSPACE_ORIGIN_INVALID".into());
    }
    let token=url.fragment().unwrap_or("");
    if !(40..=128).contains(&token.len())||
        !token.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){
        return Err("CEN_D3_ORIGINAL_WORKSPACE_BEARER_INVALID".into());
    }
    let ui_origin=url.origin().ascii_serialization();
    let kernel_origin=trusted.origin().ascii_serialization();
    Ok((url,ui_origin,kernel_origin))
}
// Projection for the ordinary React frontend. The bearer and pinned
// Control address remain in the native process; React only gets a capability
// presence bit and never receives the signed Workspace fragment credential.
fn public_signed_workspace_projection(mut view:Value)->Value{
    let available=original_signed_workspace_origins(&view).is_ok();
    if let Some(snapshot)=view.get_mut("snapshot")
        .and_then(Value::as_object_mut){
        snapshot.remove("originalIsolatedWorkspaceUrl");
        snapshot.remove("originalControlOrigin");
        snapshot.remove("originalControlEpoch");
        snapshot.insert("originalSignedWorkspaceAvailable".into(),
            Value::Bool(available));
    }
    view
}
fn signed_workspace_navigation_allowed(
    candidate:&tauri::Url,ui_origin:&str,kernel_origin:&str
)->bool{
    let origin=candidate.origin().ascii_serialization();
    if candidate.scheme()!="http"||candidate.host_str()!=Some("127.0.0.1")||
        candidate.username()!=""||candidate.password().is_some()||
        candidate.query().is_some(){return false;}
    if origin==ui_origin{
        return matches!(candidate.path(),
            "/workspace/isolated-signed-workspace.html"|"/workspace/");
    }
    // Only the existing signed iframe may use the original trusted origin.
    // Never allow top-level arbitrary Control, loader or API navigation.
    origin==kernel_origin&&
        candidate.path()=="/workspace/trusted-kernel-realm.html"&&
        candidate.fragment().is_none()
}
fn close_original_signed_workspace(app:&AppHandle)->Result<(),String>{
    if let Some(webview)=app.get_webview(SIGNED_WORKSPACE_WEBVIEW){
        webview.close()
            .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_CLOSE_FAILED".to_owned())?;
        // Keep the existing React navigation in sync with the ONE native
        // child, including revocation initiated by a signed Task mutation.
        let _=app.emit_to("main","iwxa:d3-signed-workspace-closed",());
    }
    Ok(())
}
#[tauri::command]
pub async fn center_corporate_close_signed_workspace(
    app:AppHandle
)->Result<(),String>{
    // Closing the native child also releases the ORIGINAL DPAPI D3 Host.
    // Otherwise a detached WebView leaves d3ApplyAvailable=true while the
    // trusted browser Kernel is gone: the next Human APPLY would hang and
    // incorrectly become OUTCOME_UNKNOWN. The next state/open command
    // cold-opens the SAME signed original owner with a fresh bearer/epoch.
    tauri::async_runtime::spawn_blocking(move||
        close_original_owner(&app)
    ).await.map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_WORKER_FAILED".to_owned())?
}
// The signed Kernel MUST remain alive while the manager returns to the
// native Center Review/Apply controls in the same window. Hiding only the
// child WebView is not a logout: use close_signed_workspace to release the
// native owner and revoke the original Kernel session.
#[tauri::command]
pub async fn center_corporate_hide_signed_workspace(
    app:AppHandle
)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        let webview=app.get_webview(SIGNED_WORKSPACE_WEBVIEW)
            .ok_or("CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING")?;
        webview.hide()
            .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_HIDE_FAILED".to_owned())?;
        // The native Review controls live in the original main WebView.
        // Recover keyboard focus after hiding the child; focus failure
        // cannot turn a successful hide into a misleading UI error.
        if let Some(main)=app.get_webview("main"){
            let _=main.set_focus();
        }
        Ok(())
    }).await.map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_show_signed_workspace(
    app:AppHandle,organization_id:String
)->Result<(),String>{
    check_org(&organization_id)?;
    tauri::async_runtime::spawn_blocking(move||{
        // Revalidate the ORIGINAL installed signer and Control epoch before
        // showing a previously hidden child, never revive a foreign owner.
        let view=private_owner_state(&app,&organization_id)?;
        original_signed_workspace_origins(&view)?;
        let webview=app.get_webview(SIGNED_WORKSPACE_WEBVIEW)
            .ok_or("CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING")?;
        webview.show()
            .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_SHOW_FAILED".to_owned())?;
        let _=webview.set_focus();
        Ok(())
    }).await.map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_open_signed_workspace(
    app:AppHandle,organization_id:String
)->Result<(),String>{
    check_org(&organization_id)?;
    tauri::async_runtime::spawn_blocking(move||{
        if !t3::admin_d3_availability(&app,&organization_id){
            return Err("CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED".into());
        }
        // The URL is taken ONLY from the same installed DPAPI/Ed25519 owner
        // that Center uses for Task/Result. No WebView input can select a URL.
        let view=private_owner_state(&app,&organization_id)?;
        let (url,ui_origin,kernel_origin)=
            original_signed_workspace_origins(&view)?;
        // Keep a single WebView. The separate browser Kernel realm remains
        // an iframe at the pinned Control origin, not a second native window.
        if let Some(existing)=app.get_webview(SIGNED_WORKSPACE_WEBVIEW){
            // The React main WebView may be reloaded independently while
            // the signed T3 child and original Kernel stay alive. Reuse that
            // SAME child under the already revalidated native owner instead
            // of marooning the user behind an ALREADY_OPEN error.
            existing.show()
                .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_SHOW_FAILED".to_owned())?;
            let _=existing.set_focus();
            return Ok(());
        }
        let window=app.get_window("main")
            .ok_or("CEN_D3_ORIGINAL_MAIN_WINDOW_REQUIRED")?;
        let physical=window.inner_size()
            .map_err(|_|"CEN_D3_ORIGINAL_WINDOW_BOUNDS_REQUIRED")?;
        let scale=window.scale_factor()
            .map_err(|_|"CEN_D3_ORIGINAL_WINDOW_SCALE_REQUIRED")?;
        let logical=physical.to_logical::<f64>(scale);
        if logical.width<720.0||logical.height<500.0{
            return Err("CEN_D3_ORIGINAL_WORKSPACE_WINDOW_TOO_SMALL".into());
        }
        // Preserve the existing 219px sidebar and main 45px toolbar for
        // native close/navigation. The one-window child occupies only the
        // content surface; native dpi/logical sizing follows Tauri.
        let x=219.0;
        let y=91.0;
        let builder=tauri::webview::WebviewBuilder::new(
            SIGNED_WORKSPACE_WEBVIEW,tauri::WebviewUrl::External(url)
        ).auto_resize()
        .on_navigation(move|candidate|
            signed_workspace_navigation_allowed(
                &candidate,&ui_origin,&kernel_origin))
        .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny);
        window.add_child(builder,
            tauri::LogicalPosition::new(x,y),
            tauri::LogicalSize::new(logical.width-x,logical.height-y))
            .map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_CREATE_FAILED")?;
        Ok(())
    }).await.map_err(|_|"CEN_D3_ORIGINAL_WORKSPACE_WORKER_FAILED".to_owned())?
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
        // A switch to an unenrolled organization must release the previous
        // original product.lock, not leave a hidden owner in another scope.
        close_original_owner(&app)?;
        return Ok(json!({"status":"NOT_CONNECTED",
            "enrollmentAvailable":t3::binary_present(&app,"admin-d3")}));
    }
    tauri::async_runtime::spawn_blocking(move||
        private_owner_state(&app,&organization_id)
            .map(public_signed_workspace_projection))
        .await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[tauri::command]
pub async fn center_corporate_enroll(
    app:AppHandle,organization_id:String,workspace_id:String,
    organization_name:String
)->Result<Value,String>{
    check_org(&organization_id)?;
    if !valid_enrollment_details(&workspace_id,&organization_name){
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
        // Enrollment is the existing private CLI ceremony. It cannot run
        // concurrently with the persistent owner of this same product.lock.
        close_original_owner(&app)?;
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
        // The ORIGINAL T2 Kernel lives exclusively in the currently
        // mounted trusted child WebView. A stale native APPLY capability
        // after that view is gone must NOT prompt Human approval or enter
        // an operation that can only end as OUTCOME_UNKNOWN.
        if app.get_webview(SIGNED_WORKSPACE_WEBVIEW).is_none(){
            close_original_owner(&app)?;
            return Err("CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING".into());
        }
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
        // The manager may have closed the child while the separate Windows
        // Human APPLY dialog was visible. This check still precedes the
        // private owner's first Kernel dispatch and cannot cause a replay.
        if matches!(operation.as_str(),"d3ApplyAccepted"|"d3RecoverApplied")&&
            app.get_webview(SIGNED_WORKSPACE_WEBVIEW).is_none(){
            close_original_owner(&app)?;
            return Err("CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING".into());
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
        // The same original DPAPI/Ed25519 owner now processes state, Task,
        // Result and Reconciliation without reopening its product.lock for
        // every button click. Signed context is revalidated inside it.
        let output=original_owner_call(&app,&organization_id,"action",payload)?;
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
            if let Err(error)=verify_kernel_apply(&result,&input,&observed){
                // The ORIGINAL Kernel may already have written an Object and
                // Event. A forged/missing independent readback is UNKNOWN,
                // never a pre-dispatch denial. End the same signed session;
                // recovery must cold-open the original owner and READ only.
                let _=close_original_owner(&app);
                return Err(error);
            }
        }
        if operation=="d3RecoverApplied"{
            if let Err(error)=verify_kernel_recovery(&result,&input,&observed){
                // Do not retain a native owner that returned false original
                // Kernel evidence, even during a read-only recovery attempt.
                let _=close_original_owner(&app);
                return Err(error);
            }
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
        // These three original native actions advance the signed D3 epoch
        // and rotate the bearer in the existing private Host. Its former
        // Workspace must no longer remain mounted after successful Task
        // issuance. A view-close failure cannot turn an already completed
        // signed operation into a retryable failure.
        if matches!(operation.as_str(),
            "d3CreateTask"|"d3ExportTask"|"d3ExportInvitation"){
            let _=close_original_signed_workspace(&app);
        }
        // No implicit ACCEPT or Kernel Apply.
        Ok(result)
    }).await.map_err(|_|"CEN_D3_NATIVE_WORKER_FAILED".to_owned())?
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn pre_apply_workspace_refusal_keeps_original_native_owner_live(){
        let apply=json!({"operation":"d3ApplyAccepted"});
        for code in [
            "T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED",
            "T3_D3_ORIGINAL_WORKSPACE_DELETED",
            "T3_D3_ORIGINAL_WORKSPACE_READ_ONLY",
        ]{
            let refusal=Err(code.to_string());
            assert!(definite_d3_pre_apply_workspace_refusal(
                "action",&apply,&refusal));
            assert!(!definite_d3_pre_apply_workspace_refusal(
                "state",&apply,&refusal));
            assert!(!definite_d3_pre_apply_workspace_refusal(
                "action",&json!({"operation":"d3Decide"}),&refusal));
        }
        for code in [
            "T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN",
            "T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED",
            "WORKSPACE_NOT_FOUND","PERMISSION_DENIED",
            "CEN_D3_ORIGINAL_HOST_OUTCOME_UNKNOWN",
        ]{
            assert!(!definite_d3_pre_apply_workspace_refusal(
                "action",&apply,&Err(code.to_string())));
        }
        assert!(!definite_d3_pre_apply_workspace_refusal(
            "action",&apply,&Ok(json!({"status":"CONFIRMED"}))));
    }
    #[test]
    fn signed_workspace_comes_only_from_original_two_loopback_origins(){
        let original=json!({"snapshot":{
            "product":"admin","d3RecipientAvailable":true,"T3_READY":false,
            "originalControlEpoch":8,
            "originalControlOrigin":"http://127.0.0.1:18883",
            "originalIsolatedWorkspaceUrl":
                format!("http://127.0.0.1:18884/workspace/isolated-signed-workspace.html#{}",
                    "A".repeat(43))
        }});
        let (url,ui,kernel)=original_signed_workspace_origins(&original).unwrap();
        assert_eq!(url.path(),"/workspace/isolated-signed-workspace.html");
        assert_eq!(ui,"http://127.0.0.1:18884");
        assert_eq!(kernel,"http://127.0.0.1:18883");
        let projected=public_signed_workspace_projection(original.clone());
        assert_eq!(projected["snapshot"]["originalSignedWorkspaceAvailable"],true);
        assert!(projected["snapshot"].get("originalIsolatedWorkspaceUrl").is_none(),
            "React must never see the session fragment bearer");
        assert!(projected["snapshot"].get("originalControlOrigin").is_none(),
            "the pinned Control URL belongs only to native code");
        assert!(projected["snapshot"].get("originalControlEpoch").is_none());
        assert!(signed_workspace_navigation_allowed(&url,&ui,&kernel));
        let trusted=tauri::Url::parse(
            "http://127.0.0.1:18883/workspace/trusted-kernel-realm.html"
        ).unwrap();
        assert!(signed_workspace_navigation_allowed(&trusted,&ui,&kernel));
        for denied in [
            "http://127.0.0.1:18883/api/t3/context-epoch",
            "http://127.0.0.1:18883/_iwxa/loader.js",
            "http://127.0.0.1:18884/workspace/signed-workspace.html",
            "http://127.0.0.1:18884/workspace/isolated-signed-workspace.html?x=1",
            "http://localhost:18884/workspace/",
            "https://127.0.0.1:18884/workspace/",
            "http://127.0.0.1:18883/workspace/trusted-kernel-realm.html#forged",
        ]{
            assert!(!signed_workspace_navigation_allowed(
                &tauri::Url::parse(denied).unwrap(),&ui,&kernel),
                "signed WebView navigation must not follow {denied}");
        }
        for forged in [
            "https://127.0.0.1:18884/workspace/isolated-signed-workspace.html",
            "http://localhost:18884/workspace/isolated-signed-workspace.html",
            "http://127.0.0.1:18883/workspace/isolated-signed-workspace.html",
            "http://127.0.0.1:18884/workspace/signed-workspace.html",
            "http://127.0.0.1:18884/workspace/isolated-signed-workspace.html?open=1",
        ]{
            let mut test=original.clone();
            test["snapshot"]["originalIsolatedWorkspaceUrl"]=
                json!(format!("{forged}#{}","A".repeat(43)));
            assert!(original_signed_workspace_origins(&test).is_err(),
                "forged installed URL must not open: {forged}");
        }
        let mut without_epoch=original.clone();
        without_epoch["snapshot"]["originalControlEpoch"]=json!(0);
        assert!(original_signed_workspace_origins(&without_epoch).is_err());
        let mut bearer=original.clone();
        bearer["snapshot"]["originalIsolatedWorkspaceUrl"]=json!(
            "http://127.0.0.1:18884/workspace/isolated-signed-workspace.html#short");
        assert!(original_signed_workspace_origins(&bearer).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn one_native_process_handles_two_consecutive_original_host_commands(){
        use std::process::{Command,Stdio};
        // This standard Windows OS process verifies physical pipes, numeric
        // request IDs and lifetime. It is NOT the private signer or Kernel.
        let script=r#"
          while($true){
            $line=[Console]::In.ReadLine()
            if($null -eq $line){break}
            $q=ConvertFrom-Json -InputObject $line
            $response=@{
              schema='IWXA_T3_D3_NATIVE_OWNER_REPLY/1'
              id=[long]$q.id
              ok=$true
              result=@{
                schema='IWXA_T3_ADMIN_D3_NATIVE/1'
                operation='D3_STATE'
                organizationId='org:test'
                ownerMode='ORIGINAL_SIGNED_CORPORATE_D3'
                productionActivation=$false
                T3_READY=$false
                activeSeats=0
              }
            }
            [Console]::Out.WriteLine(($response |
                ConvertTo-Json -Compress -Depth 5))
          }
        "#;
        let child=Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-Command",script])
            .stdin(Stdio::piped()).stdout(Stdio::piped())
            .stderr(Stdio::null()).spawn()
            .expect("Windows OS pipe fixture");
        let mut owner=OriginalOwner::from_child(child,"org:test").unwrap();
        let first=owner.call("state",&Value::Null).unwrap();
        let second=owner.call("state",&Value::Null).unwrap();
        assert_eq!(first["organizationId"],"org:test");
        assert_eq!(second["organizationId"],"org:test");
        assert_eq!(owner.next_id,2);
        assert!(owner.child.try_wait().unwrap().is_none(),
            "owner stays alive between requests");
        drop(owner); // same original lifecycle kills the child on detach
    }
    #[cfg(windows)]
    #[test]
    fn spawned_process_with_missing_pipe_is_terminated(){
        use std::process::{Command,Stdio};
        // A missing pipe previously returned Err and orphaned a live Child.
        let child=Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-Command",
                "Start-Sleep -Seconds 15"])
            .stdin(Stdio::null()).stdout(Stdio::null())
            .stderr(Stdio::null()).spawn().unwrap();
        let err=OriginalOwner::from_child(child,"org:test").err().unwrap();
        assert_eq!(err,"CEN_D3_ORIGINAL_HOST_STDIN_UNAVAILABLE");
    }
    #[test]
    fn persistent_original_owner_replies_are_exact_and_fail_closed(){
        let good=json!({"schema":D3_HOST_REPLY,"id":4,"ok":true,
            "result":{"schema":SCHEMA,"operation":"D3_STATE",
              "ownerMode":"ORIGINAL_SIGNED_CORPORATE_D3",
              "productionActivation":false,"T3_READY":false,
              "activeSeats":0}});
        assert_eq!(host_reply(&good,4).unwrap()["operation"],"D3_STATE");
        assert!(host_reply(&good,5).is_err());
        let mut forged=good.clone();
        forged["result"]["productionActivation"]=json!(true);
        assert!(host_reply(&forged,4).is_err());
        forged=good.clone();
        forged["result"]["ownerMode"]=json!("TEST");
        assert!(host_reply(&forged,4).is_err());
        forged=good.clone();
        forged["schema"]=json!("OTHER_PROTOCOL");
        assert!(host_reply(&forged,4).is_err());
        let denial=json!({"schema":D3_HOST_REPLY,"id":7,"ok":false,
            "code":"T3_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED"});
        assert_eq!(host_reply(&denial,7).unwrap_err(),
            "T3_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED");
        let unsafe_error=json!({"schema":D3_HOST_REPLY,"id":7,"ok":false,
            "code":"C:\\\\Users\\\\private\\\\secret"});
        assert_eq!(host_reply(&unsafe_error,7).unwrap_err(),
            "CEN_D3_ORIGINAL_HOST_REJECTED");
    }

    #[test]
    fn original_d3_utf16_limits_match_russian_windows_forms(){
        // Original private Node T3 checks JS String.length, not UTF-8 bytes.
        // Russian letters must get the same 10k/1k/120 limits as Latin text.
        let task=json!({"task":"З".repeat(6000),"taskId":"task:ru-1"});
        assert!(check_bound_request(&task,"d3CreateTask").is_ok());
        let maximum=json!({"task":"Я".repeat(10000),"taskId":"task:ru-max"});
        assert!(check_bound_request(&maximum,"d3CreateTask").is_ok());
        let too_long=json!({"task":"Я".repeat(10001),"taskId":"task:ru-max"});
        assert_eq!(check_bound_request(&too_long,"d3CreateTask").unwrap_err(),
            "CEN_D3_SIGNED_TASK_TEXT_REQUIRED");
        let mut decision=json!({"packageSha256":"a".repeat(64),
            "previewDigest":"b".repeat(64),"operationId":"decision:ru",
            "decision":"REJECT","reason":"Н".repeat(850)});
        assert!(check_bound_request(&decision,"d3Decide").is_ok());
        decision["reason"]=json!("Н".repeat(1001));
        assert_eq!(check_bound_request(&decision,"d3Decide").unwrap_err(),
            "CEN_D3_EXPLICIT_DECISION_REQUIRED");
        assert!(valid_enrollment_details("workspace:ru","Организация"));
        assert!(valid_enrollment_details("workspace:ru",&"Ж".repeat(120)));
        assert!(!valid_enrollment_details("workspace:ru",&"Ж".repeat(121)));
        // Non-BMP characters occupy two JS UTF-16 code units.
        assert_eq!(original_text_len("🚀"),2);
        assert!(valid_enrollment_details("workspace:ru",&"🚀".repeat(60)));
        assert!(!valid_enrollment_details("workspace:ru",&"🚀".repeat(61)));
    }
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
        result["originalEventReadback"]=result["originalKernelReceipt"]["event"].clone();
        assert!(verify_kernel_apply(&result,&selection,&view).is_ok());
        let original_event=result["originalEventReadback"].clone();
        result["originalEventReadback"]=Value::Null;
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalEventReadback"]=original_event.clone();
        result["originalEventReadback"]["event_id"]=json!("event:foreign");
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalEventReadback"]=original_event.clone();
        result["originalEventReadback"]["payload"]
            ["reconciliation_acceptance_id"]=json!("f".repeat(64));
        assert!(verify_kernel_apply(&result,&selection,&view).is_err());
        result["originalEventReadback"]=original_event;
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
        result["originalKernelReadback"]["object"]["workspace_id"]=json!("workspace:1");
        assert!(verify_kernel_recovery(&result,&input,&view).is_ok());
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
