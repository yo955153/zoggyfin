// The nearby transport (Swift, macOS): swift/build_nearby.rs.
#[path = "swift/build_nearby.rs"]
mod build_nearby;

fn main() {
    build_nearby::build();
    // libmpv: Homebrew for development (see desktop/README.md). MPV_LIB_DIR overrides it;
    // the release build points it at the LGPL build of desktop/scripts/build-libmpv.sh.
    let dir = std::env::var("MPV_LIB_DIR").unwrap_or_else(|_| "/opt/homebrew/lib".into());
    println!("cargo:rerun-if-env-changed=MPV_LIB_DIR");
    println!("cargo:rustc-link-search=native={dir}");
    // The bundled libmpv has an @rpath install name and lives in Contents/Frameworks.
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    // Debug builds also find the LGPL build where it is, without a bundle.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
    }
    tauri_build::build()
}
