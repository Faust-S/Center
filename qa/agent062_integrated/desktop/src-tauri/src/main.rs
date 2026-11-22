#![cfg_attr(all(windows,not(debug_assertions)), windows_subsystem = "windows")]
use std::{env,process::{Command,Stdio},path::{Path,PathBuf,Component}};
#[cfg(windows)] use std::os::windows::process::CommandExt;
use tauri::{Manager,WebviewUrl,WebviewWindowBuilder};
use tauri::ipc::CapabilityBuilder;
mod u04_windows_host;
fn native_error(value:impl ToString)->std::io::Error {std::io::Error::other(value.to_string())}


#[derive(Clone)]
struct VerifiedDesktopRuntime {port:u16,install_root:PathBuf}

fn ticket_from_url(url:&str,port:u16)->Option<String>{
    let prefix=format!("http://127.0.0.1:{port}/desktop/#iwxa_bootstrap=");
    let ticket=url.strip_prefix(&prefix)?;
    if ticket.len()<32 || ticket.len()>256 || !ticket.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){
        return None;
    }
    Some(ticket.to_string())
}
fn trusted_window_url(url:&str,port:u16)->bool{
    url==format!("http://127.0.0.1:{port}/desktop/")
}
fn bootstrap_url(identity:&VerifiedDesktopRuntime)->Result<String,String>{
    // The installed receipt is checked for each recovery. The page supplies
    // neither an executable nor a port nor a path.
    let python=installed_python(&identity.install_root).ok_or("managed_python_missing")?;
    let install_root=shell_path(identity.install_root.clone());
    let helper=install_root.join("tools").join("iwxa_desktop_bootstrap.py");
    let canonical_helper=helper.canonicalize().map_err(|_|"desktop_helper_missing")?;
    if !canonical_helper.starts_with(&identity.install_root)||!canonical_helper.is_file(){
        return Err("desktop_helper_unverified".into());
    }
    let mut command=Command::new(&python);
    // Native Setup Core owns every installed file; never generate bytecode in-place.
    command.arg("-B").arg(&helper).arg("--install-root").arg(&install_root).arg("--port").arg(identity.port.to_string())
        .stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] command.creation_flags(0x08000000);
    let output=command.output().map_err(|_|"desktop_bootstrap_failed:UNKNOWN")?;
    if !output.status.success(){
        // Do not surface Python stderr, paths or exception text in the GUI.
        // The helper emits only one of these fixed, locally classified codes.
        let code=bootstrap_failure_code(&output.stdout);
        return Err(format!("desktop_bootstrap_failed:{code}"));
    }
    let body:serde_json::Value=serde_json::from_slice(&output.stdout).map_err(|_|"desktop_bootstrap_invalid")?;
    let url=body.get("url").and_then(|v|v.as_str()).ok_or("desktop_bootstrap_missing_url")?;
    if ticket_from_url(url,identity.port).is_none(){return Err("desktop_bootstrap_unexpected_origin".into());}
    Ok(url.to_owned())
}

#[tauri::command]
async fn recover_desktop_session(window:tauri::WebviewWindow,state:tauri::State<'_,VerifiedDesktopRuntime>)->Result<String,String>{
    // A single narrow native command, not a generic OS command or network IPC.
    let current=window.url().map_err(|_|"desktop_window_unverified")?;
    if window.label()!="main"||!trusted_window_url(current.as_str(),state.port){
        return Err("desktop_window_unverified".into());
    }
    let identity=state.inner().clone();
    tauri::async_runtime::spawn_blocking(move ||{
        let url=bootstrap_url(&identity)?;
        ticket_from_url(&url,identity.port).ok_or_else(||"desktop_ticket_unverified".into())
    }).await.map_err(|_|"desktop_bootstrap_failed".to_string())?
}

/// The existing Google OAuth owner creates the authorization URL.
/// This is only a narrow system-browser handoff from the verified desktop.
/// It does not create OAuth flows, read browser contents or grant authority.
fn valid_google_oauth_browser_url(raw:&str)->bool{
    if raw.len()<110 || raw.len()>4096 || raw.chars().any(|c|c.is_control()) {
        return false;
    }
    let parsed=match tauri::Url::parse(raw){Ok(url)=>url,Err(_)=>return false};
    if parsed.scheme()!="https" || parsed.host_str()!=Some("accounts.google.com")
        || parsed.port().is_some() || !parsed.username().is_empty()
        || parsed.password().is_some() || parsed.fragment().is_some()
        || parsed.path()!="/o/oauth2/v2/auth" {return false;}
    let query:Vec<(String,String)>=parsed.query_pairs()
        .map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
    const KEYS:[&str;10]=[
        "client_id","redirect_uri","response_type","scope","access_type",
        "prompt","include_granted_scopes","state","code_challenge","code_challenge_method",
    ];
    if query.len()!=KEYS.len() || query.iter().any(|(key,_)|!KEYS.contains(&key.as_str())) {
        return false;
    }
    let mut seen=std::collections::HashSet::new();
    if query.iter().any(|(key,_)|!seen.insert(key)){return false;}
    let field=|name:&str|query.iter().find(|(key,_)|key==name).map(|(_,value)|value.as_str());
    if field("response_type")!=Some("code") || field("access_type")!=Some("offline")
        || field("prompt")!=Some("consent") || field("include_granted_scopes")!=Some("true")
        || field("code_challenge_method")!=Some("S256"){return false;}
    let client=field("client_id").unwrap_or("");
    if client.len()<20 || client.len()>320 || !client.ends_with(".apps.googleusercontent.com")
        || !client.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'.'||b==b'-'){return false;}
    let state=field("state").unwrap_or("");
    let challenge=field("code_challenge").unwrap_or("");
    if state.len()<24 || state.len()>256 || challenge.len()!=43
        || !state.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
        || !challenge.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
        || field("scope").is_none_or(|scope|scope.is_empty()||scope.len()>2048){return false;}
    let callback=match tauri::Url::parse(field("redirect_uri").unwrap_or("")){
        Ok(value)=>value,Err(_)=>return false
    };
    callback.scheme()=="http" && callback.host_str()==Some("127.0.0.1")
        && callback.port().is_some_and(|port|port>0)
        && callback.username().is_empty() && callback.password().is_none()
        && callback.path()=="/oauth/google/callback"
        && callback.query().is_none() && callback.fragment().is_none()
}

#[cfg(windows)]
#[link(name="shell32")]
extern "system" {
    fn ShellExecuteW(window:*mut std::ffi::c_void,verb:*const u16,file:*const u16,
                     parameters:*const u16,directory:*const u16,show_command:i32)->isize;
}

#[tauri::command]
fn open_google_oauth_browser(window:tauri::WebviewWindow,
    state:tauri::State<'_,VerifiedDesktopRuntime>,authorization_url:String)->Result<(),String>{
    if !u04_caller_verified(&window,&state){
        return Err("google_oauth_desktop_window_unverified".into());
    }
    if !valid_google_oauth_browser_url(&authorization_url){
        return Err("google_oauth_authorization_url_invalid".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        let verb:Vec<u16>=OsStr::new("open").encode_wide().chain(Some(0)).collect();
        let url:Vec<u16>=OsStr::new(&authorization_url).encode_wide().chain(Some(0)).collect();
        let result=unsafe{ShellExecuteW(
            std::ptr::null_mut(),verb.as_ptr(),url.as_ptr(),
            std::ptr::null(),std::ptr::null(),1)};
        if result<=32{return Err("google_oauth_system_browser_unavailable".into());}
        Ok(())
    }
    #[cfg(not(windows))]
    { Err("google_oauth_windows_browser_required".into()) }
}

// Only the verified installed desktop window may invoke the native OS port.
// Binding lifecycle and receipt semantics remain with the official U04 owner.
fn u04_caller_verified(window:&tauri::WebviewWindow,state:&VerifiedDesktopRuntime)->bool{
    window.label()=="main"&&window.url().ok().is_some_and(|u|trusted_window_url(u.as_str(),state.port))
}
#[tauri::command]
async fn u04_find_existing_window(window:tauri::WebviewWindow,state:tauri::State<'_,VerifiedDesktopRuntime>,app_ref:String)->Result<serde_json::Value,String>{
    if !u04_caller_verified(&window,&state){return Err("u04_desktop_window_unverified".into());}
    tauri::async_runtime::spawn_blocking(move||u04_windows_host::find(&app_ref)).await
        .map_err(|_|"u04_native_observation_failed".into())
}
#[tauri::command]
fn u04_verify_existing_process(window:tauri::WebviewWindow,state:tauri::State<'_,VerifiedDesktopRuntime>,app_ref:String,process_id:u32,process_stamp:String)->Result<serde_json::Value,String>{
    if !u04_caller_verified(&window,&state){return Err("u04_desktop_window_unverified".into());}
    Ok(u04_windows_host::verify(&app_ref,process_id,&process_stamp))
}
#[tauri::command]
fn u04_observe_existing_window(window:tauri::WebviewWindow,state:tauri::State<'_,VerifiedDesktopRuntime>,app_ref:String,process_id:u32,process_stamp:String)->Result<serde_json::Value,String>{
    if !u04_caller_verified(&window,&state){return Err("u04_desktop_window_unverified".into());}
    Ok(u04_windows_host::observe(&app_ref,process_id,&process_stamp))
}
#[tauri::command]
fn u04_focus_existing_window(window:tauri::WebviewWindow,state:tauri::State<'_,VerifiedDesktopRuntime>,app_ref:String,process_id:u32,process_stamp:String,window_ref:String)->Result<serde_json::Value,String>{
    if !u04_caller_verified(&window,&state){return Err("u04_desktop_window_unverified".into());}
    Ok(u04_windows_host::focus(&app_ref,process_id,&process_stamp,&window_ref))
}

fn bootstrap_failure_code(stdout:&[u8])->&'static str{
    let decoded:serde_json::Value=match serde_json::from_slice(stdout){
        Ok(value)=>value,Err(_)=>return "UNKNOWN"
    };
    match decoded.get("error_code").and_then(|v|v.as_str()){
        Some("PORT_OCCUPIED")=>"PORT_OCCUPIED",
        Some("CORE_TIMEOUT")=>"CORE_TIMEOUT",
        Some("CORE_EXITED")=>"CORE_EXITED",
        Some("CORE_DEPENDENCY")=>"CORE_DEPENDENCY",
        Some("CORE_DATA_ACCESS")=>"CORE_DATA_ACCESS",
        Some("CORE_POWERSHELL")=>"CORE_POWERSHELL",
        Some("LOCAL_STATE_UNAVAILABLE")=>"LOCAL_STATE_UNAVAILABLE",
        Some("INSTANCE_UNVERIFIED")=>"INSTANCE_UNVERIFIED",
        Some("INSTALL_SETTINGS")=>"INSTALL_SETTINGS",
        _=>"UNKNOWN"
    }
}

// This is the FIRST start, before any React page can render. Core recovery
// inside React only applies after the initial authenticated window exists.
// Let the operator retry a transient bootstrap failure in this same process;
// never spawn an unrelated Python process or relax the verified origin.
fn bootstrap_with_retry<A, C>(mut attempt:A,mut confirm_retry:C)->Result<Option<String>,String>
where A:FnMut()->Result<String,String>,C:FnMut(&str)->bool {
    loop {
        match attempt(){
            Ok(url)=>return Ok(Some(url)),
            Err(reason) if reason.starts_with("desktop_bootstrap_failed:")=>{
                if !confirm_retry(&reason){return Ok(None);}
            },
            Err(reason)=>return Err(reason),
        }
    }
}
fn verified_installed_runtime()->Result<VerifiedDesktopRuntime,String>{
    let port=native_port()?;
    let current=env::current_exe().map_err(|_|"desktop_executable_unavailable")?;
    // Setup Core ships the same native app in two supported locations:
    // <product>/IWXA Personal Agent.exe (visible to the user) and the
    // historical <product>/desktop/bin/IWXA Personal.exe (Start Menu link).
    // Both must resolve to the SAME installed receipt and Python Core.
    let directory=current.parent().ok_or("install_root_missing")?;
    let install_root=if directory.file_name().and_then(|name|name.to_str())
        .is_some_and(|name|name.eq_ignore_ascii_case("bin"))
        && directory.parent().and_then(|p|p.file_name())
           .and_then(|name|name.to_str())
           .is_some_and(|name|name.eq_ignore_ascii_case("desktop")){
        directory.parent().and_then(|p|p.parent())
            .ok_or("install_root_missing")?
    }else{
        directory
    };
    let install_root=install_root.canonicalize().map_err(|_|"install_root_unavailable")?;
    if !install_root.join("explorer-install-receipt.json").is_file(){
        return Err("installed_receipt_missing".into());
    }
    Ok(VerifiedDesktopRuntime{port,install_root})
}
// The installed Publisher established that a WebviewWindowBuilder data_directory
// alone does not prevent an executable-adjacent *.WebView2 folder on Windows.
// Set the WebView2 process environment BEFORE creating Tauri or its window,
// using the user's data directory rather than Setup Core's owned program tree.
fn checked_webview_data_directory(local_data:&Path,install_root:&Path)->Result<PathBuf,String>{
    if !local_data.is_absolute() {
        return Err("desktop_webview_local_data_invalid".into());
    }
    let folder=local_data.join("IWXA").join("PersonalAgent").join("webview");
    if folder.starts_with(install_root) {
        return Err("desktop_webview_profile_inside_install_root".into());
    }
    Ok(folder)
}
fn configure_webview_data_directory(install_root:&Path)->Result<PathBuf,String>{
    // Respect an explicit per-process WebView2 profile (also used for
    // independent cold-start qualification), without writing into the EXE tree.
    let chosen=env::var_os("WEBVIEW2_USER_DATA_FOLDER")
        .filter(|v|!v.is_empty()).map(PathBuf::from);
    let folder=match chosen {
        Some(folder)=>folder,
        None=>{
            let local=env::var_os("LOCALAPPDATA")
                .ok_or("desktop_webview_local_data_unavailable")?;
            checked_webview_data_directory(&PathBuf::from(local),install_root)?
        }
    };
    if !folder.is_absolute() || folder.starts_with(install_root) {
        return Err("desktop_webview_profile_inside_install_root".into());
    }
    std::fs::create_dir_all(&folder)
        .map_err(|_|"desktop_webview_directory_unavailable")?;
    // Must precede Tauri/WebView2 initialization; data_directory alone
    // did not prevent install-adjacent cache creation in the actual product.
    env::set_var("WEBVIEW2_USER_DATA_FOLDER",&folder);
    Ok(folder)
}

fn main() {
    // The first launch must succeed before creating the external Core
    // webview. If the verified Core is still recovering, allow a fresh,
    // explicitly requested attempt through the existing serialized supervisor.
    let identity=match verified_installed_runtime(){
        Ok(identity)=>identity,
        Err(_)=>{show_startup_error();std::process::exit(1);}
    };
    let webview_data=match configure_webview_data_directory(&identity.install_root){
        Ok(folder)=>folder,
        Err(_)=>{show_startup_error();std::process::exit(1);}
    };
    let url=match bootstrap_with_retry(||bootstrap_url(&identity),startup_retry_prompt){
        Ok(Some(url))=>url,
        Ok(None)=>return, // The operator chose Cancel; do not show another error.
        Err(_)=>{show_startup_error();std::process::exit(1);}
    };
    let port=identity.port;
    let result=tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![recover_desktop_session,u04_find_existing_window,
            u04_verify_existing_process,u04_observe_existing_window,u04_focus_existing_window,
            open_google_oauth_browser])
        .setup(move |app| {
            // Bootstrap ticket stays in the verified URL, not argv or logs.
            // A new capability is NOT needed for retries or failed startup.
            let address=url.parse().map_err(native_error)?;
            app.add_capability(close_capability(port)).map_err(native_error)?;
            app.manage(identity);
            WebviewWindowBuilder::new(app,"main",WebviewUrl::External(address))
                .data_directory(webview_data.clone())
                .title("IWXA Personal").inner_size(1120.0,700.0).min_inner_size(740.0,500.0)
                .build().map_err(native_error)?;
            Ok(())
        })
        .run(tauri::generate_context!());
    if result.is_err(){
        show_startup_error();
        std::process::exit(1);
    }
}
fn startup_retry_prompt(reason:&str)->bool{
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        let details=match reason{
            "desktop_bootstrap_failed:PORT_OCCUPIED"=>
                "Порт локального ядра занят другой программой. Закройте уже открытое окно IWXA или другое приложение, использующее этот адрес, затем повторите запуск. Код: PORT_OCCUPIED.",
            "desktop_bootstrap_failed:CORE_TIMEOUT"=>
                "Локальное ядро запускается дольше установленного времени. Проверьте нагрузку компьютера и попробуйте ещё раз. Если ошибка повторяется, откройте технические сведения установщика. Код: CORE_TIMEOUT.",
            "desktop_bootstrap_failed:CORE_EXITED"=>
                "Локальное ядро завершилось до готовности. Установка файлов не доказывает, что Core запускается. Личные данные сохраняются. Подробности в локальном журнале IWXA/Logs. Код: CORE_EXITED.",
            "desktop_bootstrap_failed:CORE_DEPENDENCY"=>
                "Локальное ядро не смогло загрузить Python-компонент или библиотеку Windows. Данные и модели не удаляйте. Код: CORE_DEPENDENCY.",
            "desktop_bootstrap_failed:CORE_DATA_ACCESS"=>
                "Windows отказала локальному ядру в доступе к папкам программы или данных. Не удаляйте Task, Result и модели. Код: CORE_DATA_ACCESS.",
            "desktop_bootstrap_failed:CORE_POWERSHELL"=>
                "Windows PowerShell не загрузил штатные команды для запуска Core. Данные сохраняются. Код: CORE_POWERSHELL.",
            "desktop_bootstrap_failed:LOCAL_STATE_UNAVAILABLE"=>
                "Состояние ранее запущенного ядра не подтверждено. Не удаляйте личные данные. Откройте IWXA Setup Core и проверьте установку. Код: LOCAL_STATE_UNAVAILABLE.",
            "desktop_bootstrap_failed:INSTANCE_UNVERIFIED"=>
                "Принадлежность запущенного процесса ядра не подтверждена. Не останавливайте неизвестные процессы. Проверьте установку через IWXA Setup Core. Код: INSTANCE_UNVERIFIED.",
            "desktop_bootstrap_failed:INSTALL_SETTINGS"=>
                "Настройки установленной программы или папок данных не совпали с действующей регистрацией. Откройте IWXA Setup Core и проверьте сохранённые пути. Код: INSTALL_SETTINGS.",
            _=>
                "IWXA Personal не смог подключиться к локальному ядру. Откройте технические сведения IWXA Setup Core. Код: UNKNOWN."
        };
        let message:Vec<u16>=OsStr::new(details)
            .encode_wide().chain(std::iter::once(0)).collect();
        let title:Vec<u16>=OsStr::new("IWXA Personal")
            .encode_wide().chain(std::iter::once(0)).collect();
        // MB_RETRYCANCEL | MB_ICONWARNING. The OS owns the dialog, so it
        // remains visible even though the React webview has not yet started.
        return unsafe{MessageBoxW(std::ptr::null_mut(),message.as_ptr(),title.as_ptr(),0x00000035)}==4;
    }
    #[cfg(not(windows))]
    { false }
}
#[cfg(windows)]
#[link(name="user32")]
extern "system" {
    fn MessageBoxW(window:*mut std::ffi::c_void, message:*const u16, caption:*const u16, options:u32)->i32;
}
fn show_startup_error(){
    // A GUI-subsystem executable has no visible stderr. Never fail silently
    // when the installed local Python Core cannot be started.
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use std::ffi::OsStr;
        let message:Vec<u16>=OsStr::new("Не удалось открыть IWXA Personal. Проверьте установку и запустите приложение снова. Если ошибка повторится, переустановите IWXA с сохранением личных данных.")
            .encode_wide().chain(std::iter::once(0)).collect();
        let title:Vec<u16>=OsStr::new("IWXA Personal").encode_wide().chain(std::iter::once(0)).collect();
        unsafe { MessageBoxW(std::ptr::null_mut(),message.as_ptr(),title.as_ptr(),0x00000010); }
    }
    #[cfg(not(windows))]
    eprintln!("IWXA Personal could not start its installed local runtime.");
}
fn native_port()->Result<u16,String>{
    let args:Vec<String>=env::args().skip(1).collect();
    if args.is_empty(){return Ok(8765);}
    if args.len()!=2 || args[0]!="--port"{return Err("desktop_arguments_invalid".into());}
    let port:u16=args[1].parse().map_err(|_|"desktop_port_invalid")?;
    if port==0{return Err("desktop_port_invalid".into());}
    Ok(port)
}

fn installed_python(install_root:&Path)->Option<PathBuf>{
    // Fails closed without an installed product runtime; never executes ambient Python.
    let receipt=std::fs::read_to_string(install_root.join("explorer-install-receipt.json")).ok()?;
    let row:serde_json::Value=serde_json::from_str(&receipt).ok()?;
    if row.get("schema")?.as_str()? != "IWXA_EXPLORER_INSTALL_RECEIPT/1.1.0"
        || row.get("status")?.as_str()? != "INSTALLED_GENERIC_STATE_READY" {return None;}
    let relative=row.get("managed_runtime")?.get("python_executable")?.as_str()?;
    let relative_path=Path::new(relative);
    if !relative_path.components().all(|part|matches!(part,Component::Normal(_))){return None;}
    let candidate=install_root.join(relative_path).canonicalize().ok()?;
    if !candidate.starts_with(install_root) || !candidate.is_file(){return None;}
    Some(candidate)
}

fn shell_path(path:PathBuf)->PathBuf{
    #[cfg(windows)]
    {
        if let Some(text)=path.to_str(){
            if let Some(local)=text.strip_prefix(r"\\?\"){
                let bytes=local.as_bytes();
                if bytes.len()>3 && bytes[0].is_ascii_alphabetic() && bytes[1]==b':' && bytes[2]==b'\\'{
                    return PathBuf::from(local);
                }
            }
        }
    }
    path
}

fn close_capability(port:u16)->CapabilityBuilder {
    CapabilityBuilder::new("verified-core-window-lifecycle")
        .local(false)
        .window("main")
        .remote(format!("http://127.0.0.1:{port}/desktop/*"))
        .permission("core:event:allow-listen")
        .permission("core:event:allow-unlisten")
        .permission("core:window:allow-destroy")
        .permission("allow-recover-desktop-session")
        .permission("allow-u04-find-existing-window")
        .permission("allow-u04-verify-existing-process")
        .permission("allow-u04-observe-existing-window")
        .permission("allow-u04-focus-existing-window")
        .permission("allow-open-google-oauth-browser")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::RuntimeCapability;
    #[test]
    fn webview_data_is_outside_setup_core_owned_program_tree() {
        let base=std::env::temp_dir().join("iwxa-desktop-test");
        let installed=base.join("installed");
        let data=base.join("profile");
        assert_eq!(
            checked_webview_data_directory(&data,&installed).unwrap(),
            data.join("IWXA").join("PersonalAgent").join("webview")
        );
        assert!(checked_webview_data_directory(&installed,&installed).is_err());
        assert!(checked_webview_data_directory(Path::new("relative-profile"),&installed).is_err());
    }

    #[test]
    fn close_permission_is_scoped_to_verified_core_window() {
        let tauri::utils::acl::capability::CapabilityFile::Capability(capability)=close_capability(19923).build() else { panic!("single capability required") };
        assert!(!capability.local);
        assert_eq!(capability.windows,vec!["main"]);
        assert_eq!(capability.remote.as_ref().unwrap().urls,vec!["http://127.0.0.1:19923/desktop/*"]);
        assert_eq!(capability.permissions.len(),9);
        let value=serde_json::to_value(capability).unwrap();
        let encoded=value.to_string();
        assert!(encoded.contains("http://127.0.0.1:19923/desktop/*"));
        assert!(!encoded.contains("http://127.0.0.1:*"));
        assert!(!encoded.contains("core:default"));
        assert!(!encoded.contains("shell:"));
        assert!(!encoded.contains("fs:"));
        assert!(encoded.contains("core:event:allow-listen"));
        assert!(encoded.contains("core:event:allow-unlisten"));
        assert!(encoded.contains("core:window:allow-destroy"));
        assert!(encoded.contains("allow-recover-desktop-session"));
        assert!(encoded.contains("allow-u04-find-existing-window"));
        assert!(encoded.contains("allow-u04-focus-existing-window"));
        assert!(encoded.contains("allow-open-google-oauth-browser"));
    }
    #[test]
    fn browser_handoff_accepts_only_google_oauth_pkce_for_local_callback(){
        let state="A".repeat(48);
        let challenge="b".repeat(43);
        let callback="http://127.0.0.1:58643/oauth/google/callback";
        let base=format!(
          "https://accounts.google.com/o/oauth2/v2/auth?client_id=client-1.apps.googleusercontent.com&redirect_uri=http%3A%2F%2F127.0.0.1%3A58643%2Foauth%2Fgoogle%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar&access_type=offline&prompt=consent&include_granted_scopes=true&state={state}&code_challenge={challenge}&code_challenge_method=S256"
        );
        assert!(valid_google_oauth_browser_url(&base));
        for (needle, replacement) in [
            ("accounts.google.com","evil.accounts.google.com"),
            ("https://accounts.google.com","http://accounts.google.com"),
            ("/o/oauth2/v2/auth","/other"),
            ("response_type=code","response_type=token"),
            ("code_challenge_method=S256","code_challenge_method=plain"),
            ("127.0.0.1%3A58643","evil.test%3A58643"),
            ("&prompt=consent","&prompt=none"),
            ("&state=","&unexpected=yes&state="),
        ]{
            assert!(!valid_google_oauth_browser_url(&base.replace(needle,replacement)));
        }
        assert!(!valid_google_oauth_browser_url(&format!("{base}&state=duplicate")));
        assert!(!valid_google_oauth_browser_url(
            &base.replace("accounts.google.com","accounts.google.com.evil.test")));
        assert_eq!(callback,"http://127.0.0.1:58643/oauth/google/callback");
    }

    #[test]
    fn initial_core_failure_requires_explicit_retry_and_keeps_one_identity(){
        let mut attempts=0usize;
        let mut prompts=0usize;
        let url=bootstrap_with_retry(||{
            attempts+=1;
            if attempts<3{Err("desktop_bootstrap_failed:CORE_TIMEOUT".into())}
            else{Ok("verified-startup-url".into())}
        },|reason|{
            assert_eq!(reason,"desktop_bootstrap_failed:CORE_TIMEOUT");
            prompts+=1;true
        }).unwrap();
        assert_eq!(url,Some("verified-startup-url".into()));
        assert_eq!(attempts,3);
        assert_eq!(prompts,2);
    }
    #[test]
    fn cancelling_failed_core_launch_does_not_initiate_another_attempt(){
        let mut attempts=0usize;
        let output=bootstrap_with_retry(||{
            attempts+=1;
            Err("desktop_bootstrap_failed:PORT_OCCUPIED".into())
        },|reason|{
            assert_eq!(reason,"desktop_bootstrap_failed:PORT_OCCUPIED");
            false
        }).unwrap();
        assert_eq!(output,None);
        assert_eq!(attempts,1);
    }
    #[test]
    fn unverified_install_or_origin_never_requests_retry(){
        let response=bootstrap_with_retry(
            ||Err("desktop_bootstrap_unexpected_origin".into()),
            |_|panic!("invalid bootstrap must not be retried")
        );
        assert_eq!(response,Err("desktop_bootstrap_unexpected_origin".into()));
        let missing=bootstrap_with_retry(
            ||Err("managed_python_missing".into()),
            |_|panic!("unknown Python must never be invoked")
        );
        assert_eq!(missing,Err("managed_python_missing".into()));
    }
    #[test]
    fn native_startup_keeps_private_errors_out_of_ui_codes(){
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"PORT_OCCUPIED"}"#),"PORT_OCCUPIED");
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"CORE_TIMEOUT"}"#),"CORE_TIMEOUT");
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"CORE_DEPENDENCY"}"#),"CORE_DEPENDENCY");
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"CORE_DATA_ACCESS"}"#),"CORE_DATA_ACCESS");
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"CORE_POWERSHELL"}"#),"CORE_POWERSHELL");
        assert_eq!(bootstrap_failure_code(br#"{"error_code":"private-file-path"}"#),"UNKNOWN");
        assert_eq!(bootstrap_failure_code(b"private internal output"),"UNKNOWN");
    }
    #[test]
    fn native_renewal_rejects_wrong_window_origin_and_ticket(){
        assert!(trusted_window_url("http://127.0.0.1:19923/desktop/",19923));
        for invalid in ["http://localhost:19923/desktop/", "http://127.0.0.1:19924/desktop/",
                        "http://127.0.0.1:19923/desktop/other", "http://127.0.0.1:19923/desktop/?x=1"]{
            assert!(!trusted_window_url(invalid,19923));
        }
        let ticket="A".repeat(43);
        let url=format!("http://127.0.0.1:19923/desktop/#iwxa_bootstrap={ticket}");
        assert_eq!(ticket_from_url(&url,19923),Some(ticket));
        assert!(ticket_from_url("http://127.0.0.1:19923/desktop/#iwxa_bootstrap=bad",19923).is_none());
        assert!(ticket_from_url("http://127.0.0.1:19924/desktop/#iwxa_bootstrap=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",19923).is_none());
        assert!(ticket_from_url("http://127.0.0.1:19923/desktop/#iwxa_bootstrap=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&extra=1",19923).is_none());
    }
}
