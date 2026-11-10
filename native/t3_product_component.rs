// Public native adapter ONLY; original issuer/verifier binaries are assembled
// privately by the T3 owner into product bundles. No cryptography, T3 source,
// trusting the file, fallback Node/Bun install, new license Store or IAM here.
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub const MAX_OUTPUT: usize = 256 * 1024;
pub const MAX_EXECUTION: Duration = Duration::from_secs(90);

fn kind_spec(role: &str) -> Result<(&'static str, &'static str), String> {
    match role {
        "owner" => Ok(("iwxa-t3-product-owner.exe", "t3-owner-test")),
        "owner-person" => Ok(("iwxa-t3-product-owner.exe", "t3-owner-person")),
        "consumer" => Ok(("iwxa-t3-product-consumer.exe", "t3-consumer-test")),
        _ => Err("T3_PRODUCT_COMPONENT_ROLE_INVALID".into())
    }
}
fn binary(app: &AppHandle, role: &str) -> Result<PathBuf, String> {
    let (file, _) = kind_spec(role)?;
    let root = app.path().resource_dir().map_err(|_|"T3_PRODUCT_RESOURCE_ROOT_UNAVAILABLE")?;
    let target = root.join("t3").join(file);
    match std::fs::symlink_metadata(&target) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Ok(target),
        _ => Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_BUNDLED".into())
    }
}
pub fn data_root(app: &AppHandle, role: &str) -> Result<PathBuf, String> {
    let (_, subdirectory) = kind_spec(role)?;
    let base = app.path().app_local_data_dir()
        .map_err(|_|"T3_PRODUCT_DATA_ROOT_UNAVAILABLE")?;
    Ok(base.join(subdirectory))
}
pub fn availability(app:&AppHandle,role:&str) -> bool {
    let exe = match binary(app,role) { Ok(v)=>v, Err(_)=>return false };
    let root = match data_root(app,role) { Ok(v)=>v, Err(_)=>return false };
    let required: &[&str] = match role {
        "owner" | "owner-person" => &["registry.iwxa","anchor.json","keys.vault.json",
            "master-secret.dpapi.json","administrator.dpapi.json"],
        "consumer" => &["publisher-test-trust.json","master-secret.dpapi.json"],
        _ => return false
    };
    exe.is_file() && required.iter().all(|x|root.join(x).is_file())
}
fn simple_code(s:&str) -> bool {
    !s.is_empty() && s.len()<160 &&
    s.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
}
fn checked_output(output:std::process::Output) -> Result<Value,String> {
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        let code = message.trim();
        return Err(if simple_code(code){code.to_string()}
                   else {"T3_PRODUCT_COMPONENT_OPERATION_FAILED".into()});
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

pub fn run(app:&AppHandle,role:&str,action:&str,details:&[String]) -> Result<Value,String> {
    if !availability(app,role){return Err("T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED".into());}
    if !action.bytes().all(|b|b.is_ascii_lowercase()||b==b'-') ||
       action.len()>24 || details.len()>4 ||
       details.iter().any(|s|s.is_empty() || s.len()>4096 ||
         s.chars().any(|c|c.is_control())) {
        return Err("T3_PRODUCT_COMPONENT_ARGUMENTS_INVALID".into());
    }
    let file=binary(app,role)?;
    let root=data_root(app,role)?;
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
    // A simulated stdout larger than the Windows pipe capacity is drained
    // without buffering unbounded data or deadlocking the child.
    let payload=vec![b'X';2*MAX_OUTPUT];
    assert_eq!(drain_pipe(std::io::Cursor::new(payload),MAX_OUTPUT+1)
      .unwrap().len(),MAX_OUTPUT+1);
    assert!(valid_identifier("publisher:issuer:1"));
    assert_eq!(kind_spec("owner-person").unwrap(),
      ("iwxa-t3-product-owner.exe", "t3-owner-person"));
    assert_eq!(kind_spec("owner").unwrap().1,"t3-owner-test");
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
