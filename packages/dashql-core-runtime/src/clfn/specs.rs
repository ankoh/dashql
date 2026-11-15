//! Where the specs of the extensions are. Bazel generates `extensions/<folder>/clfn/spec/spec.json` from the sources of
//! an extension; the platform knows where it put them (the chunks of the app, the files of Node) and reads one when a
//! connection needs it.
//!
//! Ported from `connections/clfn/clfn_specs.ts` of `packages/dashql-runtime`.

use super::ClientFunctionError;

/// The end of the path of the spec of an extension
pub fn spec_path_suffix(folder: &str) -> String {
    format!("/{folder}/clfn/spec/spec.json")
}

/// The source of the spec of an extension by its folder in `extensions/`, such as `d360-api`, among the paths that the
/// platform provides
pub fn find_client_function_spec<'a>(
    paths: impl IntoIterator<Item = &'a str>,
    folder: &str,
) -> Result<&'a str, ClientFunctionError> {
    let suffix = spec_path_suffix(folder);
    paths
        .into_iter()
        .find(|path| path.ends_with(&suffix))
        .ok_or_else(|| ClientFunctionError::new(format!("no extension in the folder {folder}")))
}
