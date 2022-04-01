extern crate cmake;

fn main() {
    let dst = cmake::Config::new("../parser")
        .build_target("dashql_parser")
        .always_configure(true)
        .build();
    println!("cargo:rustc-link-search=native={}/build", dst.display());
    println!("cargo:rustc-link-lib=static=stdc++");
    println!("cargo:rustc-link-lib=static=dashql_parser");
}
