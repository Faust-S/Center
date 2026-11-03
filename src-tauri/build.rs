use std::{env, fs, path::PathBuf};
fn main() {
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
    tauri_build::build();
}
