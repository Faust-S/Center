use std::{env, fs, path::PathBuf};
fn main() {
    // Private release is pinned to the same original T3 owner EXE that the
    // standard IWXA Setup Core distributes with the Center native binary.
    println!("cargo:rerun-if-env-changed=IWXA_T3_ADMIN_D3_OWNER_SHA256");
    println!("cargo:rerun-if-env-changed=IWXA_T3_AGE_DESKTOP_OWNER_SHA256");
    println!("cargo:rerun-if-env-changed=IWXA_T3_CONSUMER_SHA256");
    // Keep native Atlas persistence code owned by the pinned Atlas repository.
    // Only inner rustdoc comments are removed for inclusion at the crate root;
    // no Atlas implementation code is rewritten or copied to this repository.
    let source = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo directory"))
        .join("../vendor/atlas/desktop/src-tauri/src/lib.rs");
    println!("cargo:rerun-if-changed={}", source.display());
    let original = fs::read_to_string(&source)
        .expect("Atlas native source is required: checkout pinned Faust-S/Atlas");
    let source_without_inner_docs = original
        .lines()
        .filter(|line| !line.trim_start().starts_with("//!"))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").expect("output directory")).join("atlas_native.rs"),
        source_without_inner_docs,
    ).expect("prepare canonical Atlas native module");
    // Use the original public U04 GUI presentation implementation. U01's
    // CLI version protocol is not applicable to Atlas Desktop.
    let upstream = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo directory"))
        .join("../vendor/brtest/u04-presentation/native/windows_port.rs");
    println!("cargo:rerun-if-changed={}", upstream.display());
    let original = fs::read_to_string(&upstream)
        .expect("Pinned public Br-test U04 source is required");
    let assembled = original.lines()
        .filter(|line| !line.trim_start().starts_with("//!"))
        .collect::<Vec<_>>().join("\n");
    fs::write(
        PathBuf::from(env::var("OUT_DIR").expect("output directory")).join("u04_original_windows.rs"),
        assembled,
    ).expect("prepare original public U04 native module");
    tauri_build::build();
}
