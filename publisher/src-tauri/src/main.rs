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
    let mut buffer = [0_u8; 1024 * 1024];
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
fn main() {
    tauri::Builder::default()
        .manage(DraftLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![
            publisher_draft_read, publisher_draft_save, publisher_inspect_artifact
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
    fn native_preparation_does_not_create_any_license_authority() {
        let root = scratch();
        write_preparation(&root, &valid_preparation()).unwrap();
        let files: Vec<_> = fs::read_dir(&root).unwrap().map(|p|p.unwrap().file_name()).collect();
        assert_eq!(files.len(), 1);
        assert!(files[0].to_string_lossy().contains("preparation"));
        let _ = fs::remove_dir_all(root);
    }
}
