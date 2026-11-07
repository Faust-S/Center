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
    // U04 and U01 remain owned by the exact pinned public Br-test checkout.
    // Assemble their original native implementations at build time rather than
    // copying or independently reimplementing either component in Center.
    for (relative, output) in [
        ("u04-presentation/native/windows_port.rs", "u04_original_windows.rs"),
        ("universal-install/host-bindings/rust-port/src/lib.rs", "u01_original_program.rs"),
    ] {
        let upstream = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo directory"))
            .join("../vendor/brtest").join(relative);
        println!("cargo:rerun-if-changed={}", upstream.display());
        let original = fs::read_to_string(&upstream)
            .expect("Pinned public Br-test U01/U04 source is required");
        // Inner crate docs cannot be included as nested modules.
        // U01 is included as a production dependency, not a test crate:
        // keep its source verbatim apart from crate-level docs and the
        // upstream-only test module. Upstream's CLI stress/timeout checks
        // belong to the pinned owner qualification, not Center's host tests.
        // Center exercises only the U01 inspect port through its own tests.
        let original = if output == "u01_original_program.rs" {
            let lines: Vec<&str> = original.lines().collect();
            let start = lines.windows(2)
                .position(|pair| pair[0].trim() == "#[cfg(test)]"
                    && pair[1].trim() == "mod tests {")
                .expect("Pinned U01 source must end in its owner-only tests");
            lines[..start].join("\n")
        } else {
            original
        };
        let assembled = original.lines()
            .filter(|line| !line.trim_start().starts_with("//!"))
            .collect::<Vec<_>>().join("\n");
        fs::write(
            PathBuf::from(env::var("OUT_DIR").expect("output directory")).join(output),
            assembled,
        ).expect("prepare original public U01/U04 native module");
    }
    tauri_build::build();
}
