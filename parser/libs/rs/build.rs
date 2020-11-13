#[derive(Debug)]
enum Error {
    Raw(String),
    IOError(std::io::Error),
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Error::IOError(error)
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Error::Raw(ref string) => write!(formatter, "{}", string),
            Error::IOError(ref error) => write!(formatter, "{}", error),
        }
    }
}

fn build() -> Result<(), Error> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let source_dir = std::env::current_dir()?;
        let cpp_dir = source_dir.join("../cpp/");
        let cpp_build_dir = if cfg!(debug_assertions) {
            cpp_dir.join("build/debug")
        } else {
            cpp_dir.join("build/release")
        };

        let metadata = std::fs::metadata(&cpp_build_dir).map_err(|_| {
            Error::Raw(format!(
                "Couldn't find build directory of web api: {}",
                cpp_build_dir.display()
            ))
        })?;

        if !metadata.is_dir() {
            Err(Error::Raw(format!(
                "Path to build directory is not a directory: {}",
                cpp_build_dir.display()
            )))?;
        }

        println!("cargo:rustc-link-search=native={}", cpp_build_dir.display());
        println!("cargo:rustc-link-lib=static=dashql_parser");
        println!("cargo:rustc-link-lib=static=dashql_parser_ffi");
        println!("cargo:rustc-link-lib=dylib=c++");
    }

    Ok(())
}

fn main() -> Result<(), Error> {
    build()?;

    Ok(())
}
