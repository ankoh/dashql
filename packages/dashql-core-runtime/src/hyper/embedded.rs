//! The sessions of the embedded Hyper, whose channel stays with the host.
//!
//! A connection of the embedded Hyper runs on one session of the database of the instance, the session keeps the state
//! of the scripts such as settings and attached databases.

use super::error::HyperError;
use super::local_cloud::{embedded_cloud_databases, is_attachable_database, HYPER_CLOUDS_DIRECTORY};
use crate::connections::JsonObject;

/// The database of the embedded Hyper connector in the instance
pub const EMBEDDED_DEFAULT_DATABASE: &str = "hyper";

/// A database that a session attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedAttachedDatabase {
    /// The path relative to the OPFS folder of the app, the host turns it into the Hyper path in the OPFS root of Hyper
    pub path: String,
    /// The alias that statements name the database by
    pub alias: String,
}

/// The options of the session of a connection to the embedded Hyper
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedSessionOptions {
    /// The database of the session, none for a local cloud: Hyper resolves unqualified names only in a session with a
    /// single database
    pub default_database: Option<String>,
    /// The databases of the clouds folder that the session attaches
    pub attached_databases: Vec<EmbeddedAttachedDatabase>,
}

/// The session options of a connection to the embedded Hyper with params. A local cloud attaches the databases of the
/// clouds folder of its params, like a Hyper server, and has no database of its own. A database outside of the clouds
/// folder is an error.
pub fn embedded_session_options(params: Option<&JsonObject>) -> Result<EmbeddedSessionOptions, HyperError> {
    let attached_databases = embedded_cloud_databases(params)
        .into_iter()
        .map(|database| {
            if !is_attachable_database(&database.path) {
                return Err(HyperError::Protocol(format!(
                    "The embedded Hyper only attaches databases in {HYPER_CLOUDS_DIRECTORY}/, not {}",
                    database.path
                )));
            }
            Ok(EmbeddedAttachedDatabase { path: database.path, alias: database.alias })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let default_database = attached_databases.is_empty().then(|| EMBEDDED_DEFAULT_DATABASE.to_string());
    Ok(EmbeddedSessionOptions { default_database, attached_databases })
}
