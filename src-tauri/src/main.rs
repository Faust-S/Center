#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Upstream native Atlas persistence implementation is compiled directly from
// the pinned Faust-S/Atlas checkout. This is ONE store implementation, not a fork.
include!(concat!(env!("OUT_DIR"), "/atlas_native.rs"));

// The current Center organisation ID is a local scope selector, not proof of
// organisational access. T3 host admission must gate production activation.
fn center_atlas_root_under(base: &Path, organization_id: &str) -> Result<PathBuf, String> {
    if organization_id.is_empty() || organization_id.len() > 100
        || !organization_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Недопустимый идентификатор организации".into());
    }
    Ok(base.join("organizations").join(organization_id))
}
fn center_atlas_root(app: &AppHandle, organization_id: &str) -> Result<PathBuf, String> {
    center_atlas_root_under(&path_for(app)?, organization_id)
}

fn center_atlas_open_root(root: &Path) -> Result<OpenResult, String> {
    // Opening an as-yet empty organization must create its Atlas root first,
    // just as the original Atlas application does before its first read.
    let _guard = lock(root)?;
    load_root(root)
}

#[tauri::command]
fn center_atlas_open(app: AppHandle, organization_id: String) -> Result<OpenResult, String> {
    center_atlas_open_root(&center_atlas_root(&app, &organization_id)?)
}

#[tauri::command]
fn center_atlas_commit(
    app: AppHandle, organization_id: String, expected_generation: String, snapshot: Value,
) -> Result<WriteResult, String> {
    // Native CAS, immutable project blocks, history, and integrity checks are
    // performed by the original Atlas commit_root implementation.
    commit_root(&center_atlas_root(&app, &organization_id)?, &expected_generation, snapshot)
}

// Preparation drafts are explicitly NOT organizational records, grants,
// credentials or a backup. Existing Atlas atomic file publication is reused;
// authoritative organization state will be migrated only through T3 Store.
const CENTER_DRAFT_LIMIT: usize = 8 * 1024 * 1024;
fn center_draft_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(path_for(app)?.join("preparation"))
}
fn center_draft_validate(content: &str) -> Result<(), String> {
    if content.len() > CENTER_DRAFT_LIMIT {
        return Err("Черновик превышает допустимый размер".into());
    }
    let parsed: Value = serde_json::from_str(content)
        .map_err(|_| "Файл черновика повреждён".to_string())?;
    if parsed.get("format").and_then(Value::as_str) != Some("iwxa.admin-center.draft")
        || parsed.get("version").and_then(Value::as_u64) != Some(1)
        || !parsed.get("organizations").is_some_and(Value::is_array) {
        return Err("Это не файл черновиков Admin Center".into());
    }
    Ok(())
}
// Reuse the original Atlas native file lock + atomic publisher. Generation
// guards protect local preparation drafts against a stale second Center window.
// This is neither a second Project Store nor T3 organizational authority.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CenterDraftReadback {
    content: Option<String>,
    generation: String,
}
fn center_draft_generation(content: Option<&str>) -> String {
    match content {
        None => "none".to_string(),
        Some(value) => format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(value.as_bytes())),
    }
}
fn center_draft_read_unlocked(root: &Path) -> Result<Option<String>, String> {
    let path = root.join("draft.json");
    if !path.exists() { return Ok(None); }
    let bytes = read_limited(&path)?;
    if bytes.len() > CENTER_DRAFT_LIMIT {
        return Err("Сохранённый черновик превышает допустимый размер".into());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "Сохранённый черновик повреждён".to_string())?;
    center_draft_validate(&content)?;
    Ok(Some(content))
}
fn center_draft_state_unlocked(root: &Path) -> Result<CenterDraftReadback, String> {
    let content = center_draft_read_unlocked(root)?;
    let generation = center_draft_generation(content.as_deref());
    Ok(CenterDraftReadback {content, generation})
}
fn center_draft_state_root(root: &Path) -> Result<CenterDraftReadback, String> {
    let _guard = lock(root)?;
    center_draft_state_unlocked(root)
}
fn center_draft_save_root(
    root: &Path, content: &str, expected_generation: &str,
) -> Result<CenterDraftReadback, String> {
    center_draft_validate(content)?;
    let _guard = lock(root)?;
    let previous = center_draft_state_unlocked(root)?;
    if previous.generation != expected_generation {
        return Err("CEN_DRAFT_CONCURRENT_UPDATE".into());
    }
    if previous.content.as_deref() != Some(content) {
        publish(root, &root.join("draft.json"), content.as_bytes())?;
    }
    // Read the saved bytes under the SAME lock; a claimed write must be
    // the exact persisted UTF-8 content, never merely a successful rename.
    let stored = center_draft_state_unlocked(root)?;
    if stored.content.as_deref() != Some(content) {
        return Err("CEN_DRAFT_POSTCOMMIT_READBACK_HOLD".into());
    }
    Ok(stored)
}
fn center_draft_read_root(root: &Path) -> Result<Option<String>, String> {
    Ok(center_draft_state_root(root)?.content)
}
#[tauri::command]
fn center_draft_save_local(
    app: AppHandle, content: String, expected_generation: String,
) -> Result<CenterDraftReadback, String> {
    center_draft_save_root(&center_draft_root(&app)?, &content, &expected_generation)
}
#[tauri::command]
fn center_draft_read_state_local(app: AppHandle) -> Result<CenterDraftReadback, String> {
    center_draft_state_root(&center_draft_root(&app)?)
}
#[tauri::command]
fn center_draft_read_local(app: AppHandle) -> Result<Option<String>, String> {
    center_draft_read_root(&center_draft_root(&app)?)
}

// The manual JSON file is a preparation-draft export, never a corporate
// backup. Reuse its existing validator and read back the exact selected file.
fn center_draft_export_file(path: &Path, content: &str) -> Result<(), String> {
    center_draft_validate(content)?;
    std::fs::write(path, content.as_bytes()).map_err(|e| e.to_string())?;
    let exported = center_draft_import_file(path)?;
    if exported != content {
        return Err("Экспортированный черновик отличается от исходного".into());
    }
    Ok(())
}
fn center_draft_import_file(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size == 0 || size > CENTER_DRAFT_LIMIT as u64 {
        return Err("Файл черновиков превышает допустимый размер или пуст".into());
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    center_draft_validate(&content)?;
    Ok(content)
}
#[tauri::command]
fn save_draft_file(content: String) -> Result<bool, String> {
    center_draft_validate(&content)?;
    let path = rfd::FileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name("admin-center-draft.json")
        .save_file();
    match path {
        Some(path) => center_draft_export_file(&path, &content).map(|_| true),
        None => Ok(false),
    }
}
#[tauri::command]
fn open_draft_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new().add_filter("JSON", &["json"]).pick_file();
    match path {
        Some(path) => center_draft_import_file(&path).map(Some),
        None => Ok(None),
    }
}

// Only a native file chooser / byte-for-byte transfer for an already issued
// T3 carrier. No signing, trusted-key inspection, permission or issuance.
// Those remain exclusively with the original interop/runtime.mjs:taskBytes().
fn center_iwxa_carrier_validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > CENTER_DRAFT_LIMIT {
        return Err("Неподдерживаемый размер подписанного пакета IWXA".into());
    }
    Ok(())
}
// Keep the complete signed Task revision in the proposed filename to avoid
// confusing older and newer exported carriers. This is not verification.
fn center_iwxa_carrier_file_name(task_revision_id: &str) -> Result<String, String> {
    if task_revision_id.len() != 64 || !task_revision_id.bytes().all(|b|
        b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("Недопустимая редакция подписанного поручения".into());
    }
    Ok(format!("task-{task_revision_id}.iwxa"))
}
// Select a received .iwxa carrier without parsing or trusting it.
 // This bound is the same as CEN03's existing receive() transport limit;
 // signature, recipient, causal and revision checks belong to T3 only.
fn center_iwxa_carrier_read(path: &Path) -> Result<Vec<u8>, String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size == 0 || size > CENTER_DRAFT_LIMIT as u64 {
        return Err("Неподдерживаемый размер пакета IWXA".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    center_iwxa_carrier_validate(&bytes)?;
    Ok(bytes)
}
// A successful export requires readback of those same opaque carrier bytes.
// Signature, recipient and authorization validation remain with original T3.
fn center_iwxa_carrier_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    center_iwxa_carrier_validate(bytes)?;
    if !path.extension().and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iwxa")) {
        return Err("Выберите файл с расширением .iwxa".into());
    }

    // An offline recipient may already have the file for this exact Task
    // revision. Identical re-export is a no-op; a different payload must
    // never silently replace a package previously copied to USB.
    if path.exists() {
        return match center_iwxa_carrier_read(path) {
            Ok(existing) if existing == bytes => Ok(()),
            _ => Err("Выбранный файл .iwxa уже существует и отличается от пакета".into()),
        };
    }

    // FileDialog is a filename picker, not an exclusive write primitive.
    // Create the selected file only when absent to avoid a race replacing
    // another revision. This works on removable FAT/exFAT media as well.
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true).create_new(true).open(path)
        .map_err(|e| format!("Не удалось создать новый пакет .iwxa: {e}"))?;
    let verified = (|| -> Result<(), String> {
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if center_iwxa_carrier_read(path)?.as_slice() != bytes {
            return Err("Записанный пакет IWXA не совпадает с исходным".into());
        }
        Ok(())
    })();
    // Only a file created by this invocation can be removed on failure.
    // An earlier user file is never truncated or deleted.
    if verified.is_err() {
        let _ = std::fs::remove_file(path);
    }
    verified
}
#[tauri::command]
fn center_open_iwxa_file() -> Result<Option<Vec<u8>>, String> {
    let path = rfd::FileDialog::new()
        .add_filter("IWXA", &["iwxa"])
        .pick_file();
    match path {
        Some(path) => center_iwxa_carrier_read(&path).map(Some),
        None => Ok(None),
    }
}
#[tauri::command]
fn center_save_iwxa_file(bytes: Vec<u8>, task_revision_id: String) -> Result<bool, String> {
    center_iwxa_carrier_validate(&bytes)?;
    let file_name = center_iwxa_carrier_file_name(&task_revision_id)?;
    let path = rfd::FileDialog::new()
        .add_filter("IWXA", &["iwxa"])
        .set_file_name(&file_name)
        .save_file();
    match path {
        Some(path) => center_iwxa_carrier_write(&path, &bytes).map(|_| true),
        None => Ok(false),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_draft_file, open_draft_file, center_save_iwxa_file, center_open_iwxa_file,
            center_draft_save_local, center_draft_read_local, center_draft_read_state_local,
            center_atlas_open, center_atlas_commit
        ])
        .run(tauri::generate_context!())
        .expect("Admin Center could not start");
}

#[cfg(test)]
mod center_atlas_integration_tests {
    use super::*;
    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!("center-atlas-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create test dir");
        path
    }
    #[test]
    fn native_atlas_scopes_are_separate_and_path_components_are_restricted() {
        let base = scratch();
        let a = center_atlas_root_under(&base, "org-a").unwrap();
        let b = center_atlas_root_under(&base, "org-b").unwrap();
        assert_ne!(a, b);
        for bad in ["", ".", "..", "../private", "other/org", "org\\\\secret", "a.b"] {
            assert!(center_atlas_root_under(&base, bad).is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(base);
    }
    #[test]
    fn real_atlas_native_commit_restart_and_cross_org_isolation() {
        let base = scratch();
        let first = center_atlas_root_under(&base, "org-a").unwrap();
        let second = center_atlas_root_under(&base, "org-b").unwrap();
        let snapshot = serde_json::json!({"schema":"atlas.project/1","revision":1,"projects":[]});
        let outcome = commit_root(&first, "none", snapshot.clone()).unwrap();
        assert_eq!(outcome.revision, 1);
        let read = center_atlas_open_root(&first).unwrap();
        assert_eq!(read.generation, outcome.generation);
        assert_eq!(read.snapshot, snapshot);
        assert_eq!(center_atlas_open_root(&second).unwrap().generation, "none");
        assert!(commit_root(&first, "none", snapshot).is_err());
        let _ = fs::remove_dir_all(base);
    }
 
    #[test]
    fn native_atlas_reopens_in_a_second_windows_process() {
        // This is an actual process boundary, not a second call to load_root
        // in the same process. The second execution uses the same filesystem.
        let base = scratch();
        let executable = std::env::current_exe().expect("current test executable");
        for phase in ["write", "read"] {
            let output = std::process::Command::new(&executable)
                .args(["--exact", "center_atlas_integration_tests::native_atlas_child_phase", "--nocapture"])
                .env("IWXA_CENTER_ATLAS_RELAUNCH_ROOT", &base)
                .env("IWXA_CENTER_ATLAS_RELAUNCH_PHASE", phase)
                .output()
                .expect("launch independent native Atlas phase");
            assert!(output.status.success(),
                "Native Atlas {phase} failed:\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr));
        }
        assert!(base.join("generation.txt").exists());
        fs::remove_dir_all(base).expect("clean scratch root");
    }
    #[test]
    fn native_atlas_child_phase() {
        let root = match std::env::var_os("IWXA_CENTER_ATLAS_RELAUNCH_ROOT") {
            Some(path) => PathBuf::from(path),
            None => return,
        };
        let org_a = center_atlas_root_under(&root, "org-a").expect("org A");
        let org_b = center_atlas_root_under(&root, "org-b").expect("org B");
        match std::env::var("IWXA_CENTER_ATLAS_RELAUNCH_PHASE").as_deref() {
            Ok("write") => {
                let snapshot = serde_json::json!({
                    "schema":"atlas.project/1","revision":1,"projects":[]
                });
                let receipt = commit_root(&org_a, "none", snapshot).expect("first process write");
                fs::write(root.join("generation.txt"), receipt.generation)
                    .expect("write verified receipt");
                assert_eq!(center_atlas_open_root(&org_b).unwrap().generation, "none");
            }
            Ok("read") => {
                let original = fs::read_to_string(root.join("generation.txt"))
                    .expect("first process generation");
                let readback = center_atlas_open_root(&org_a).expect("second process readback");
                assert_eq!(readback.generation, original);
                assert_eq!(readback.snapshot["schema"], "atlas.project/1");
                assert_eq!(readback.snapshot["revision"], 1);
                assert_eq!(center_atlas_open_root(&org_b).unwrap().generation, "none");
                assert!(commit_root(&org_a, "none", readback.snapshot).is_err(),
                    "stale write cannot replace readback");
            }
            other => panic!("Unknown qualification phase: {other:?}"),
        }
    }

    #[test]
    fn native_received_iwxa_uses_same_opaque_transport_and_size_limit() {
        let dir = scratch();
        let file = dir.join("employee-result.iwxa");
        let original: Vec<u8> = vec![0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x78, 0x01];
        fs::write(&file, &original).unwrap();
        assert_eq!(center_iwxa_carrier_read(&file).unwrap(), original);
        fs::write(&file, []).unwrap();
        assert!(center_iwxa_carrier_read(&file).is_err());
        let over_limit = std::fs::File::create(&file).unwrap();
        over_limit.set_len((CENTER_DRAFT_LIMIT + 1) as u64).unwrap();
        drop(over_limit);
        assert!(center_iwxa_carrier_read(&file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_signed_iwxa_export_is_opaque_and_bounded() {
        assert!(center_iwxa_carrier_validate(&[]).is_err());
        assert!(center_iwxa_carrier_validate(&vec![0_u8; CENTER_DRAFT_LIMIT + 1]).is_err());
        let bytes: Vec<u8> = vec![0, 0xff, 0x41, 0, 0x42];
        center_iwxa_carrier_validate(&bytes).expect("opaque carrier accepted for file save");
        let dir = scratch();
        let path = dir.join("roundtrip.iwxa");
        center_iwxa_carrier_write(&path, &bytes).expect("write and verify opaque bytes");
        assert_eq!(center_iwxa_carrier_read(&path).unwrap(), bytes);
        // Re-exporting the same signed carrier must be idempotent.
        center_iwxa_carrier_write(&path, &bytes).expect("identical re-export is safe");
        // But a changed carrier for the same path must not overwrite it.
        assert!(center_iwxa_carrier_write(&path, &[0x50, 0x4b, 0xaa]).is_err());
        assert!(center_iwxa_carrier_write(&path, &[]).is_err());
        assert_eq!(center_iwxa_carrier_read(&path).unwrap(), bytes);
        assert!(center_iwxa_carrier_write(&dir.join("wrong.txt"), &bytes).is_err());
        assert!(!dir.join("wrong.txt").exists());
        std::fs::remove_dir_all(dir).expect("clean scratch");
    }
    #[test]
    fn named_signed_carrier_export_uses_exact_revision_and_rejects_bad_destination() {
        let revision = "a".repeat(64);
        let file_name = center_iwxa_carrier_file_name(&revision).unwrap();
        assert_eq!(file_name, format!("task-{revision}.iwxa"));
        for invalid in ["", "0", "../outside", "AAAAAAAA", "g"] {
            assert!(center_iwxa_carrier_file_name(invalid).is_err());
        }
        assert!(center_iwxa_carrier_file_name(&"A".repeat(64)).is_err());
        let dir = scratch();
        let bytes = [0x50, 0x4b, 0, 0xff, 0x01];
        assert!(center_iwxa_carrier_write(&dir, &bytes).is_err());
        let path = dir.join(file_name);
        center_iwxa_carrier_write(&path, &bytes).unwrap();
        assert_eq!(center_iwxa_carrier_read(&path).unwrap(), bytes);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_manual_draft_export_import_is_bounded_and_roundtrips_exactly() {
        let root = scratch();
        let exported = root.join("manager-export.json");
        let content = serde_json::json!({
            "format":"iwxa.admin-center.draft","version":1,
            "organizations":[{"id":"test-org","name":"Manager test","workspaces":[],
              "participants":[],"assignments":[]}],
            "activeOrganizationId":"test-org",
            "updatedAt":"2026-11-05T00:00:00.000Z"
        }).to_string();
        center_draft_export_file(&exported, &content).unwrap();
        assert_eq!(center_draft_import_file(&exported).unwrap(), content);
        assert!(center_draft_export_file(&exported, "{invalid").is_err());
        assert_eq!(center_draft_import_file(&exported).unwrap(), content,
            "invalid export must not overwrite previously exported work");
        fs::write(&exported, "{}").unwrap();
        assert!(center_draft_import_file(&exported).is_err());
        fs::write(&exported, []).unwrap();
        assert!(center_draft_import_file(&exported).is_err());
        let large = fs::File::create(&exported).unwrap();
        large.set_len((CENTER_DRAFT_LIMIT + 1) as u64).unwrap();
        drop(large);
        assert!(center_draft_import_file(&exported).is_err());
        assert!(center_draft_export_file(&root, &content).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preparation_draft_rejects_stale_write_from_another_process() {
        // Two independent invocations share the same preparation/draft.json.
        // A second window that read an old generation must not silently
        // overwrite newly saved assignment/issuedTaskLinks metadata.
        let base = scratch();
        let root = base.join("preparation");
        let initial = serde_json::json!({
            "format":"iwxa.admin-center.draft","version":1,
            "organizations":[], "activeOrganizationId":null,
            "updatedAt":"2026-11-06T00:00:00.000Z"
        }).to_string();
        let old = center_draft_save_root(&root, &initial, "none").unwrap();
        let executable = std::env::current_exe().expect("test executable");
        let output = std::process::Command::new(&executable)
            .args(["--exact",
                "center_atlas_integration_tests::preparation_draft_child_commit", "--nocapture"])
            .env("IWXA_CENTER_PREPARATION_CHILD_ROOT", &root)
            .output()
            .expect("start second preparation process");
        assert!(output.status.success(), "second process failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr));
        let latest = center_draft_state_root(&root).unwrap();
        assert_ne!(latest.generation, old.generation);
        assert!(latest.content.as_deref().unwrap().contains("issuedTaskLinks"));
        let attempted = center_draft_save_root(&root, &initial, &old.generation);
        assert_eq!(attempted.err().unwrap(), "CEN_DRAFT_CONCURRENT_UPDATE");
        assert_eq!(center_draft_state_root(&root).unwrap().generation, latest.generation);
        // Even a repeated write of the original bytes is a stale-window
        // conflict when a different process has advanced the generation.
        let repeated = center_draft_save_root(&root, &initial, &old.generation);
        assert_eq!(repeated.err().unwrap(), "CEN_DRAFT_CONCURRENT_UPDATE");
        // But the newest generation may save the same exact bytes idempotently.
        let confirmed = center_draft_save_root(
            &root, latest.content.as_ref().unwrap(), &latest.generation
        ).unwrap();
        assert_eq!(confirmed.generation, latest.generation);
        assert_eq!(confirmed.content, latest.content);
        let _ = fs::remove_dir_all(base);
    }
    #[test]
    fn preparation_draft_child_commit() {
        let Some(root) = std::env::var_os("IWXA_CENTER_PREPARATION_CHILD_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let before = center_draft_state_root(&root).expect("second process read");
        let changed = serde_json::json!({
            "format":"iwxa.admin-center.draft","version":1,
            "organizations":[{"id":"synthetic-org","issuedTaskLinks":[]}],
            "activeOrganizationId":"synthetic-org",
            "updatedAt":"2026-11-06T00:01:00.000Z"
        }).to_string();
        let committed = center_draft_save_root(&root, &changed, &before.generation)
            .expect("second process atomic publish");
        assert_eq!(committed.content.as_deref(), Some(changed.as_str()));
    }
    #[test]
    fn preparation_draft_survives_reopen_without_pretending_to_be_t3_grant() {
        let base = scratch();
        let path = base.join("preparation");
        let valid = serde_json::json!({
            "format": "iwxa.admin-center.draft", "version": 1,
            "organizations": [], "activeOrganizationId": null,
            "updatedAt": "2026-11-04T00:00:00.000Z"
        }).to_string();
        let empty = center_draft_state_root(&path).unwrap();
        assert!(empty.content.is_none());
        assert_eq!(empty.generation, "none");
        let first = center_draft_save_root(&path, &valid, &empty.generation).unwrap();
        assert_eq!(first.content.as_deref(), Some(valid.as_str()));
        assert_eq!(first.generation.len(), 64);
        assert_eq!(center_draft_read_root(&path).unwrap().unwrap(), valid);
        // Saving the identical bytes with a matching generation is idempotent.
        assert_eq!(center_draft_save_root(&path, &valid, &first.generation).unwrap().generation,
            first.generation);
        assert!(center_draft_save_root(&path, "{\"format\":\"fake\"}", &first.generation).is_err());
        assert_eq!(center_draft_read_root(&path).unwrap().unwrap(), valid);
        assert!(center_draft_save_root(&path, &"x".repeat(CENTER_DRAFT_LIMIT + 1),
            &first.generation).is_err());
        assert_eq!(center_draft_read_root(&path).unwrap().unwrap(), valid);
        let _ = fs::remove_dir_all(base);
    }

}
