//! Part of `build.rs`: compiles the nearby transport (Swift) into a static
//! library and links it (macOS only). The Swift files are the ones of the iOS
//! module (`modules/zoggyfin-native/ios/`) plus `swift/NearbyBridge.swift`
//! (the C API that `src/nearby.rs` calls).

use std::path::{Path, PathBuf};
use std::process::Command;

/// The shared Swift files, relative to `CARGO_MANIFEST_DIR`.
const SHARED: [&str; 6] = [
    "../../modules/zoggyfin-native/ios/NearbyEvents.swift",
    "../../modules/zoggyfin-native/ios/NearbyCore.swift",
    "../../modules/zoggyfin-native/ios/MediaServer.swift",
    "../../modules/zoggyfin-native/ios/NearbyBle.swift",
    "../../modules/zoggyfin-native/ios/WifiJoin.swift",
    "../../modules/zoggyfin-native/ios/SeekableMp4.swift",
];
const BRIDGE: &str = "swift/NearbyBridge.swift";
const LIB: &str = "ZgfNearby";

fn xcrun(args: &[&str]) -> String {
    let out = Command::new("xcrun")
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("run xcrun {args:?}: {e}"));
    assert!(
        out.status.success(),
        "xcrun {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// `bundle.macOS.minimumSystemVersion` of tauri.conf.json (a plain text search: no JSON parser here).
fn deployment_target(manifest: &Path) -> String {
    let conf = std::fs::read_to_string(manifest.join("tauri.conf.json")).expect("read tauri.conf.json");
    let key = "\"minimumSystemVersion\"";
    conf.find(key)
        .and_then(|i| conf[i + key.len()..].split('"').nth(1))
        .map(str::to_string)
        .unwrap_or_else(|| "13.0".into())
}

pub fn build() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => "x86_64",
        _ => "arm64",
    };
    let target = format!("{arch}-apple-macos{}", deployment_target(&manifest));
    println!("cargo:rerun-if-changed=tauri.conf.json");

    let mut sources: Vec<PathBuf> = SHARED.iter().map(|f| manifest.join(f)).collect();
    sources.push(manifest.join(BRIDGE));
    for s in &sources {
        println!("cargo:rerun-if-changed={}", s.display());
    }

    let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = xcrun(&["--sdk", "macosx", "-f", "swiftc"]);
    let lib = out.join(format!("lib{LIB}.a"));
    // The paths of the source files go into the binary (assertion texts): give them a neutral prefix.
    let repo = manifest.join("../..").canonicalize().expect("the repository folder");
    let status = Command::new(&swiftc)
        .args([
            "-emit-library",
            "-static",
            "-parse-as-library",
            "-module-name",
            LIB,
            "-O",
        ])
        .args(["-target", &target, "-sdk", &sdk])
        .arg("-module-cache-path")
        .arg(out.join("swift-module-cache"))
        .arg("-file-prefix-map")
        .arg(format!("{}=/zoggyfin", repo.display()))
        .arg("-o")
        .arg(&lib)
        .args(&sources)
        .current_dir(&out)
        .status()
        .expect("run swiftc");
    assert!(status.success(), "swiftc failed for the nearby transport");

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static={LIB}");
    for fw in [
        "Foundation",
        "AVFoundation",
        "Network",
        "CoreBluetooth",
        "CoreWLAN",
        "CoreLocation",
        "AppKit",
    ] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
    // The Swift runtime: the system libraries (in the OS since macOS 10.14.4) and the
    // compatibility libraries of the toolchain that the Swift objects ask for.
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    let toolchain_lib = Path::new(&swiftc)
        .parent()
        .and_then(Path::parent)
        .map(|p| p.join("lib/swift/macosx"))
        .expect("the toolchain folder");
    println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
