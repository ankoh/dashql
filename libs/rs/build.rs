use std::env;
use std::fs::metadata;
use std::string::String;
use std::fmt;

enum Error {
    Raw(String),
    IOError(std::io::Error),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Error::IOError(error)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            Error::Raw(ref s) => write!(f, "{}", s),
            Error::IOError(ref e) => write!(f, "{}", e)
        }
    }
}

fn build() -> Result<(), Error> {
    if cfg!(debug_assertions) {
        let source_dir = env::current_dir()?;
        let webapi_dir = source_dir.join("../../webapi");
        let webapi_build_dir = if cfg!(debug_assertions) {
            webapi_dir.join("build/debug")
        } else {
            webapi_dir.join("build/release")
        };
        let md = metadata(&webapi_build_dir);
        if md.is_err() || !md.unwrap().is_dir() {
            return Err(Error::Raw(format!("couldn't find build directory of web api: {}", webapi_build_dir.display())))
        }
        println!("cargo:rustc-link-search=native={}", webapi_build_dir.display());
        println!("cargo:rustc-link-lib=static=duckdb_webapi_core");
        println!("cargo:rustc-link-lib=static=duckdb_webapi");
        println!("cargo:rustc-link-lib=dylib=c++");
    }

    Ok(())
}

fn main() {
    std::process::exit(match build() {
        Ok(()) => 0,
        Err(err) => { eprintln!("{}", err); 1 }
    })
}
