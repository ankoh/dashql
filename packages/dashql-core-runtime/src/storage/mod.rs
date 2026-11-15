//! The storage of workbooks and connections: the writer that schedules the writes and the files it patches.
//!
//! The writer decides what to write and when, the host does the I/O (`StorageHost`): the folders of the origin
//! private file system, the folders of the desktop app or `node:fs`.

pub mod keys;
pub mod workbook_file;
pub mod writer;

use serde_json::Value;

use crate::host::{Host, HostError};
pub use writer::{StorageWriter, TextSource, WriteError, WriteOutcome, WriteResult, WriteStatistics, WriteTask};

/// The workbook file of a workbook
pub const WORKBOOK_FILE: &str = "dashql-workbook.json";
/// The folder of the scripts of a workbook
pub const SCRIPTS_FOLDER: &str = "scripts";
/// The folder of the files of the connections
pub const CONNECTIONS_FOLDER: &str = "connections";

/// Rewrites the connection entries of the app manifest: gets the entries, none before the connections were migrated,
/// and returns the new ones, none if nothing changed
pub type ConnectionsUpdate = Box<dyn FnMut(Option<Vec<Value>>) -> Option<Vec<Value>>>;

/// The storage operations of the host. Workbooks and connection entries cross as JSON values.
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait StorageHost: Host {
    /// Load the workbook file of a workbook, fails if there is none
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError>;
    /// Save the workbook file of a workbook
    async fn save_workbook(&self, workbook_id: &str, workbook: &Value) -> Result<(), HostError>;
    /// Save a script file. Fails with an external script change if the file changed outside the app.
    async fn save_script(&self, workbook_id: &str, file_name: &str, text: &str) -> Result<(), HostError>;
    async fn delete_script(&self, workbook_id: &str, file_name: &str) -> Result<(), HostError>;
    /// Rename a script file, keeping its contents
    async fn rename_script(&self, workbook_id: &str, from: &str, to: &str) -> Result<(), HostError>;
    /// The names of the attachments of a workbook in natural order, the order of the attachment list
    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError>;
    /// Update the connection entries of the app manifest exclusively
    async fn update_connections(&self, update: ConnectionsUpdate) -> Result<(), HostError>;
    /// Save a file of a connection
    async fn save_connection_file(&self, connection_id: &str, file_name: &str, text: &str) -> Result<(), HostError>;
    /// Delete the files of a connection
    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError>;
    /// Delete a workbook with its files
    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError>;

    /// The statistics of a key changed
    fn statistics_changed(&self, key: &str, statistics: &WriteStatistics);
    /// The writes of a workbook are held because one of its scripts changed outside the app
    fn external_script_change(&self, workbook_id: &str);
}
