// CEN05: Center's narrow native host of original, pinned public U04 and U01.
// No copied window manager; no executable paths or HWNDs from the webview.
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Manager};

mod u04 {
    include!(concat!(env!("OUT_DIR"), "/u04_original_windows.rs"));
    #[cfg(test)]
    impl Port {
        fn bound_for_host_test() -> Self {
            Self {
                target: None,
                reattach: None,
                bound: Some(Bound {
                    pid: 4242,
                    stamp: 123,
                    window: None,
                    binding_ref: "test-bound-window".into(),
                    child: None,
                }),
            }
        }
    }
    impl Port {
        // Product host approval, NOT the original U04 qualification environment.
        // The exact installed Atlas path is selected by Center, never by the UI.
        pub fn for_approved_atlas(path: PathBuf) -> Self {
            Self { target: Some((path, Vec::new())), reattach: None, bound: None }
        }
    }
}
mod u01 {
    include!(concat!(env!("OUT_DIR"), "/u01_original_program.rs"));
}
pub struct Session {
    port: Option<u04::Port>,
    organization_id: String,
    project_id: String,
    work_id: String,
    revision: String,
    binding_ref: String,
}
impl Default for Session {
    fn default() -> Self {
        Self {port:None,organization_id:String::new(),project_id:String::new(),
            work_id:String::new(),revision:String::new(),binding_ref:String::new()}
    }
}
fn valid_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}
fn exact_work(snapshot: &Value, project_id: &str, work_id: &str, revision: &str) -> Result<(), String> {
    if !valid_token(project_id) || !valid_token(work_id) ||
        revision.is_empty() || revision.len()>20 ||
        !revision.bytes().all(|b| b.is_ascii_digit()) ||
        (revision.len()>1 && revision.starts_with('0')) {
        return Err("CEN05_WORK_REF_INVALID".into());
    }
    if snapshot["schema"] != "atlas.project/1" {
        return Err("ATLAS_SOURCE_SCHEMA_INVALID".into());
    }
    if snapshot["revision"].to_string() != revision {
        return Err("SOURCE_REVISION_CHANGED".into());
    }
    let project = snapshot["projects"].as_array()
        .and_then(|items|items.iter().find(|item|item["id"]==project_id))
        .ok_or("PROJECT_MISSING_IN_SOURCE")?;
    if !project["items"].as_array()
        .is_some_and(|items|items.iter().any(|item|item["id"]==work_id)) {
        return Err("WORK_MISSING_IN_SOURCE".into());
    }
    Ok(())
}
fn observe_atlas(app: &AppHandle, project_id: &str, work_id: &str, revision: &str)
    -> Result<(), String> {
    let center_local=app.path().app_local_data_dir()
        .map_err(|_| "ATLAS_PUBLIC_BASE_NOT_FOUND")?;
    let root=crate::center_public_atlas_root_under(&center_local)?;
    let readback=crate::center_public_atlas_open_root(&root)?;
    exact_work(&readback.snapshot,project_id,work_id,revision)
}
fn installed_atlas(app: &AppHandle) -> Result<PathBuf, String> {
    if !cfg!(windows) {return Err("PLATFORM_UNSUPPORTED".into());}
    let local=app.path().app_local_data_dir().map_err(|_| "ATLAS_HOST_PATH_UNAVAILABLE")?;
    if local.file_name().and_then(|x|x.to_str()) != Some("ru.iwxa.admin-center") {
        return Err("ATLAS_HOST_SCOPE_INVALID".into());
    }
    // This is the canonical Atlas NSIS installed path, already exercised by
    // Center's U05 two-installed-program qualification.
    let path=local.parent().ok_or("ATLAS_HOST_PATH_UNAVAILABLE")?
        .join("IWXA Atlas").join("iwxa-atlas-desktop.exe");
    let info=fs::symlink_metadata(&path).map_err(|_| "ATLAS_INSTALL_NOT_FOUND")?;
    if !info.file_type().is_file() || info.file_type().is_symlink() {
        return Err("ATLAS_INSTALL_UNAVAILABLE".into());
    }
    Ok(path)
}
fn discover_with_original_u01(path: &Path) -> Result<(), String> {
    // Original U01 program-connection native inspection. Atlas is a GUI
    // program with no qualified CLI version protocol, so never call connect()
    // and never misrepresent a CLI version check as an Atlas entitlement.
    let manifest=json!({"schema":"IWXA_CLI_PROGRAM/1",
        "program_id":"IWXA_ATLAS_DESKTOP","executable_name":"iwxa-atlas-desktop.exe",
        "version_args":["--version"],"version_contains":"0.2.0",
        "operations":{"version":["--version"]}});
    let port=u01::CliPort::from_manifest(&manifest,path.to_path_buf())
        .map_err(|_| "U01_ATLAS_MANIFEST_INVALID")?;
    if port.inspect()["status"]!="DISCOVERED" {
        return Err("U01_ATLAS_NOT_DISCOVERED".into());
    }
    Ok(())
}
fn respond(status: &str, detail: Value) -> Value {
    let mut result=json!({"schema":u04::SCHEMA,"status":status,
        "openedWorkAutomatically":false});
    if let (Some(base),Some(extra))=(result.as_object_mut(),detail.as_object()){
        for (key,value) in extra {base.insert(key.clone(),value.clone());}
    }
    result
}
#[tauri::command]
pub fn center_u04_open(app: AppHandle, state: tauri::State<'_, Mutex<Session>>,
    organization_id: String,project_id: String,work_id: String,revision: String
) -> Result<Value,String> {
    if !valid_token(&organization_id) {return Err("CEN05_ORGANIZATION_INVALID".into());}
    observe_atlas(&app,&project_id,&work_id,&revision)?;
    let target=installed_atlas(&app)?;
    discover_with_original_u01(&target)?;
    let mut session=state.lock().map_err(|_|"CEN05_SESSION_UNAVAILABLE")?;
    // Switching organizations releases the former window binding without
    // terminating Atlas. The new organization's WorkRef was preflighted above.
    detach_prior_organization(&mut session,&organization_id)?;
    if session.port.is_some() {return Err("CEN05_BINDING_ALREADY_ACTIVE".into());}
    let mut port=u04::Port::for_approved_atlas(target);
    let result=port.handle("open");
    let status=result["status"].as_str().unwrap_or("PRESENTATION_OPEN_UNCONFIRMED");
    if !["WINDOW_OBSERVED","LAUNCHED_NO_WINDOW"].contains(&status) {
        return Ok(respond(status,json!({})));
    }
    session.binding_ref=result["binding"]["bindingRef"].as_str()
        .ok_or("U04_BINDING_INVALID")?.to_string();
    session.organization_id=organization_id;
    session.project_id=project_id;
    session.work_id=work_id;
    session.revision=revision;
    session.port=Some(port);
    Ok(respond(status,json!({"bindingRef":session.binding_ref,
        "processId":result["processId"],"windowRef":result["binding"]["windowRef"]})))
}
fn detach_prior_organization(session:&mut Session,new_organization_id:&str)->Result<(),String>{
    if session.port.is_some() && session.organization_id != new_organization_id {
        // U04 closeBinding releases the native binding but does not kill Atlas.
        let receipt=session.port.as_mut().ok_or("CEN05_PREVIOUS_BINDING_MISSING")?
            .handle("closeBinding");
        if receipt["status"]!="BINDING_CLOSED" {
            return Err("CEN05_PREVIOUS_BINDING_DETACH_FAILED".into());
        }
        *session=Session::default();
    }
    Ok(())
}
fn context_matches(session:&Session,organization_id:&str,project_id:&str,
    work_id:&str,revision:&str,binding_ref:&str)->bool{
    session.port.is_some()&&session.organization_id==organization_id&&
    session.project_id==project_id&&session.work_id==work_id&&
    session.revision==revision&&session.binding_ref==binding_ref
}
#[tauri::command]
pub fn center_u04_activate(app: AppHandle,state:tauri::State<'_,Mutex<Session>>,
    organization_id:String,project_id:String,work_id:String,revision:String,
    binding_ref:String
)->Result<Value,String>{
    let mut session=state.lock().map_err(|_|"CEN05_SESSION_UNAVAILABLE")?;
    if !context_matches(&session,&organization_id,&project_id,&work_id,&revision,&binding_ref){
        return Err("CEN05_BINDING_CONTEXT_CHANGED".into());
    }
    observe_atlas(&app,&project_id,&work_id,&revision)?;
    let result=session.port.as_mut().ok_or("CEN05_BINDING_NOT_FOUND")?.handle("activate");
    Ok(respond(result["status"].as_str().unwrap_or("WINDOW_FOCUS_UNCONFIRMED"),
        json!({"focused":result["focused"]==true})))
}
#[tauri::command]
pub fn center_u04_detach(state:tauri::State<'_,Mutex<Session>>,
    organization_id:String,binding_ref:String
)->Result<Value,String>{
    let mut session=state.lock().map_err(|_|"CEN05_SESSION_UNAVAILABLE")?;
    if session.port.is_none()||session.organization_id!=organization_id||
        session.binding_ref!=binding_ref {
        return Err("CEN05_BINDING_CONTEXT_CHANGED".into());
    }
    let result=session.port.as_mut().ok_or("CEN05_BINDING_NOT_FOUND")?.handle("closeBinding");
    let status=result["status"].as_str().unwrap_or("BINDING_DETACH_UNCONFIRMED").to_string();
    if status=="BINDING_CLOSED"{*session=Session::default();}
    Ok(respond(&status,json!({"processTerminated":false})))
}
#[tauri::command]
pub fn center_u04_return(app:AppHandle,state:tauri::State<'_,Mutex<Session>>,
    organization_id:String,project_id:String,work_id:String,revision:String,
    binding_ref:String
)->Result<Value,String>{
    let session=state.lock().map_err(|_|"CEN05_SESSION_UNAVAILABLE")?;
    if !context_matches(&session,&organization_id,&project_id,&work_id,&revision,&binding_ref){
        return Err("CEN05_BINDING_CONTEXT_CHANGED".into());
    }
    drop(session);
    // Always bring the manager home, including when the canonical Atlas
    // revision changed while the external window was in use. Returning
    // focus does not authorize or rewrite an outdated WorkRef.
    let revision_check=observe_atlas(&app,&project_id,&work_id,&revision);
    let win=app.get_webview_window("main").ok_or("CENTER_WINDOW_NOT_FOUND")?;
    win.set_focus().map_err(|_|"CENTER_FOCUS_DENIED")?;
    Ok(return_receipt(revision_check))
}
fn return_receipt(revision_check: Result<(),String>) -> Value {
    match revision_check {
        Ok(())=>respond("CENTER_WINDOW_FOCUSED",
            json!({"revisionMatches":true,"centerFocused":true})),
        Err(reason)=>respond("WORK_SOURCE_NOT_CURRENT",
            json!({"revisionMatches":false,"centerFocused":true,"reason":reason})),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_atlas_work_and_revision_are_required() {
        let source=json!({"schema":"atlas.project/1","revision":3,
            "projects":[{"id":"p","items":[{"id":"w","title":"Original Atlas"}]}]});
        assert!(exact_work(&source,"p","w","3").is_ok());
        for (p,w,r) in [("p","w","2"),("p","missing","3"),("other","w","3"),
            ("p","w","03"),("p","w","x")] {
            assert!(exact_work(&source,p,w,r).is_err());
        }
        assert!(exact_work(&json!({"schema":"other","revision":3,
            "projects":[]}),"p","w","3").is_err());
    }
    #[test]
    fn returning_to_center_never_hides_a_changed_atlas_revision() {
        let current=return_receipt(Ok(()));
        assert_eq!(current["status"],"CENTER_WINDOW_FOCUSED");
        assert_eq!(current["revisionMatches"],true);
        let stale=return_receipt(Err("SOURCE_REVISION_CHANGED".into()));
        assert_eq!(stale["status"],"WORK_SOURCE_NOT_CURRENT");
        assert_eq!(stale["reason"],"SOURCE_REVISION_CHANGED");
        assert_eq!(stale["centerFocused"],true);
        assert_eq!(stale["revisionMatches"],false);
        assert_eq!(stale["openedWorkAutomatically"],false);
    }
    #[test]
    fn organization_switch_detaches_real_u04_binding_without_terminating_program() {
        let mut session=Session::default();
        session.port=Some(u04::Port::bound_for_host_test());
        session.organization_id="org-a".into();
        session.binding_ref="test-bound-window".into();
        session.project_id="project-a".into();
        session.work_id="work-a".into();
        session.revision="1".into();
        detach_prior_organization(&mut session,"org-a").unwrap();
        assert_eq!(session.port.as_mut().unwrap().handle("getBinding")["status"],"BOUND");
        detach_prior_organization(&mut session,"org-b").unwrap();
        assert!(session.port.is_none());
        assert!(session.binding_ref.is_empty());
        assert!(session.organization_id.is_empty());
        assert!(!context_matches(&session,"org-a","project-a","work-a","1","test-bound-window"));
    }
    #[test]
    fn binding_context_never_crosses_organizations_or_revisions() {
        let mut session=Session::default();
        session.organization_id="org-a".into();
        session.project_id="p".into();session.work_id="w".into();
        session.revision="3".into();session.binding_ref="b".into();
        assert!(!context_matches(&session,"org-a","p","w","3","b"),
            "an unbound session is never valid");
    }
}
