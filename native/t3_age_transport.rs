// Public desktop file transport only. The separately assembled ORIGINAL T3
// executable owns age/X25519, package checks and Windows DPAPI identity.
// No key material or decrypted bytes cross Tauri IPC or WebView.
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const MAX_RESPONSE: usize = 8192;
const MAX_EXECUTION: Duration = Duration::from_secs(75);
const RECIPIENT: &str = "age1";

fn component(app: &AppHandle) -> Result<PathBuf,String> {
    let root=app.path().resource_dir().map_err(|_|"AGE_DESKTOP_RESOURCE_UNAVAILABLE")?;
    let file=root.join("t3").join("iwxa-t3-age-desktop.exe");
    let meta=std::fs::symlink_metadata(&file)
        .map_err(|_|"AGE_DESKTOP_COMPONENT_NOT_BUNDLED")?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("AGE_DESKTOP_COMPONENT_NOT_BUNDLED".into());
    }
    Ok(file)
}
fn valid_recipient(v:&str)->bool {
    v.len()==62 && v.starts_with(RECIPIENT) &&
    v[4..].bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()) &&
    !v[4..].bytes().any(|b|b==b'1'||b==b'b'||b==b'i'||b==b'o')
}
pub fn recipients(input:&str)->Result<String,String> {
    let values:Vec<&str>=input.lines().map(str::trim).filter(|s|!s.is_empty()).collect();
    if values.is_empty() || values.len()>16 ||
        values.iter().any(|s|!valid_recipient(s)) {
        return Err("AGE_DESKTOP_RECIPIENT_INVALID".into());
    }
    let mut unique=std::collections::HashSet::new();
    if !values.iter().all(|s|unique.insert(*s)) {
        return Err("AGE_DESKTOP_RECIPIENT_DUPLICATE".into());
    }
    serde_json::to_string(&values).map_err(|_|"AGE_DESKTOP_RECIPIENT_INVALID".into())
}
fn exact_suffix(path:&Path,extension:&str)->bool {
    path.file_name().and_then(|n|n.to_str())
        .is_some_and(|n|n.ends_with(extension) && n.len()>extension.len())
}
fn ensure_file(path:&Path,extension:&str,max:u64)->Result<(),String> {
    if !path.is_absolute() || !exact_suffix(path,extension) {
        return Err("AGE_DESKTOP_SOURCE_INVALID".into());
    }
    let meta=std::fs::metadata(path).map_err(|_|"AGE_DESKTOP_SOURCE_UNREADABLE")?;
    if !meta.is_file() || meta.len()==0 || meta.len()>max {
        return Err("AGE_DESKTOP_SOURCE_SIZE_INVALID".into());
    }
    Ok(())
}
fn ensure_destination(path:&Path,extension:&str)->Result<(),String> {
    if !path.is_absolute() || !exact_suffix(path,extension) ||
        !path.parent().is_some_and(|p|p.is_dir()) {
        return Err("AGE_DESKTOP_DESTINATION_INVALID".into());
    }
    if path.exists() {return Err("AGE_DESKTOP_DESTINATION_EXISTS".into());}
    Ok(())
}
fn require_reply(value:&Value,action:&str)->Result<(),String>{
    let op=match action {
        "status"=>"AGE_STATUS",
        "recipient-create"=>"AGE_RECIPIENT_CREATED",
        "inspect"=>"AGE_INSPECTED",
        "encrypt"=>"AGE_ENCRYPTED",
        "decrypt-local"=>"AGE_DECRYPTED",
        _=>return Err("AGE_DESKTOP_ACTION_UNSUPPORTED".into())
    };
    if value["operation"]!=op || value["admitted"]!=false {
        return Err("AGE_DESKTOP_RECEIPT_INVALID".into());
    }
    if action=="decrypt-local" && value["state"]!="DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED"{
        return Err("AGE_DESKTOP_DECRYPT_RECEIPT_INVALID".into());
    }
    if action=="encrypt" && value["deliveryState"]!="NOT_CONFIRMED"{
        return Err("AGE_DESKTOP_EXPORT_RECEIPT_INVALID".into());
    }
    Ok(())
}
// The original T3 verifies the exact hashes again before running age or
// receiving a private DPAPI identity. This pinned manifest and two upstream
// executables are installed as immutable resources by the trusted Setup Core.
fn configure_pinned_age(app:&AppHandle,cmd:&mut Command)->Result<(),String>{
    let root=app.path().resource_dir().map_err(|_|"AGE_DESKTOP_RESOURCE_UNAVAILABLE")?
        .join("t3");
    let manifest=root.join("age-toolchain.json");
    let raw=std::fs::read(&manifest).map_err(|_|"AGE_DESKTOP_TOOLCHAIN_NOT_BUNDLED")?;
    if raw.len()>4096{return Err("AGE_DESKTOP_TOOLCHAIN_INVALID".into());}
    let view:Value=serde_json::from_slice(&raw)
        .map_err(|_|"AGE_DESKTOP_TOOLCHAIN_INVALID")?;
    if view["schema"]!="IWXA_T3_AGE_PINNED_TOOLCHAIN/1" {
        return Err("AGE_DESKTOP_TOOLCHAIN_INVALID".into());
    }
    let mut checked=Vec::new();
    for (name,pin_name) in [("age.exe","ageSha256"),("age-keygen.exe","ageKeygenSha256")] {
        let expected=view[pin_name].as_str().ok_or("AGE_DESKTOP_TOOLCHAIN_INVALID")?;
        if expected.len()!=64 || !expected.bytes().all(|b|b.is_ascii_digit()||
            (b'a'..=b'f').contains(&b)){
            return Err("AGE_DESKTOP_TOOLCHAIN_INVALID".into());
        }
        let file=root.join(name);
        let meta=std::fs::symlink_metadata(&file)
            .map_err(|_|"AGE_DESKTOP_TOOLCHAIN_NOT_BUNDLED")?;
        if !meta.is_file()||meta.file_type().is_symlink(){
            return Err("AGE_DESKTOP_TOOLCHAIN_NOT_BUNDLED".into());
        }
        // SHA-256 verification is also done by the original T3 process
        // immediately before invoking either external tool.
        checked.push((file,expected.to_owned()));
    }
    cmd.env("IWXA_T3_AGE_BINARY",&checked[0].0)
       .env("IWXA_T3_AGE_SHA256",&checked[0].1)
       .env("IWXA_T3_AGE_KEYGEN_BINARY",&checked[1].0)
       .env("IWXA_T3_AGE_KEYGEN_SHA256",&checked[1].1);
    Ok(())
}

fn run(app:&AppHandle,root:&Path,action:&str,args:&[String])->Result<Value,String>{
    let binary=component(app)?;
    let mut cmd=Command::new(binary);
    cmd.arg(action).arg(root).args(args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os="windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    // Never trust age paths inherited from the environment of the GUI process.
    for name in ["IWXA_T3_AGE_BINARY","IWXA_T3_AGE_SHA256",
                 "IWXA_T3_AGE_KEYGEN_BINARY","IWXA_T3_AGE_KEYGEN_SHA256"]{
        cmd.env_remove(name);
    }
    // Status remains readable if resources are not yet installed: the
    // original T3 reports toolchain.ready=false instead of a dead panel.
    match action{
        "inspect"=>{},
        "status"=>{let _=configure_pinned_age(app,&mut cmd);},
        _=>configure_pinned_age(app,&mut cmd)?
    }
    let mut child=cmd.spawn().map_err(|_|"AGE_DESKTOP_START_FAILED")?;
    let stdout=child.stdout.take().ok_or("AGE_DESKTOP_OUTPUT_UNAVAILABLE")?;
    let stderr=child.stderr.take().ok_or("AGE_DESKTOP_OUTPUT_UNAVAILABLE")?;
    fn drain<R:std::io::Read>(mut stream:R,cap:usize)->Vec<u8>{
        let mut out=Vec::new();
        let mut buf=[0u8;4096];
        loop {
            let size=match stream.read(&mut buf){Ok(n)=>n,Err(_)=>break};
            if size==0 {break}
            let count=(cap+1).saturating_sub(out.len()).min(size);
            out.extend_from_slice(&buf[..count]);
        }
        out
    }
    let output_thread=std::thread::spawn(move||drain(stdout,MAX_RESPONSE));
    let error_thread=std::thread::spawn(move||drain(stderr,1024));
    let start=Instant::now();
    let result=loop {
        match child.try_wait(){
            Ok(Some(code))=>break Some(code),
            Ok(None) if start.elapsed()<MAX_EXECUTION=>
                std::thread::sleep(Duration::from_millis(30)),
            _=>{let _=child.kill();let _=child.wait();break None;}
        }
    };
    let output=output_thread.join().map_err(|_|"AGE_DESKTOP_OUTPUT_FAILED")?;
    let errors=error_thread.join().map_err(|_|"AGE_DESKTOP_OUTPUT_FAILED")?;
    let status=result.ok_or("AGE_DESKTOP_TIMEOUT")?;
    if !status.success(){
        let code=String::from_utf8_lossy(&errors);
        let code=code.trim();
        if !code.is_empty() && code.len()<130 &&
            code.bytes().all(|b|b.is_ascii_uppercase()||b.is_ascii_digit()||b==b'_'){
            return Err(code.to_owned());
        }
        return Err("AGE_DESKTOP_OPERATION_FAILED".into());
    }
    if output.is_empty()||output.len()>MAX_RESPONSE {
        return Err("AGE_DESKTOP_REPLY_SIZE_INVALID".into());
    }
    let value:Value=serde_json::from_slice(&output)
        .map_err(|_|"AGE_DESKTOP_REPLY_INVALID")?;
    require_reply(&value,action)?;
    Ok(value)
}
fn verify_saved_file(path:&Path,reply:&Value,digest_field:&str,limit:u64)->Result<(),String>{
    let declared=reply["bytes"].as_u64()
        .ok_or("AGE_DESKTOP_FILE_READBACK_MISMATCH")?;
    let expected=reply[digest_field].as_str()
        .ok_or("AGE_DESKTOP_FILE_READBACK_MISMATCH")?;
    if declared==0||declared>limit||expected.len()!=64||
       !expected.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b)){
        return Err("AGE_DESKTOP_FILE_READBACK_MISMATCH".into());
    }
    let info=std::fs::symlink_metadata(path)
        .map_err(|_|"AGE_DESKTOP_FILE_READBACK_MISSING")?;
    if !info.is_file()||info.file_type().is_symlink()||info.len()!=declared{
        return Err("AGE_DESKTOP_FILE_READBACK_MISMATCH".into());
    }
    let mut file=std::fs::File::open(path)
        .map_err(|_|"AGE_DESKTOP_FILE_READBACK_MISSING")?;
    let mut hash=Sha256::new();
    let mut count=0_u64;
    let mut buffer=[0u8;65536];
    loop{
        let n=file.read(&mut buffer)
            .map_err(|_|"AGE_DESKTOP_FILE_READBACK_FAILED")?;
        if n==0{break;}
        count=count.saturating_add(n as u64);
        if count>limit{return Err("AGE_DESKTOP_FILE_READBACK_MISMATCH".into());}
        hash.update(&buffer[..n]);
    }
    if count!=declared||format!("{:x}",hash.finalize())!=expected{
        return Err("AGE_DESKTOP_FILE_READBACK_MISMATCH".into());
    }
    Ok(())
}

fn file_picker(title:&str,extension:&str)->Option<PathBuf>{
    rfd::FileDialog::new().set_title(title)
        .add_filter("IWXA",&[extension]).pick_file()
}
fn save_picker(title:&str,extension:&str,default:&str)->Option<PathBuf>{
    rfd::FileDialog::new().set_title(title)
        .add_filter("IWXA",&[extension])
        .set_file_name(default).save_file()
}
pub fn status(app:&AppHandle,root:&Path)->Result<Value,String>{
    run(app,root,"status",&[])
}
pub fn create_recipient(app:&AppHandle,root:&Path)->Result<Value,String>{
    run(app,root,"recipient-create",&[])
}
pub fn inspect(app:&AppHandle,root:&Path)->Result<Option<Value>,String>{
    let Some(path)=file_picker("Проверить заголовок .iwxa.age","age") else{return Ok(None)};
    ensure_file(&path,".iwxa.age",33*1024*1024)?;
    run(app,root,"inspect",&[path.to_string_lossy().into_owned()]).map(Some)
}
pub fn select_encrypted_destination(suggested:&str)->Result<Option<PathBuf>,String>{
    if !suggested.ends_with(".iwxa.age")||suggested.len()>128||
       suggested.bytes().any(|b| !b.is_ascii_alphanumeric()&&b!=b'-'&&b!=b'_'&&b!=b'.'){
        return Err("AGE_DESKTOP_FILENAME_INVALID".into());
    }
    let selected=save_picker("Сохранить защищённый пакет .iwxa.age","age",suggested);
    if let Some(ref path)=selected {ensure_destination(path,".iwxa.age")?;}
    Ok(selected)
}
pub fn encrypt_to_path(app:&AppHandle,root:&Path,source:&Path,target:&Path,
 raw_recipients:&str)->Result<Value,String>{
    let recipients=recipients(raw_recipients)?;
    ensure_file(source,".iwxa",32*1024*1024)?;
    ensure_destination(target,".iwxa.age")?;
    if source==target{return Err("AGE_DESKTOP_PATH_CONFLICT".into());}
    let args=[source.to_string_lossy().into_owned(),target.to_string_lossy().into_owned(),recipients];
    let receipt=run(app,root,"encrypt",&args)?;
    verify_saved_file(target,&receipt,"ciphertextSha256",33*1024*1024)?;
    Ok(receipt)
}
pub fn encrypt_source(app:&AppHandle,root:&Path,source:&Path,raw_recipients:&str)
 ->Result<Option<Value>,String>{
    recipients(raw_recipients)?;
    ensure_file(source,".iwxa",32*1024*1024)?;
    let suggested=format!("{}.age",source.file_name().and_then(|s|s.to_str()).unwrap_or("package.iwxa"));
    let Some(target)=select_encrypted_destination(&suggested)? else{return Ok(None)};
    encrypt_to_path(app,root,source,&target,raw_recipients).map(Some)
}
pub fn encrypt(app:&AppHandle,root:&Path,raw_recipients:&str)->Result<Option<Value>,String>{
    recipients(raw_recipients)?;
    let Some(source)=file_picker("Выбрать исходный пакет .iwxa","iwxa") else{return Ok(None)};
    encrypt_source(app,root,&source,raw_recipients)
}
// Keep decrypted data out of WebView and never leave a recovered license in
// user-selected folders. The original T3 consumer reads this short-lived file
// while the native operation owns its lifetime.
pub struct TransientPackage {
    directory: PathBuf,
    pub path: PathBuf,
}
impl TransientPackage {
    pub fn new()->Result<Self,String>{
        use std::time::{SystemTime,UNIX_EPOCH};
        let folder=std::env::temp_dir();
        for attempt in 0..8{
            let stamp=SystemTime::now().duration_since(UNIX_EPOCH)
                .map_err(|_|"AGE_DESKTOP_TEMP_UNAVAILABLE")?.as_nanos();
            let directory=folder.join(format!("iwxa-age-verified-{}-{stamp}-{attempt}",std::process::id()));
            match std::fs::create_dir(&directory) {
                Ok(())=>{
                    let path=directory.join("received.iwxa");
                    return Ok(Self{directory,path});
                }
                Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,
                Err(_)=>return Err("AGE_DESKTOP_TEMP_UNAVAILABLE".into()),
            }
        }
        Err("AGE_DESKTOP_TEMP_UNAVAILABLE".into())
    }
}
impl Drop for TransientPackage {
    fn drop(&mut self){let _=std::fs::remove_dir_all(&self.directory);}
}
pub fn decrypt_source(app:&AppHandle,root:&Path,source:&Path,target:&Path)
 ->Result<Value,String>{
    ensure_file(source,".iwxa.age",33*1024*1024)?;
    ensure_destination(target,".iwxa")?;
    let args=[source.to_string_lossy().into_owned(),target.to_string_lossy().into_owned()];
    let receipt=run(app,root,"decrypt-local",&args)?;
    verify_saved_file(target,&receipt,"sourceSha256",32*1024*1024)?;
    Ok(receipt)
}

pub fn decrypt(app:&AppHandle,root:&Path)->Result<Option<Value>,String>{
    let Some(source)=file_picker("Открыть защищённый пакет .iwxa.age","age") else{return Ok(None)};
    ensure_file(&source,".iwxa.age",33*1024*1024)?;
    let suggested=source.file_name().and_then(|v|v.to_str())
        .unwrap_or("received.iwxa.age").trim_end_matches(".age");
    let Some(target)=save_picker("Сохранить расшифрованный .iwxa","iwxa",suggested) else{return Ok(None)};
    ensure_destination(&target,".iwxa")?;
    if source==target{return Err("AGE_DESKTOP_PATH_CONFLICT".into());}
    let args=[source.to_string_lossy().into_owned(),target.to_string_lossy().into_owned()];
    let receipt=run(app,root,"decrypt-local",&args)?;
    verify_saved_file(&target,&receipt,"sourceSha256",32*1024*1024)?;
    Ok(Some(receipt))
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn rejects_invalid_recipients_without_starting_private_owner(){
        assert!(recipients("").is_err());
        assert!(recipients("not-age").is_err());
        assert!(recipients(&format!("{}\n{}", "age1q".repeat(1),"age1q")).is_err());
        assert!(require_reply(&serde_json::json!({"operation":"AGE_DECRYPTED","admitted":true,
          "state":"DECRYPTED_INTEGRITY_VERIFIED_NOT_ADMITTED"}),"decrypt-local").is_err());
    }
    #[test]
    fn verifies_real_file_bytes_before_claiming_desktop_export(){
        use std::time::{SystemTime,UNIX_EPOCH};
        let unique=SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let file=std::env::temp_dir().join(format!("iwxa-age-readback-{}-{unique}.iwxa",std::process::id()));
        let content=b"synthetic-original-content";
        std::fs::write(&file,content).unwrap();
        let sha=format!("{:x}",Sha256::digest(content));
        let good=serde_json::json!({"bytes":content.len(),"sourceSha256":sha});
        assert!(verify_saved_file(&file,&good,"sourceSha256",4096).is_ok());
        assert!(verify_saved_file(&file,&good,"sourceSha256",4).is_err());
        let forged=serde_json::json!({"bytes":content.len(),"sourceSha256":"0".repeat(64)});
        assert!(verify_saved_file(&file,&forged,"sourceSha256",4096).is_err());
        std::fs::write(&file,b"changed").unwrap();
        assert!(verify_saved_file(&file,&good,"sourceSha256",4096).is_err());
        std::fs::remove_file(&file).unwrap();
    }
    #[test]
    fn enforces_explicit_transport_states(){
        assert!(require_reply(&serde_json::json!({"operation":"AGE_ENCRYPTED","admitted":false,
          "deliveryState":"NOT_CONFIRMED"}),"encrypt").is_ok());
        assert!(require_reply(&serde_json::json!({"operation":"AGE_ENCRYPTED","admitted":false,
          "deliveryState":"DELIVERED"}),"encrypt").is_err());
    }
}
