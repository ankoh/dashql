pub mod hyper_service_mock;
pub mod integration;

// Real-hyperd test: compiles on every platform where the tableauhyperapi
// wheel exposes a native hyperd binary (Linux x86_64, macOS arm64, macOS
// x86_64). The test itself is `#[ignore]`d and only runs when HYPERD_BIN
// points at a real binary, so plain `cargo test` is unaffected.
#[cfg(any(
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64"),
    all(target_os = "macos", target_arch = "x86_64"),
))]
pub mod hyperd;
