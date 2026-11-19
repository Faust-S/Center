// Public native adapter ONLY; original issuer/verifier binaries are assembled
// privately by the T3 owner into product bundles. No cryptography, T3 source,
// trusting the file, fallback Node/Bun install, new license Store or IAM here.
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub const MAX_OUTPUT: usize = 256 * 1024;
pub const MAX_EXECUTION: Duration = Duration::from_secs(90);

fn kind_spec(role: &str) -> Result<(&'static str, &'static str), String> {
    match role {
        "owner" => Ok(("iwxa-t3-product-owner.exe", "t3-owner-test")),
        "consumer" => Ok(("iwxa-t3-product-consumer.exe", "t3-consumer-test")),
        // Reuse the SAME private original owner binary. D3 is an entirely
        // separate signed corporate profile, never the TEST issuer root.
        "admin-d3" => Ok(("iwxa-t3-product-owner.exe", "t3-admin")),
        _ => Err("T3_PRODUCT_COMPONENT_ROLE_INVALID".into())
    }
}
fn binary(app: &AppHandle, role: &str) -> Result<PathBuf, String> {
    let (file, _) = kind_spec(role)?;
    let root = app.path().resource_dir().map_err(|_|"T3_PRODUCT_RESOURCE_ROOT_UNAVAILABLE")?;
    let target = root.join("t3").join(file);
    match std::fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
            if role=="admin-d3" || role=="consumer" {
                // Neither the signed corporate owner nor the original
                // license Consumer is authenticated by an EXE filename.
                // Both SHA-256 pins are compiled by the trusted private
                // Setup Core recipe from the exact original T3 binaries.
                let (expected,missing,invalid,unreadable,mismatch)=
                  if role=="admin-d3" {
                    (option_env!("IWXA_T3_ADMIN_D3_OWNER_SHA256"),
                     "CEN_D3_ORIGINAL_OWNER_DIGEST_NOT_COMPILED",
                     "CEN_D3_ORIGINAL_OWNER_DIGEST_INVALID",
                     "CEN_D3_ORIGINAL_OWNER_UNREADABLE",
                     "CEN_D3_ORIGINAL_OWNER_BINARY_MISMATCH")
                  }else{
                    (option_env!("IWXA_T3_CONSUMER_SHA256"),
                     "CEN04_ORIGINAL_CONSUMER_DIGEST_NOT_COMPILED",
                     "CEN04_ORIGINAL_CONSUMER_DIGEST_INVALID",
                     "CEN04_ORIGINAL_CONSUMER_UNREADABLE",
                     "CEN04_ORIGINAL_CONSUMER_BINARY_MISMATCH")
                  };
                let expected=expected.ok_or(missing)?;
                if expected.len()!=64 ||
                   !expected.bytes().all(|x|x.is_ascii_digit()||
                       (b'a'..=b'f').contains(&x)) {
                    return Err(invalid.into());
                }
                let mut file=std::fs::File::open(&target)
                    .map_err(|_|unreadable.to_owned())?;
                let mut digest=Sha256::new();
                let mut buffer=[0_u8;64*1024];
                loop {
                    let n=file.read(&mut buffer)
                        .map_err(|_|unreadable.to_owned())?;
                    if n==0{break;}
                    digest.update(&buffer[..n]);
                }
                if format!("{:x}",digest.finalize())!=expected{
                    return Err(mismatch.into());
                }
            }
            Ok(target)
        },
        _ => Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_BUNDLED".into())
    }
}
pub fn data_root(app: &AppHandle, role: &str) -> Result<PathBuf, String> {
    let (_, subdirectory) = kind_spec(role)?;
    let base = crate::center_product_data_root(app)?;
    Ok(base.join(subdirectory))
}
// One ORIGINAL per-organization Reconciliation/Access root. Never merge two
// company grants, result quarantine or Windows DPAPI secrets into a global
// 't3-admin' profile. Match Center's established Atlas org ID scope.
pub fn valid_organization_scope_id(s:&str)->bool {
    !s.is_empty()&&s.len()<=100&&s.bytes().all(|b|
        b.is_ascii_alphanumeric()||b==b'-'||b==b'_')
}
pub fn admin_d3_root(app:&AppHandle,org:&str)->Result<PathBuf,String>{
    if !valid_organization_scope_id(org){
        return Err("CEN_D3_ORGANIZATION_SCOPE_INVALID".into());
    }
    Ok(data_root(app,"admin-d3")?.join("organizations").join(org))
}
fn admin_d3_files_available(root:&Path)->bool{
    ["registry.json","identity.json","vault.json","operators.json",
     "master-secret.dpapi.json"].iter().all(|name|root.join(name).is_file())
}
pub fn admin_d3_availability(app:&AppHandle,org:&str)->bool {
    binary(app,"admin-d3").is_ok() &&
      admin_d3_root(app,org).is_ok_and(|root|admin_d3_files_available(&root))
}
pub fn binary_present(app:&AppHandle,role:&str)->bool {
    binary(app,role).is_ok()
}
pub fn availability(app:&AppHandle,role:&str) -> bool {
    let exe = match binary(app,role) { Ok(v)=>v, Err(_)=>return false };
    let root = match data_root(app,role) { Ok(v)=>v, Err(_)=>return false };
    let required: &[&str] = match role {
        "owner" => &["registry.iwxa","anchor.json","keys.vault.json",
            "master-secret.dpapi.json","administrator.dpapi.json"],
        "consumer" => &["publisher-test-trust.json","master-secret.dpapi.json"],
        "admin-d3" => &["registry.json","identity.json","vault.json",
            "operators.json","master-secret.dpapi.json"],
        _ => return false
    };
    exe.is_file() && required.iter().all(|x|root.join(x).is_file())
}
fn simple_code(s:&str) -> bool {
    !s.is_empty() && s.len()<160 &&
    s.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
}
// The original signed owner is an independently SHA-256-pinned executable.
// Raw stderr may contain a filesystem path or private diagnostic. Never
// forward it to WebView or public CI; retain only exact bounded machine codes
// or a deliberately coarse category. No raw stderr is logged.
fn bounded_original_failure(stderr:&[u8])->String {
    let message=String::from_utf8_lossy(stderr);
    let code=message.trim();
    if simple_code(code){return code.to_owned();}
    for line in message.lines() {
        let line=line.trim().strip_prefix("Error: ")
            .unwrap_or_else(||line.trim());
        if simple_code(line) &&
           (line.starts_with("T3_D3_")||line.starts_with("CEN_D3_")||
            line.starts_with("WINDOWS_")||line.starts_with("DPAPI_")) {
            return line.to_owned();
        }
    }
    let category=if message.contains("ENOENT")||
                    message.contains("FileNotFound")||
                    message.contains("No such file or directory") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_FILE_NOT_FOUND"
    }else if message.contains("EACCES")||
             message.contains("EPERM")||
             message.contains("Access is denied") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_ACCESS_DENIED"
    }else if message.contains("Cannot find module")||
             message.contains("MODULE_NOT_FOUND") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_MODULE_NOT_FOUND"
    }else if message.contains("TypeError:") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_RUNTIME_TYPE_ERROR"
    }else if message.contains("ReferenceError:") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_RUNTIME_REFERENCE_ERROR"
    }else if message.contains("SyntaxError:") {
        "T3_PRODUCT_COMPONENT_ORIGINAL_RUNTIME_SYNTAX_ERROR"
    }else if message.trim().is_empty() {
        "T3_PRODUCT_COMPONENT_ORIGINAL_EMPTY_STDERR"
    }else{
        "T3_PRODUCT_COMPONENT_OPERATION_FAILED"
    };
    category.to_owned()
}
fn checked_output(output:std::process::Output) -> Result<Value,String> {
    if !output.status.success() {
        return Err(bounded_original_failure(&output.stderr));
    }
    if output.stdout.is_empty() || output.stdout.len()>MAX_OUTPUT {
        return Err("T3_PRODUCT_COMPONENT_OUTPUT_SIZE_INVALID".into());
    }
    let result:Value = serde_json::from_slice(&output.stdout)
        .map_err(|_|"T3_PRODUCT_COMPONENT_OUTPUT_JSON_INVALID")?;
    if result.get("productionActivation")!=Some(&Value::Bool(false)) ||
       result.get("activeSeats")!=Some(&Value::from(0)) {
        return Err("T3_PRODUCT_COMPONENT_TEST_ONLY_RESULT_REQUIRED".into());
    }
    Ok(result)
}
// Keep draining even if the content exceeds its cap: never allow a child
// to block on an unread full pipe. Output beyond cap is discarded and the
// existing checked_output() subsequently rejects oversized stdout.
fn drain_pipe<R: std::io::Read>(mut stream:R,cap:usize)->Result<Vec<u8>,String>{
    let mut output=Vec::new();
    let mut buffer=[0_u8;4096];
    loop {
        let n=stream.read(&mut buffer)
            .map_err(|_|"T3_PRODUCT_COMPONENT_OUTPUT_READ_FAILED")?;
        if n==0 {break;}
        let available=cap.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..n.min(available)]);
    }
    Ok(output)
}

// The production corporate first-use command is "d3-enroll": ASCII
// digits in a fixed native action must not be rejected before the original
// signed Owner is launched. Keep strict no-shell, bounded argv validation.
fn valid_product_action(action:&str)->bool{
    !action.is_empty() && action.len()<=24 &&
    action.bytes().enumerate().all(|(i,b)|
        b.is_ascii_lowercase() || (i>0 && (b.is_ascii_digit()||b==b'-')))
}
pub fn run(app:&AppHandle,role:&str,action:&str,details:&[String]) -> Result<Value,String> {
    // Allow digits AFTER the first lowercase letter, not spaces, shell
    // syntax, path separators or arbitrary Unicode commands.
    if !valid_product_action(action) || details.len()>4 ||
       details.iter().any(|s|s.is_empty() || s.len()>4096 ||
         s.chars().any(|c|c.is_control())) {
        return Err("T3_PRODUCT_COMPONENT_ARGUMENTS_INVALID".into());
    }
    let file=binary(app,role)?;
    let root=if role=="admin-d3"{
        let organization=details.first()
            .ok_or("CEN_D3_ORGANIZATION_SCOPE_REQUIRED")?;
        let scope=admin_d3_root(app,organization)?;
        if action!="d3-enroll" && !admin_d3_files_available(&scope){
            return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
        }
        scope
    }else{
        if !(role=="consumer"&&action=="test-enroll") && !availability(app,role){
            return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
        }
        data_root(app,role)?
    };
    let mut cmd=Command::new(file);
    cmd.arg(action).arg(root).args(details)
       .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os="windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child=cmd.spawn().map_err(|_|"T3_PRODUCT_COMPONENT_START_FAILED")?;
    // Drain both pipes from the moment the child starts. Waiting for process
    // exit before reading stdout causes a Windows pipe-capacity deadlock when
    // the original T3 owner inventory contains many licensed entries.
    let stdout=child.stdout.take().ok_or("T3_PRODUCT_COMPONENT_STDOUT_UNAVAILABLE")?;
    let stderr=child.stderr.take().ok_or("T3_PRODUCT_COMPONENT_STDERR_UNAVAILABLE")?;
    let stdout_reader=std::thread::spawn(move||drain_pipe(stdout,MAX_OUTPUT+1));
    let stderr_reader=std::thread::spawn(move||drain_pipe(stderr,4096));
    let start=Instant::now();
    let status=loop {
        match child.try_wait() {
            Ok(Some(status))=>break Some(status),
            Ok(None) if start.elapsed() < MAX_EXECUTION =>
                std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _=child.kill();
                let _=child.wait();
                break None;
            }
        }
    };
    let out=stdout_reader.join()
        .map_err(|_|"T3_PRODUCT_COMPONENT_OUTPUT_READER_FAILED")??;
    let err=stderr_reader.join()
        .map_err(|_|"T3_PRODUCT_COMPONENT_OUTPUT_READER_FAILED")??;
    let status=status.ok_or("T3_PRODUCT_COMPONENT_TIMEOUT_OR_WAIT_FAILED")?;
    checked_output(std::process::Output{status,stdout:out,stderr:err})
}
// Open the SAME pinned private original D3 owner EXE for the lifetime of
// one selected corporate session. This replaces concurrent d3-state/action
// CLI opens of the same product.lock. It is NOT a new binary or a new Host.
pub fn spawn_admin_d3_host(app:&AppHandle,organization_id:&str)
    ->Result<std::process::Child,String>{
    if !cfg!(target_os="windows"){
        return Err("T3_D3_NATIVE_WINDOWS_REQUIRED".into());
    }
    let scope=admin_d3_root(app,organization_id)?;
    if !admin_d3_files_available(&scope){
        return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());
    }
    let exe=binary(app,"admin-d3")?;
    let mut command=Command::new(exe);
    command.arg("d3-host").arg(scope).arg(organization_id)
        .stdin(Stdio::piped()).stdout(Stdio::piped())
        // All host replies are bounded JSON on stdout. Do not risk
        // leaking private paths or signer diagnostics to Tauri/WebView.
        .stderr(Stdio::null());
    #[cfg(target_os="windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command.spawn().map_err(|_|"T3_D3_ORIGINAL_HOST_START_FAILED".into())
}
pub fn valid_identifier(s:&str)->bool{
    !s.is_empty() && s.len()<=160 &&
    s.as_bytes().iter().enumerate().all(|(i,b)|
      b.is_ascii_alphanumeric() || (i>0 && [b'.',b'_',b':',b'/',b'@',b'-'].contains(b)))
}
pub fn validate_test_result(result:&Value,kind:&str)->Result<(),String>{
    if result.get("operation").and_then(Value::as_str)!=Some(kind) ||
        result.get("productionActivation")!=Some(&Value::Bool(false)) ||
        result.get("activeSeats")!=Some(&Value::from(0)) {
        return Err("T3_PRODUCT_UNVERIFIED_NATIVE_RESULT".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn native_component_adapter_does_not_trust_strings_or_commercial_seats() {
    assert!(valid_product_action("d3-enroll"));
    assert!(valid_product_action("test-enroll"));
    assert!(!valid_product_action(""));
    assert!(!valid_product_action("3d-enroll"));
    assert!(!valid_product_action("D3-enroll"));
    assert!(!valid_product_action("d3/enroll"));
    assert!(!valid_product_action("d3 enroll"));
    assert!(!valid_product_action("d3;enroll"));
    assert!(!valid_product_action("d3-enroll-abcdefghijklmnop"));
    // A simulated stdout larger than the Windows pipe capacity is drained
    // without buffering unbounded data or deadlocking the child.
    let payload=vec![b'X';2*MAX_OUTPUT];
    assert_eq!(drain_pipe(std::io::Cursor::new(payload),MAX_OUTPUT+1)
      .unwrap().len(),MAX_OUTPUT+1);
    assert!(valid_identifier("publisher:issuer:1"));
    assert!(!valid_identifier("../relative"));
    assert!(!valid_identifier("bad name"));
    assert!(simple_code("T3_PRODUCT_NOT_ENROLLED"));
    assert!(!simple_code("C:\\private\\owner.pem"));
    assert!(validate_test_result(&serde_json::json!({
      "operation":"TEST_ISSUE","productionActivation":false,"activeSeats":0
    }),"TEST_ISSUE").is_ok());
    assert!(validate_test_result(&serde_json::json!({
      "operation":"TEST_ISSUE","productionActivation":true,"activeSeats":0
    }),"TEST_ISSUE").is_err());
    assert!(validate_test_result(&serde_json::json!({
      "operation":"TEST_ISSUE","productionActivation":false,"activeSeats":4
    }),"TEST_ISSUE").is_err());
 }
}
