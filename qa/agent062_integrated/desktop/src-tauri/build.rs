fn main(){
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "recover_desktop_session",
                "u04_find_existing_window",
                "u04_verify_existing_process",
                "u04_observe_existing_window",
                "u04_focus_existing_window",
                "open_google_oauth_browser",
            ])
        )
    ).expect("tauri build failed");
}
