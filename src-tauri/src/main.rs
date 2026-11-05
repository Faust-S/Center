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
    // Reuse canonical Atlas locking, manifest, block checks and recovery flags.
    // Never call commit_root or create a second portfolio for the public source.
    let _guard = lock(root)?;
    let value = load_root(root)?;
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

// Legacy draft-file operations remain separate from Atlas native persistence.
// A draft is never automatically promoted to a corporate signed operation.
#[tauri::command]
fn save_draft_file(content: String) -> Result<bool, String> {
    let path = rfd::FileDialog::new()
        .add_filter("JSON", &["json"])
        .set_file_name("admin-center-draft.json")
        .save_file();
    match path {
        Some(path) => std::fs::write(path, content.as_bytes())
            .map(|_| true).map_err(|e| e.to_string()),
        None => Ok(false),
    }
}
#[tauri::command]
fn open_draft_file() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new().add_filter("JSON", &["json"]).pick_file();
    match path {
        Some(path) => std::fs::read_to_string(path).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_draft_file, open_draft_file, center_draft_save_local, center_draft_read_local, center_atlas_open, center_atlas_commit, center_atlas_public_open
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
