extern crate cmake;

use std::env;

fn main() {
    let dst = cmake::Config::new("../duckdbx")
        .build_target("duckdbx")
        .always_configure(true)
        .build();
    println!("cargo:rustc-link-search=native={}/build", dst.display());
    println!(
        "cargo:rustc-link-search=native={}/build/third_party/arrow/install/lib",
        dst.display()
    );
    println!(
        "cargo:rustc-link-search=native={}/build/third_party/duckdb/install/lib",
        dst.display()
    );
    println!("cargo:rustc-link-lib=static=duckdbx");
    println!("cargo:rustc-link-lib=static=arrow");
    println!("cargo:rustc-link-lib=static=duckdb_static");

    println!("cargo:rustc-link-lib=static=duckdb_fastpforlib");
    println!("cargo:rustc-link-lib=static=duckdb_fmt");
    println!("cargo:rustc-link-lib=static=duckdb_hyperloglog");
    println!("cargo:rustc-link-lib=static=duckdb_miniz");
    println!("cargo:rustc-link-lib=static=duckdb_pg_query");
    println!("cargo:rustc-link-lib=static=duckdb_re2");
    println!("cargo:rustc-link-lib=static=duckdb_static");
    println!("cargo:rustc-link-lib=static=duckdb_utf8proc");
    println!("cargo:rustc-link-lib=static=parquet_extension");

    let target_os = env::var("CARGO_CFG_TARGET_OS");
    match target_os.as_ref().map(|x| &**x) {
        Ok("macos") => {
            println!("cargo:rustc-flags=-l dylib=c++");
        }
        _ => {
            println!("cargo:rustc-flags=-l dylib=stdc++");
        }
    }
}
