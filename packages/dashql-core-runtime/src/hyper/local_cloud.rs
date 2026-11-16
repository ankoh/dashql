//! The local cloud: a connection of the embedded Hyper whose session attaches a database of the clouds folder of the
//! OPFS of the app, like a connection to a Hyper server that attaches the database of DashQL. See
//! `docs/design/cloud.md`.
//!
//! Ported from `packages/dashql/src/platform/connections/hyper/local_cloud.ts`.

use serde_json::Value;

use crate::connections::JsonObject;

/// The OPFS folder of the databases that the embedded Hyper attaches, next to the instance folders and never cleaned
/// up
pub const HYPER_CLOUDS_DIRECTORY: &str = "clouds";

/// The path of the database file of the local cloud in the OPFS folder of the app
pub const LOCAL_CLOUD_DATABASE_PATH: &str = "clouds/local.hyper";
/// The alias of the database of the local cloud
pub const LOCAL_CLOUD_DATABASE_ALIAS: &str = "dashql";

/// A database of the clouds folder that a connection of the embedded Hyper attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloudDatabase {
    /// The path relative to the OPFS folder of the app, e.g. `clouds/local.hyper`
    pub path: String,
    /// The alias
    pub alias: String,
}

/// The databases of the clouds folder that a connection of the embedded Hyper attaches. A connection that attaches one
/// is a connection of its own, not the embedded Hyper of the app. The embedded Hyper ignores its other attached
/// databases.
pub fn embedded_cloud_databases(hyper: Option<&JsonObject>) -> Vec<CloudDatabase> {
    let Some(hyper) = hyper else {
        return Vec::new();
    };
    let protocol = hyper.get("protocol").filter(|protocol| !protocol.is_null());
    if protocol.is_some_and(|protocol| protocol.as_str() != Some("WASM")) {
        return Vec::new();
    }
    let prefix = format!("{HYPER_CLOUDS_DIRECTORY}/");
    hyper
        .get("attachedDatabases")
        .and_then(Value::as_array)
        .map(|databases| {
            databases
                .iter()
                .filter_map(Value::as_object)
                .filter_map(|database| {
                    let path = database.get("path").and_then(Value::as_str).filter(|path| path.starts_with(&prefix))?;
                    let alias = database.get("alias").and_then(Value::as_str).filter(|alias| !alias.is_empty())?;
                    Some(CloudDatabase { path: path.to_string(), alias: alias.to_string() })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// May the embedded Hyper attach a database file? Only the files `clouds/<name>.hyper` with a name of letters, digits,
/// `_` and `-`, the OPFS cleanup leaves them alone.
pub fn is_attachable_database(path: &str) -> bool {
    let Some(name) = path.strip_prefix("clouds/").and_then(|file| file.strip_suffix(".hyper")) else {
        return false;
    };
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
