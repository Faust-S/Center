#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Upstream native Atlas persistence implementation is compiled directly from
// the pinned Faust-S/Atlas checkout. This is ONE store implementation, not a fork.
include!(concat!(env!("OUT_DIR"), "/atlas_native.rs"));

// Setup Core owns the per-product location choice. Center reads this only
// from its own registered, installed executable; development builds and
// unrelated Windows accounts continue to use the canonical Tauri path.
// The public Atlas Desktop location is always resolved independently.
#[cfg(target_os = "windows")]
fn center_hkcu_location(name: &str) -> Result<Option<String>, String> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ,
    };
    let wide = |text: &str| {
        std::ffi::OsStr::new(text).encode_wide()
            .chain(std::iter::once(0_u16)).collect::<Vec<_>>()
    };
    let subkey = wide(r"Software\IWXA\SetupCore\Products\iwxa.admin-center");
    let field = wide(name);
    let mut len = 0_u32;
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, subkey.as_ptr(), field.as_ptr(),
            RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut len)
    };
    if status == 2 { return Ok(None); } // ERROR_FILE_NOT_FOUND
    if status != 0 && status != 234 { // ERROR_MORE_DATA
        return Err(format!("CENTER_SETUP_LOCATION_REGISTRY_{}", status));
    }
    if len < 2 || len > 8192 || len % 2 != 0 {
        return Err("CENTER_SETUP_LOCATION_LENGTH_INVALID".into());
    }
    let mut units = vec![0_u16; len as usize / 2];
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, subkey.as_ptr(), field.as_ptr(),
            RRF_RT_REG_SZ, std::ptr::null_mut(),
            units.as_mut_ptr().cast(), &mut len)
    };
    if status != 0 {
        return Err(format!("CENTER_SETUP_LOCATION_READ_{}", status));
    }
    let end = units.iter().position(|unit| *unit == 0)
        .unwrap_or(units.len());
    let name = std::ffi::OsString::from_wide(&units[..end]);
    Ok(Some(name.to_string_lossy().into_owned()))
}

fn center_owned_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let default = path_for(app)?;
    #[cfg(target_os = "windows")]
    {
        if let Some(location) = center_hkcu_location("DataLocation")? {
            let owned = center_hkcu_location("InstallLocation")?
                .ok_or("CENTER_SETUP_OWNER_LOCATION_MISSING")?;
            let current = std::env::current_exe()
                .map_err(|_| "CENTER_SETUP_CURRENT_EXE_UNAVAILABLE")?;
            let installed = PathBuf::from(owned);
            let running_parent = current.parent()
                .ok_or("CENTER_SETUP_CURRENT_ROOT_MISSING")?;
            // A checkout, preview or renamed EXE must not take over the
            // installed product's selected data store.
            let registered = installed.canonicalize()
                .map_err(|_| "CENTER_SETUP_OWNER_ROOT_UNAVAILABLE")?;
            let running = running_parent.canonicalize()
                .map_err(|_| "CENTER_SETUP_CURRENT_ROOT_UNAVAILABLE")?;
            if !registered.to_string_lossy().eq_ignore_ascii_case(
                &running.to_string_lossy()) {
                return Ok(default);
            }
            let selected = PathBuf::from(location);
            if !selected.is_absolute() || selected.parent().is_none() {
                return Err("CENTER_SETUP_DATA_ROOT_INVALID".into());
            }
            // The canonical Center native store has always lived below
            // <app_local_data_dir>/atlas-store-v1. Preserve that structure
            // when the user chooses a different app-data base folder.
            return Ok(selected.join("atlas-store-v1"));
        }
    }
    Ok(default)
}

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
    center_atlas_root_under(&center_owned_data_root(app)?, organization_id)
}

// Resolve only the fixed, same-user Atlas Desktop data root. The caller never
// supplies a path; this adapter cannot browse arbitrary filesystem content.
fn center_public_atlas_root_under(center_app_data: &Path) -> Result<PathBuf, String> {
    if center_app_data.file_name().and_then(|name| name.to_str())
        != Some("ru.iwxa.admin-center") {
        return Err("ATLAS_PUBLIC_APP_SCOPE_INVALID".into());
    }
    let parent = center_app_data.parent().ok_or("ATLAS_PUBLIC_BASE_NOT_FOUND")?;
    Ok(parent.join("ru.iwxa.atlas").join("atlas-store-v1"))
}
fn center_public_atlas_open_root(root: &Path) -> Result<OpenResult, String> {
    if !root.join("head.json").is_file() {
        return Err("ATLAS_PUBLIC_SOURCE_NOT_FOUND".into());
    }
    // Canonical Atlas shared-lock reader. This never creates directories,
    // lock files or project blocks in the Atlas Desktop owner store.
    let value = read_root_readonly(root)?;
    if value.needs_confirmation {
        return Err("ATLAS_PUBLIC_RECOVERY_REQUIRED".into());
    }
    Ok(value)
}
#[tauri::command]
fn center_atlas_public_open(app: AppHandle) -> Result<OpenResult, String> {
    let local = app.path().app_local_data_dir().map_err(|_| "ATLAS_PUBLIC_BASE_NOT_FOUND")?;
    center_public_atlas_open_root(&center_public_atlas_root_under(&local)?)
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
// Original T3 access-control/iwxa-package.mjs supports 32 MiB IWXA archives.
// File carriers stay opaque here; signatures are checked only by T3 receive().
const CENTER_IWXA_CARRIER_LIMIT: usize = 32 * 1024 * 1024;
fn center_draft_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(center_owned_data_root(app)?.join("preparation"))
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
fn center_draft_save_root(root: &Path, content: &str) -> Result<(), String> {
    center_draft_validate(content)?;
    let _guard = lock(root)?;
    publish(root, &root.join("draft.json"), content.as_bytes())
}
fn center_draft_read_root(root: &Path) -> Result<Option<String>, String> {
    let _guard = lock(root)?;
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
#[tauri::command]
fn center_draft_save_local(app: AppHandle, content: String) -> Result<bool, String> {
    center_draft_save_root(&center_draft_root(&app)?, &content)?;
    Ok(true)
}
#[tauri::command]
fn center_draft_read_local(app: AppHandle) -> Result<Option<String>, String> {
    center_draft_read_root(&center_draft_root(&app)?)
}

// The manual JSON file is a preparation-draft export, never a corporate
// backup. Reuse its existing validator and read back the exact selected file.
fn center_draft_export_file(path: &Path, content: &str) -> Result<(), String> {
    center_draft_validate(content)?;
    // Original Atlas atomic publication writes and synchronizes a temporary
    // file alongside the chosen destination before replacing an existing copy.
    let parent=path.parent().ok_or("Каталог для экспорта не найден")?;
    publish(parent, path, content.as_bytes())?;
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
    if bytes.is_empty() || bytes.len() > CENTER_IWXA_CARRIER_LIMIT {
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
    if size == 0 || size > CENTER_IWXA_CARRIER_LIMIT as u64 {
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
    let parent=path.parent().ok_or("Каталог для пакета IWXA не найден")?;
    publish(parent, path, bytes)?;
    if center_iwxa_carrier_read(path)?.as_slice() != bytes {
        return Err("Записанный пакет IWXA не совпадает с исходным".into());
    }
    Ok(())
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

mod cen05_host;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Mutex::new(cen05_host::Session::default()))
        .invoke_handler(tauri::generate_handler![
            save_draft_file, open_draft_file, center_save_iwxa_file, center_open_iwxa_file,
            center_draft_save_local, center_draft_read_local, center_atlas_open, center_atlas_commit, center_atlas_public_open,
            cen05_host::center_u04_open, cen05_host::center_u04_activate,
            cen05_host::center_u04_return, cen05_host::center_u04_detach
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
    fn center_reads_real_atlas_desktop_store_without_owning_a_second_copy() {
        let base = scratch();
        let center_dir = base.join("ru.iwxa.admin-center");
        let public_root = center_public_atlas_root_under(&center_dir).unwrap();
        assert_eq!(public_root, base.join("ru.iwxa.atlas").join("atlas-store-v1"));
        assert!(center_public_atlas_root_under(&base.join("wrong-application")).is_err());
        assert!(center_public_atlas_open_root(&public_root).is_err());
        assert!(!public_root.exists(), "read-only open must not create missing Atlas root");
        let project = serde_json::json!({
            "id":"atlas-project-1", "items":[{"id":"atlas-work-1","title":"Work"}],
            "dependencies":[]
        });
        let first = serde_json::json!({
            "schema":"atlas.project/1", "revision":1, "projects":[project]
        });
        let written = commit_root(&public_root, "none", first.clone()).unwrap();
        let observed = center_public_atlas_open_root(&public_root).unwrap();
        assert_eq!(observed.generation, written.generation);
        assert_eq!(observed.snapshot, first);
        let revised = serde_json::json!({
            "schema":"atlas.project/1", "revision":2,
            "projects":[{"id":"atlas-project-1","items":[
                {"id":"atlas-work-1","title":"Work"},
                {"id":"atlas-work-2","title":"Added"}],"dependencies":[]}]
        });
        let next = commit_root(&public_root, &written.generation, revised.clone()).unwrap();
        let readback = center_public_atlas_open_root(&public_root).unwrap();
        assert_eq!(readback.snapshot, revised);
        assert_eq!(readback.generation, next.generation);
        assert_eq!(readback.snapshot["projects"][0]["items"][0]["id"], "atlas-work-1");
        assert!(!center_dir.join("atlas-store-v1").exists(),
            "public Atlas read must never initialize a Center project store");
        fs::remove_dir_all(base).unwrap();
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
        over_limit.set_len((CENTER_IWXA_CARRIER_LIMIT + 1) as u64).unwrap();
        drop(over_limit);
        assert!(center_iwxa_carrier_read(&file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn native_signed_iwxa_export_is_opaque_and_bounded() {
        assert!(center_iwxa_carrier_validate(&[]).is_err());
        assert!(center_iwxa_carrier_validate(&vec![0_u8; CENTER_IWXA_CARRIER_LIMIT + 1]).is_err());
        center_iwxa_carrier_validate(&vec![0_u8; CENTER_DRAFT_LIMIT + 1])
            .expect("a 9 MiB original T3 carrier must not be rejected as a draft");
        let bytes: Vec<u8> = vec![0, 0xff, 0x41, 0, 0x42];
        center_iwxa_carrier_validate(&bytes).expect("opaque carrier accepted for file save");
        let dir = scratch();
        let path = dir.join("roundtrip.iwxa");
        center_iwxa_carrier_write(&path, &bytes).expect("write and verify opaque bytes");
        assert_eq!(center_iwxa_carrier_read(&path).unwrap(), bytes);
        assert!(center_iwxa_carrier_write(&path, &[]).is_err());
        assert_eq!(center_iwxa_carrier_read(&path).unwrap(), bytes);
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
    fn manual_exports_preserve_existing_data_on_invalid_input_or_destination() {
        let dir=scratch();
        let json=dir.join("existing-draft.json");
        let original=serde_json::json!({
            "format":"iwxa.admin-center.draft","version":1,
            "organizations":[],"activeOrganizationId":null,
            "updatedAt":"2026-11-06T00:00:00.000Z"
        }).to_string();
        center_draft_export_file(&json,&original).unwrap();
        assert_eq!(center_draft_import_file(&json).unwrap(),original);
        assert!(center_draft_export_file(&json,"{bad").is_err());
        assert_eq!(center_draft_import_file(&json).unwrap(),original);
        let carrier=dir.join("existing-result.iwxa");
        let previous=b"previous opaque payload".to_vec();
        center_iwxa_carrier_write(&carrier,&previous).unwrap();
        assert!(center_iwxa_carrier_write(&carrier,&[]).is_err());
        assert_eq!(center_iwxa_carrier_read(&carrier).unwrap(),previous);
        // An existing directory cannot be replaced by a file; publication
        // failure must leave the directory in place, not create a partial file.
        let folder=dir.join("already-a-folder");
        fs::create_dir_all(&folder).unwrap();
        assert!(center_draft_export_file(&folder,&original).is_err());
        assert!(folder.is_dir());
        assert!(center_iwxa_carrier_write(&folder,&previous).is_err());
        assert!(folder.is_dir());
        let updated=b"new verified opaque package".to_vec();
        center_iwxa_carrier_write(&carrier,&updated).unwrap();
        assert_eq!(center_iwxa_carrier_read(&carrier).unwrap(),updated);
        fs::remove_dir_all(dir).unwrap();
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
        assert!(center_draft_read_root(&path).unwrap().is_none());
        center_draft_save_root(&path, &valid).unwrap();
        let reopened = center_draft_read_root(&path).unwrap().unwrap();
        assert_eq!(reopened, valid);
        assert!(center_draft_save_root(&path, "{\"format\":\"fake\"}").is_err());
        assert_eq!(center_draft_read_root(&path).unwrap().unwrap(), valid);
        assert!(center_draft_save_root(&path, &"x".repeat(CENTER_DRAFT_LIMIT + 1)).is_err());
        assert_eq!(center_draft_read_root(&path).unwrap().unwrap(), valid);
        let _ = fs::remove_dir_all(base);
    }

}
