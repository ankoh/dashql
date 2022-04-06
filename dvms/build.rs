extern crate cmake;

use std::env;

fn main() {
    let dst = cmake::Config::new("../parser")
        .build_target("dashql_parser")
        .always_configure(true)
        .build();
    println!("cargo:rustc-link-search=native={}/build", dst.display());
    let target_os = env::var("CARGO_CFG_TARGET_OS");
    match target_os.as_ref().map(|x| &**x) {
        Ok("macos") => {
            println!("cargo:rustc-flags=-l dylib=c++");
        }
        _ => {
            println!("cargo:rustc-link-lib=static=stdc++");
        }
    }
    println!("cargo:rustc-link-lib=static=dashql_parser");
}
