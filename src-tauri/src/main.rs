#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// User-selected draft files only; authoritative T3 persistence is a separate port.
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
        .invoke_handler(tauri::generate_handler![save_draft_file, open_draft_file])
        .run(tauri::generate_context!())
        .expect("Admin Center could not start");
}
