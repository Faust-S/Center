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

#[tauri::command]
fn center_atlas_open(app: AppHandle, organization_id: String) -> Result<OpenResult, String> {
    let root = center_atlas_root(&app, &organization_id)?;
    let _guard = lock(&root)?;
    load_root(&root)
}

#[tauri::command]
fn center_atlas_commit(
    app: AppHandle, organization_id: String, expected_generation: String, snapshot: Value,
) -> Result<WriteResult, String> {
    // Native CAS, immutable project blocks, history, and integrity checks are
    // performed by the original Atlas commit_root implementation.
    commit_root(&center_atlas_root(&app, &organization_id)?, &expected_generation, snapshot)
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
            save_draft_file, open_draft_file, center_atlas_open, center_atlas_commit
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
        let read = load_root(&first).unwrap();
        assert_eq!(read.generation, outcome.generation);
        assert_eq!(read.snapshot, snapshot);
        assert_eq!(load_root(&second).unwrap().generation, "none");
        assert!(commit_root(&first, "none", snapshot).is_err());
        let _ = fs::remove_dir_all(base);
    }
}
