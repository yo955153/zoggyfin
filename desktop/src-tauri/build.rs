fn main() {
    // libmpv: Homebrew for development (see desktop/README.md). MPV_LIB_DIR overrides it.
    let dir = std::env::var("MPV_LIB_DIR").unwrap_or_else(|_| "/opt/homebrew/lib".into());
    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");
    println!("cargo:rustc-link-search=native={dir}");
    tauri_build::build()
}
