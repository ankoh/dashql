extern crate cmake;

fn main() {
    if let Ok(target) = std::env::var("TARGET") {
        match target.as_str() {
            "wasm32-unknown-unknown" => return,
            _ => ()
        }
    }

    let dst = cmake::Config::new("../../webapi/")
        .no_build_target(true)
        .always_configure(true)
        .build();

    println!("cargo:rustc-link-search=native={}/build", dst.display());
    println!("cargo:rustc-link-lib=static=duckdb_webapi_core");
    println!("cargo:rustc-link-lib=static=duckdb_webapi");
    println!("cargo:rustc-link-lib=dylib=c++");
}
