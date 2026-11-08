#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const MAX_DRAFT_BYTES: usize = 512 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 32 * 1024 * 1024 * 1024;
struct DraftLock(Mutex<()>);

fn draft_file(root: &Path) -> PathBuf { root.join("publisher-preparation-v1.json") }
fn validate_preparation(content: &str) -> Result<(), String> {
    if content.len() > MAX_DRAFT_BYTES { return Err("PUBLISHER_DRAFT_TOO_LARGE".into()); }
    let record: Value = serde_json::from_str(content)
        .map_err(|_| "PUBLISHER_DRAFT_JSON_INVALID".to_string())?;
    if record.get("format").and_then(Value::as_str) != Some("iwxa.publisher.preparation")
        || record.get("version").and_then(Value::as_u64) != Some(1)
        || !["products", "holders", "proposals", "artifacts"].iter()
            .all(|key| record.get(key).is_some_and(Value::is_array))
    {
        return Err("PUBLISHER_DRAFT_FORMAT_INVALID".into());
    }
    Ok(())
}
fn write_preparation(root: &Path, content: &str) -> Result<(), String> {
    validate_preparation(content)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temporary = root.join(format!(".publisher-preparation-{}-{}.tmp", std::process::id(), now));
    let result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, draft_file(root)).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
fn read_preparation(root: &Path) -> Result<Option<String>, String> {
    let path = draft_file(root);
    if !path.exists() { return Ok(None); }
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_DRAFT_BYTES as u64 {
        return Err("PUBLISHER_DRAFT_READ_INVALID".into());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    validate_preparation(&content)?;
    Ok(Some(content))
}
fn publisher_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}
#[tauri::command]
fn publisher_draft_save(app: AppHandle, state: State<DraftLock>, content: String) -> Result<bool, String> {
    let _guard = state.0.lock().map_err(|_| "PUBLISHER_DRAFT_LOCK_INVALID")?;
    write_preparation(&publisher_root(&app)?, &content)?;
    Ok(true)
}
#[tauri::command]
fn publisher_draft_read(app: AppHandle, state: State<DraftLock>) -> Result<Option<String>, String> {
    let _guard = state.0.lock().map_err(|_| "PUBLISHER_DRAFT_LOCK_INVALID")?;
    read_preparation(&publisher_root(&app)?)
}

#[derive(Serialize)]
struct ArtifactInspection {
    name: String,
    size: u64,
    sha256: String,
}
fn inspect_artifact(path: &Path) -> Result<ArtifactInspection, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES {
        return Err("ARTIFACT_SIZE_UNSUPPORTED".into());
    }
    let name = path.file_name().and_then(|s| s.to_str()).ok_or("ARTIFACT_NAME_INVALID")?.to_string();
    if name.len() > 240 || name.chars().any(|c| c.is_control() || "\\/<>:\"|?*".contains(c)) {
        return Err("ARTIFACT_NAME_INVALID".into());
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    // Two inspections in one Tauri command must not exhaust the Windows
    // UI thread stack. Keep the bounded 1 MiB streaming buffer on the heap.
    let mut buffer = vec![0_u8; 1024 * 1024];
    let mut total = 0_u64;
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 { break; }
        hash.update(&buffer[..n]);
        total += n as u64;
        if total > MAX_ARTIFACT_BYTES { return Err("ARTIFACT_SIZE_UNSUPPORTED".into()); }
    }
    let observed = file.metadata().map_err(|e| e.to_string())?;
    if total != metadata.len() || observed.len() != metadata.len()
        || observed.modified().ok() != metadata.modified().ok()
        || observed.created().ok() != metadata.created().ok()
    {
        return Err("ARTIFACT_CHANGED_DURING_READ".into());
    }
    Ok(ArtifactInspection { name, size: total, sha256: format!("{:x}", hash.finalize()) })
}
#[tauri::command]
fn publisher_inspect_artifact() -> Result<Option<ArtifactInspection>, String> {
    let selected = rfd::FileDialog::new().pick_file();
    match selected {
        Some(path) => inspect_artifact(&path).map(Some),
        None => Ok(None),
    }
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct OfflineCopiesCheck {
    name: String,
    size: u64,
    sha256: String,
    copies_checked: u8,
    same_content: bool,
    distinct_selected_paths: bool,
    physical_independence_verified: bool,
    publisher_authorized: bool,
    signed_release_metadata_verified: bool,
}

// The CLI verifies independently staged copies with a stronger filesystem
// identity check. This *desktop* operation checks only two selected, distinct
// canonical paths and actual bytes. It never grants release approval.
fn compare_offline_copies(first: &Path, second: &Path) -> Result<OfflineCopiesCheck, String> {
    let first_path = fs::canonicalize(first).map_err(|_| "OFFLINE_COPY_PATH_INVALID")?;
    let second_path = fs::canonicalize(second).map_err(|_| "OFFLINE_COPY_PATH_INVALID")?;
    if first_path == second_path {
        return Err("OFFLINE_COPY_SAME_SELECTED_FILE".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let a = fs::metadata(&first_path).map_err(|_| "OFFLINE_COPY_PATH_INVALID")?;
        let b = fs::metadata(&second_path).map_err(|_| "OFFLINE_COPY_PATH_INVALID")?;
        if a.dev() == b.dev() && a.ino() == b.ino() {
            return Err("OFFLINE_COPY_SAME_INODE".into());
        }
    }
    // Read sequentially; inspect_artifact already hashes in 1 MiB chunks and
    // rejects a changed file. No raw executable bytes enter the webview.
    let one = inspect_artifact(&first_path)?;
    let two = inspect_artifact(&second_path)?;
    if one.name != two.name {
        return Err("OFFLINE_COPY_FILENAME_MISMATCH".into());
    }
    if one.size != two.size {
        return Err("OFFLINE_COPY_SIZE_MISMATCH".into());
    }
    if one.sha256 != two.sha256 {
        return Err("OFFLINE_COPY_SHA256_MISMATCH".into());
    }
    Ok(OfflineCopiesCheck {
        name: one.name,
        size: one.size,
        sha256: one.sha256,
        copies_checked: 2,
        same_content: true,
        distinct_selected_paths: true,
        physical_independence_verified: false,
        publisher_authorized: false,
        signed_release_metadata_verified: false,
    })
}

#[tauri::command]
fn publisher_compare_offline_copies() -> Result<Option<OfflineCopiesCheck>, String> {
    let first = match rfd::FileDialog::new()
        .set_title("Publisher: первая копия файла").pick_file() {
        Some(path) => path,
        None => return Ok(None),
    };
    let second = match rfd::FileDialog::new()
        .set_title("Publisher: вторая копия файла").pick_file() {
        Some(path) => path,
        None => return Ok(None),
    };
    compare_offline_copies(&first, &second).map(Some)
}

const PUBLISHER_TEST_IWXA_MAX_BYTES: usize = 4 * 1024 * 1024;
struct DeliveryLock(Mutex<Option<Vec<u8>>>);
fn write_publisher_iwxa_copy(path:&Path,bytes:&[u8])->Result<(),String>{
    if bytes.is_empty()||bytes.len()>PUBLISHER_TEST_IWXA_MAX_BYTES{return Err("PUBLISHER_IWXA_SIZE_INVALID".into());}
    if path.exists(){return Err("PUBLISHER_IWXA_DESTINATION_EXISTS".into());}
    let folder=path.parent().ok_or("PUBLISHER_IWXA_DESTINATION_INVALID")?;
    if !folder.is_dir(){return Err("PUBLISHER_IWXA_DESTINATION_INVALID".into());}
    let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"PUBLISHER_IWXA_TIME_INVALID")?.as_nanos();
    let temp=folder.join(format!(".iwxa-test-delivery-{}-{now}.tmp",std::process::id()));
    let result=(||->Result<(),String>{
        let mut file=OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|_|"PUBLISHER_IWXA_DESTINATION_UNWRITABLE")?;
        file.write_all(bytes).map_err(|_|"PUBLISHER_IWXA_DESTINATION_UNWRITABLE")?;
        file.sync_all().map_err(|_|"PUBLISHER_IWXA_DESTINATION_UNWRITABLE")?;
        fs::rename(&temp,path).map_err(|_|"PUBLISHER_IWXA_DESTINATION_UNWRITABLE")?;
        if fs::read(path).map_err(|_|"PUBLISHER_IWXA_READBACK_FAILED")?!=bytes{
            return Err("PUBLISHER_IWXA_READBACK_FAILED".into());
        }
        Ok(())
    })();
    if result.is_err(){let _=fs::remove_file(&temp);let _=fs::remove_file(path);}
    result
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct UnverifiedIwxaCarrier {
    size: usize,
    sha256: String,
    integrity_verified: bool,
    signature_verified: bool,
    status_verified: bool,
    active_seats: u8,
    production_activation: bool,
}
fn publisher_read_test_iwxa(path: &Path) -> Result<(Vec<u8>, UnverifiedIwxaCarrier), String> {
    if path.extension().and_then(|x|x.to_str()) != Some("iwxa") {
        return Err("PUBLISHER_IWXA_EXTENSION_REQUIRED".into());
    }
    let metadata=fs::metadata(path).map_err(|_| "PUBLISHER_IWXA_FILE_UNREADABLE")?;
    if !metadata.is_file() || metadata.len()==0 ||
       metadata.len() > PUBLISHER_TEST_IWXA_MAX_BYTES as u64 {
        return Err("PUBLISHER_IWXA_SIZE_INVALID".into());
    }
    let bytes=fs::read(path).map_err(|_| "PUBLISHER_IWXA_FILE_UNREADABLE")?;
    if bytes.len() != metadata.len() as usize {return Err("PUBLISHER_IWXA_FILE_CHANGED".into());}
    // Only the canonical T3 package codec may validate manifest, signatures
    // or issuer. Rust does not parse private T3 contracts or install trust.
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("PUBLISHER_IWXA_NOT_ZIP".into());
    }
    let summary=UnverifiedIwxaCarrier{
        size:bytes.len(),sha256:format!("{:x}",Sha256::digest(&bytes)),
        integrity_verified:false,signature_verified:false,status_verified:false,
        active_seats:0,production_activation:false
    };
    Ok((bytes,summary))
}
#[tauri::command]
fn publisher_select_test_iwxa(state:State<DeliveryLock>)->Result<Option<UnverifiedIwxaCarrier>,String>{
    *state.0.lock().map_err(|_|"PUBLISHER_IWXA_LOCK_FAILED")?=None;
    let selection=rfd::FileDialog::new().set_title("Publisher: пакет .iwxa из T3")
        .add_filter("IWXA",&["iwxa"]).pick_file();
    match selection {
        Some(path)=>{
            let (bytes,summary)=publisher_read_test_iwxa(&path)?;
            *state.0.lock().map_err(|_|"PUBLISHER_IWXA_LOCK_FAILED")?=Some(bytes);
            Ok(Some(summary))
        },
        None=>Ok(None)
    }
}
#[tauri::command]
fn publisher_export_test_iwxa(state:State<DeliveryLock>,expected_sha256:String)->Result<bool,String>{
    let saved=state.0.lock().map_err(|_|"PUBLISHER_IWXA_LOCK_FAILED")?;
    let bytes=saved.as_ref().ok_or("PUBLISHER_IWXA_NOT_SELECTED")?;
    if bytes.len() > PUBLISHER_TEST_IWXA_MAX_BYTES ||
       expected_sha256!=format!("{:x}",Sha256::digest(bytes)) {
        return Err("PUBLISHER_IWXA_SELECTION_CHANGED".into());
    }
    let path=rfd::FileDialog::new().set_title("Publisher: передать TEST .iwxa в Admin Center")
        .add_filter("IWXA",&["iwxa"]).set_file_name("iwxa-product-test-delivery.iwxa").save_file();
    match path {
        Some(path)=>{
            if path.extension().and_then(|x|x.to_str())!=Some("iwxa"){
                return Err("PUBLISHER_IWXA_EXTENSION_REQUIRED".into());
            }
            write_publisher_iwxa_copy(&path,bytes).map(|_|true)
        },
        None=>Ok(false)
    }
}
#[cfg(test)]
mod publisher_iwxa_carrier_native_tests {
    use super::*;
    #[test]
    fn native_transport_never_calls_zip_signer_or_claims_entitlements() {
        let name=std::env::temp_dir().join(format!("test-iwxa-native-{}-{}.iwxa",
            std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let contents=b"PK\x03\x04\x00opaque-test-only-not-a-verified-license";
        fs::write(&name,contents).unwrap();
        let (selected,preview)=publisher_read_test_iwxa(&name).unwrap();
        assert_eq!(selected,contents);
        assert!(!preview.integrity_verified);
        assert!(!preview.signature_verified);
        assert!(!preview.status_verified);
        assert_eq!(preview.active_seats,0);
        assert!(!preview.production_activation);
        assert_eq!(preview.sha256,format!("{:x}",Sha256::digest(contents)));
        let other=name.with_extension("json");
        fs::write(&other,contents).unwrap();
        assert!(publisher_read_test_iwxa(&other).is_err());
        let _=fs::remove_file(&name);
        let _=fs::remove_file(&other);
    }
}

const TEST_REQUEST_LIMIT: usize = 32 * 1024;

fn validate_test_request(content: &str) -> Result<(), String> {
    if content.is_empty() || content.len() > TEST_REQUEST_LIMIT {
        return Err("TEST_REQUEST_SIZE_INVALID".into());
    }
    let value: Value = serde_json::from_str(content)
        .map_err(|_| "TEST_REQUEST_JSON_INVALID".to_string())?;
    let fields = value.as_object().ok_or("TEST_REQUEST_FIELDS_INVALID")?;
    let required = ["schema","kind","requestId","requestedAt","environment",
        "subject","product","featureIds","termDays","seats","status"];
    if fields.len() != required.len() || required.iter().any(|key| !fields.contains_key(*key)) {
        return Err("TEST_REQUEST_FIELDS_INVALID".into());
    }
    if value["schema"] != "IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1"
        || value["kind"] != "TEST_LICENSE_REQUEST"
        || value["status"] != "UNSIGNED_REQUEST"
        || value["environment"] != "TEST" {
        return Err("TEST_REQUEST_NOT_UNSIGNED_TEST".into());
    }
    let request_id=value["requestId"].as_str().ok_or("TEST_REQUEST_ID_INVALID")?;
    if request_id.len() < 6 || request_id.len() > 129 ||
        !request_id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b)) {
        return Err("TEST_REQUEST_ID_INVALID".into());
    }
    let requested_at=value["requestedAt"].as_str().ok_or("TEST_REQUEST_TIME_INVALID")?;
    if requested_at.len() < 20 || requested_at.len() > 40 || !requested_at.ends_with('Z') {
        return Err("TEST_REQUEST_TIME_INVALID".into());
    }
    let subject=value["subject"].as_object().ok_or("TEST_REQUEST_SUBJECT_INVALID")?;
    if subject.len()!=3 || !["type","id","name"].iter().all(|key|subject.contains_key(*key))
        || value["subject"]["type"]!="ORGANIZATION"
        || value["subject"]["id"].as_str().is_none_or(str::is_empty)
        || value["subject"]["id"].as_str().is_some_and(|v|v.starts_with("holder:"))
        || value["subject"]["name"].as_str().is_none_or(str::is_empty) {
        return Err("TEST_REQUEST_SUBJECT_INVALID".into());
    }
    let product=value["product"].as_object().ok_or("TEST_REQUEST_PRODUCT_INVALID")?;
    if product.len()!=2 || !["id","version"].iter().all(|key|product.contains_key(*key))
        || value["product"]["id"]!="IWXA_ADMIN_CENTER"
        || value["product"]["version"].as_str().is_none_or(str::is_empty) {
        return Err("TEST_REQUEST_PRODUCT_INVALID".into());
    }
    let features=value["featureIds"].as_array().ok_or("TEST_REQUEST_FEATURES_INVALID")?;
    if features.is_empty() || features.len()>30 {return Err("TEST_REQUEST_FEATURES_INVALID".into());}
    let mut unique=std::collections::HashSet::new();
    for feature in features {
        let key=feature.as_str().ok_or("TEST_REQUEST_FEATURES_INVALID")?;
        if key.is_empty() || !unique.insert(key) {return Err("TEST_REQUEST_FEATURES_INVALID".into());}
    }
    let term=value["termDays"].as_u64().ok_or("TEST_REQUEST_TERM_INVALID")?;
    let seats=value["seats"].as_u64().ok_or("TEST_REQUEST_SEATS_INVALID")?;
    if !(1..=3650).contains(&term) {return Err("TEST_REQUEST_TERM_INVALID".into());}
    if !(1..=10000).contains(&seats) {return Err("TEST_REQUEST_SEATS_INVALID".into());}
    Ok(())
}

fn write_test_request_file(path: &Path, content: &str) -> Result<(), String> {
    validate_test_request(content)?;
    if path.exists() {return Err("TEST_REQUEST_DESTINATION_EXISTS".into());}
    let folder=path.parent().ok_or("TEST_REQUEST_DESTINATION_INVALID")?;
    if !folder.is_dir(){return Err("TEST_REQUEST_DESTINATION_INVALID".into());}
    let now=SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e|e.to_string())?.as_nanos();
    let tmp=folder.join(format!(".iwxa-test-request-{}-{now}.tmp",std::process::id()));
    let result=(|| -> Result<(),String>{
        let mut f=OpenOptions::new().write(true).create_new(true).open(&tmp)
            .map_err(|e|e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e|e.to_string())?;
        f.sync_all().map_err(|e|e.to_string())?;
        fs::rename(&tmp,path).map_err(|e|e.to_string())?;
        let copied=fs::read_to_string(path).map_err(|e|e.to_string())?;
        if copied!=content {return Err("TEST_REQUEST_READBACK_MISMATCH".into());}
        Ok(())
    })();
    if result.is_err(){let _=fs::remove_file(&tmp);}
    result
}

#[tauri::command]
fn publisher_save_test_request(content: String, suggested_file_name: String) -> Result<bool,String> {
    if !suggested_file_name.starts_with("iwxa-test-license-request-")
        || !suggested_file_name.ends_with(".json")
        || suggested_file_name.len()>110
        || suggested_file_name.bytes().any(|b| !b.is_ascii_alphanumeric() && b != b'-' && b != b'.') {
        return Err("TEST_REQUEST_FILENAME_INVALID".into());
    }
    validate_test_request(&content)?;
    let path=rfd::FileDialog::new().add_filter("JSON",&["json"])
        .set_file_name(&suggested_file_name).save_file();
    match path {
        Some(destination)=>write_test_request_file(&destination,&content).map(|_|true),
        None=>Ok(false)
    }
}

// Backup contains preparation drafts only. No issuer credentials, signed
// licenses, status receipts or release approvals are written by this API.
const BACKUP_NAME: &str = "iwxa-publisher-preparation-backup.json";

fn write_preparation_backup(path: &Path, content: &str) -> Result<(), String> {
    validate_preparation(content)?;
    if path.extension().and_then(|v| v.to_str()) != Some("json") {
        return Err("PUBLISHER_BACKUP_FILE_EXTENSION_INVALID".into());
    }
    if path.exists() { return Err("PUBLISHER_BACKUP_DESTINATION_EXISTS".into()); }
    let folder = path.parent().ok_or("PUBLISHER_BACKUP_DESTINATION_INVALID")?;
    if !folder.is_dir() { return Err("PUBLISHER_BACKUP_DESTINATION_INVALID".into()); }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let tmp = folder.join(format!(".publisher-backup-{}-{now}.tmp", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        let copied = fs::read_to_string(path).map_err(|e| e.to_string())?;
        if copied != content { return Err("PUBLISHER_BACKUP_READBACK_MISMATCH".into()); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&tmp); }
    result
}

fn read_preparation_backup(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_DRAFT_BYTES as u64 {
        return Err("PUBLISHER_BACKUP_SIZE_INVALID".into());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    validate_preparation(&text)?;
    Ok(text)
}

#[tauri::command]
fn publisher_export_preparation_backup(content: String) -> Result<bool, String> {
    validate_preparation(&content)?;
    let path = rfd::FileDialog::new()
        .add_filter("JSON", &["json"]).set_file_name(BACKUP_NAME).save_file();
    match path {
        Some(destination) => write_preparation_backup(&destination, &content).map(|_| true),
        None => Ok(false),
    }
}

#[tauri::command]
fn publisher_pick_preparation_backup() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new().add_filter("JSON", &["json"]).pick_file();
    match path {
        Some(source) => read_preparation_backup(&source).map(Some),
        None => Ok(None),
    }
}

#[path="../../../native/t3_product_component.rs"]
mod t3_product_component;
mod t3_owner;

fn main() {
    tauri::Builder::default()
        .manage(DraftLock(Mutex::new(())))
        .manage(DeliveryLock(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            publisher_draft_read, publisher_draft_save, publisher_inspect_artifact, publisher_save_test_request,
            publisher_export_preparation_backup, publisher_pick_preparation_backup,
            publisher_compare_offline_copies,
            publisher_select_test_iwxa, publisher_export_test_iwxa,
            t3_owner::publisher_t3_capabilities, t3_owner::publisher_t3_inventory,
            t3_owner::publisher_t3_issue, t3_owner::publisher_t3_change_status,
            t3_owner::publisher_t3_export
        ])
        .run(tauri::generate_context!())
        .expect("IWXA Publisher could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scratch() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("iwxa-publisher-test-{}-{nanos}", std::process::id()))
    }
    fn valid_preparation() -> String {
        r#"{"format":"iwxa.publisher.preparation","version":1,"products":[],"holders":[],"proposals":[],"artifacts":[],"updatedAt":"2026-11-08T00:00:00.000Z"}"#.to_string()
    }
    #[test]
    fn backup_roundtrip_is_exact_rejects_overwrite_and_never_changes_live_draft() {
        let root = scratch();
        fs::create_dir_all(&root).unwrap();
        let draft = valid_preparation();
        write_preparation(&root, &draft).unwrap();
        let backup = root.join("publisher-backup.json");
        write_preparation_backup(&backup, &draft).unwrap();
        assert_eq!(read_preparation_backup(&backup).unwrap(), draft);
        assert!(write_preparation_backup(&backup, &draft).is_err());
        let changed = draft.replace("\"products\":[]", "\"products\":[{\"id\":\"changed\"}]");
        write_preparation(&root, &changed).unwrap();
        assert_eq!(read_preparation(&root).unwrap().unwrap(), changed);
        write_preparation(&root, &read_preparation_backup(&backup).unwrap()).unwrap();
        assert_eq!(read_preparation(&root).unwrap().unwrap(), draft);
        let malformed = root.join("malformed.json");
        fs::write(&malformed, r#"{"format":"invalid"}"#).unwrap();
        assert!(read_preparation_backup(&malformed).is_err());
        assert_eq!(read_preparation(&root).unwrap().unwrap(), draft);
        assert!(write_preparation_backup(&root.join("unsupported.txt"), &draft).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn first_run_is_empty_and_preparation_survives_new_open() {
        let root = scratch();
        assert!(read_preparation(&root).unwrap().is_none());
        let draft = valid_preparation();
        write_preparation(&root, &draft).unwrap();
        assert_eq!(read_preparation(&root).unwrap().unwrap(), draft);
        let revised = draft.replace("\"products\":[]", "\"products\":[{\"id\":\"IWXA_TEST\"}]");
        write_preparation(&root, &revised).unwrap();
        assert_eq!(read_preparation(&root).unwrap().unwrap(), revised);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn invalid_draft_never_overwrites_previous_file() {
        let root = scratch();
        let draft = valid_preparation();
        write_preparation(&root, &draft).unwrap();
        assert!(write_preparation(&root, "{\"format\":\"invalid\"}").is_err());
        assert_eq!(read_preparation(&root).unwrap().unwrap(), draft);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn selected_binary_hashes_real_bytes() {
        let root = scratch();
        fs::create_dir_all(&root).unwrap();
        let path = root.join("setup.exe");
        fs::write(&path, b"publisher-test").unwrap();
        let inspection = inspect_artifact(&path).unwrap();
        assert_eq!(inspection.name, "setup.exe");
        assert_eq!(inspection.size, 14);
        assert_eq!(inspection.sha256, format!("{:x}", Sha256::digest(b"publisher-test")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn native_exports_exact_unsigned_test_request_with_readback_and_no_extra_authority() {
        let root=scratch();
        fs::create_dir_all(&root).unwrap();
        let path=root.join("iwxa-test-license-request-1.json");
        let request=serde_json::json!({
            "schema":"IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1",
            "kind":"TEST_LICENSE_REQUEST","requestId":"proposal:123",
            "requestedAt":"2026-11-08T00:00:00.000Z",
            "environment":"TEST",
            "subject":{"type":"ORGANIZATION","id":"11111111-1111-4111-8111-111111111111","name":"Demo"},
            "product":{"id":"IWXA_ADMIN_CENTER","version":"0.3.0"},
            "featureIds":["WORKSPACE"],"termDays":30,"seats":3,
            "status":"UNSIGNED_REQUEST"
        }).to_string();
        write_test_request_file(&path,&request).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(),request);
        assert!(write_test_request_file(&path,&request).is_err());
        let forged=request.replace("\"UNSIGNED_REQUEST\"","\"ISSUED\"");
        assert!(validate_test_request(&forged).is_err());
        let claimed=request.replace("\"status\":\"UNSIGNED_REQUEST\"",
           "\"status\":\"UNSIGNED_REQUEST\",\"licenseId\":\"forged\"");
        assert!(validate_test_request(&claimed).is_err());
        let _=fs::remove_dir_all(root);
    }


    #[test]
    fn offline_copies_are_read_separately_without_making_release_or_signature_claims() {
        let root = scratch();
        let folder_a = root.join("copy-a");
        let folder_b = root.join("copy-b");
        fs::create_dir_all(&folder_a).unwrap();
        fs::create_dir_all(&folder_b).unwrap();
        let a = folder_a.join("publisher-test.exe");
        let b = folder_b.join("publisher-test.exe");
        fs::write(&a, b"publisher-artifact-v1").unwrap();
        fs::write(&b, b"publisher-artifact-v1").unwrap();
        let matching = compare_offline_copies(&a, &b).unwrap();
        assert_eq!(matching.copies_checked, 2);
        assert!(matching.same_content);
        assert!(matching.distinct_selected_paths);
        assert!(!matching.physical_independence_verified);
        assert!(!matching.publisher_authorized);
        assert!(!matching.signed_release_metadata_verified);
        assert_eq!(matching.name, "publisher-test.exe");
        assert_eq!(matching.sha256,
                   format!("{:x}", Sha256::digest(b"publisher-artifact-v1")));
        assert_eq!(compare_offline_copies(&a, &a).err().unwrap(),
                   "OFFLINE_COPY_SAME_SELECTED_FILE");
        fs::write(&b, b"publisher-artifact-v2").unwrap();
        assert_eq!(compare_offline_copies(&a, &b).err().unwrap(),
                   "OFFLINE_COPY_SHA256_MISMATCH");
        fs::write(&b, b"not-same-size").unwrap();
        assert_eq!(compare_offline_copies(&a, &b).err().unwrap(),
                   "OFFLINE_COPY_SIZE_MISMATCH");
        fs::write(&b, b"publisher-artifact-v1").unwrap();
        let different_name = folder_b.join("renamed-file.exe");
        fs::rename(&b, &different_name).unwrap();
        assert_eq!(compare_offline_copies(&a, &different_name).err().unwrap(),
                   "OFFLINE_COPY_FILENAME_MISMATCH");
        fs::write(&b, b"").unwrap();
        assert_eq!(compare_offline_copies(&a, &b).err().unwrap(),
                   "ARTIFACT_SIZE_UNSUPPORTED");
        // Regression: two large sequential hashes on the same native Tauri
        // command stack. Both buffers must remain heap-backed and bounded.
        let large_bytes = vec![0x5a_u8; 3 * 1024 * 1024 + 19];
        fs::write(&a, &large_bytes).unwrap();
        fs::write(&b, &large_bytes).unwrap();
        let large = compare_offline_copies(&a, &b).unwrap();
        assert_eq!(large.size, large_bytes.len() as u64);
        assert_eq!(large.sha256, format!("{:x}", Sha256::digest(&large_bytes)));
        assert!(!large.publisher_authorized);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn native_preparation_does_not_create_any_license_authority() {
        let root = scratch();
        write_preparation(&root, &valid_preparation()).unwrap();
        let files: Vec<_> = fs::read_dir(&root).unwrap().map(|p|p.unwrap().file_name()).collect();
        assert_eq!(files.len(), 1);
        assert!(files[0].to_string_lossy().contains("preparation"));
        let _ = fs::remove_dir_all(root);
    }
}
