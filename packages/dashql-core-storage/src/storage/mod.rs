//! The storage of workbooks and connections: the writer that schedules the writes and the files it patches.
//!
//! The writer decides what to write and when, the host does the I/O (`StorageHost`): the folders of the origin
//! private file system, the folders of the desktop app or `node:fs`.

pub mod keys;
pub mod stamps;
pub mod workbook_file;
pub mod writer;

use serde_json::Value;

use dashql_core_runtime::host::{Host, HostError};
use dashql_core_runtime::http::HostBytes;
pub use stamps::{Expect, FileStamp, FolderListing, FolderStamps, NamedStamp};
pub use writer::{
    FailedWrite, HoldReason, StorageWriter, TextSource, WriteError, WriteHold, WriteOutcome, WriteResult,
    WriteStatistics, WriteTask, WriterStatus,
};

/// The workbook file of a workbook
pub const WORKBOOK_FILE: &str = "dashql-workbook.json";
/// The folder of the scripts of a workbook
pub const SCRIPTS_FOLDER: &str = "scripts";
/// The folder of the attachments of a workbook
pub const ATTACHMENTS_FOLDER: &str = "attachments";
/// The folder of the files of the connections
pub const CONNECTIONS_FOLDER: &str = "connections";

/// Rewrites the connection entries of the app manifest: gets the entries, none before the connections were migrated,
/// and returns the new ones, none if nothing changed
pub type ConnectionsUpdate = Box<dyn FnMut(Option<Vec<Value>>) -> Option<Vec<Value>>>;

/// The storage operations of the host. Workbooks and connection entries cross as JSON values.
///
/// The writes of a script and of the workbook file take what they expect on disk (`Expect`, see `stamps`): a host that
/// keeps stamps refuses a write with an external change when the file differs and returns the stamp of what it wrote,
/// a host without stamps ignores the expectation and returns none.
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait StorageHost: Host {
    /// Load the workbook file of a workbook, fails if there is none. A folder of an older format is migrated first.
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError>;
    /// Save the workbook file of a workbook. The write is atomic: a reader sees the old file or the new one, never a
    /// part (a folder on disk writes a temporary file and renames it).
    async fn save_workbook(
        &self,
        workbook_id: &str,
        workbook: &Value,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError>;
    /// Save a script file atomically. A missing folder of the workbook is not created again, e.g. a native folder that
    /// was moved: the write fails as unavailable (`HostError::unavailable`).
    async fn save_script(
        &self,
        workbook_id: &str,
        file_name: &str,
        text: &str,
        expect: Expect,
    ) -> Result<Option<FileStamp>, HostError>;
    /// Delete a script file, a missing file counts as deleted
    async fn delete_script(&self, workbook_id: &str, file_name: &str, expect: Expect) -> Result<(), HostError>;
    /// Rename a script file, keeping its contents and its stamp. A missing source counts as renamed.
    async fn rename_script(
        &self,
        workbook_id: &str,
        from: &str,
        to: &str,
        expect_from: Expect,
        expect_to: Expect,
    ) -> Result<(), HostError>;
    /// The names of the attachments of a workbook in natural order, the order of the attachment list
    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError>;
    /// Save an attachment of a workbook, the file stays with the host. A storage without attachments refuses.
    async fn save_data_file(&self, _workbook_id: &str, file_name: &str, _file: &HostBytes) -> Result<(), HostError> {
        Err(HostError::new(format!("the storage keeps no attachments, {file_name} was not saved")))
    }
    /// Rename an attachment of a workbook, keeping its contents. A storage without attachments refuses.
    async fn rename_data_file(&self, _workbook_id: &str, from: &str, _to: &str) -> Result<(), HostError> {
        Err(HostError::new(format!("the storage keeps no attachments, {from} was not renamed")))
    }
    /// Update the connection entries of the app manifest exclusively
    async fn update_connections(&self, update: ConnectionsUpdate) -> Result<(), HostError>;
    /// Save a file of a connection
    async fn save_connection_file(&self, connection_id: &str, file_name: &str, text: &str) -> Result<(), HostError>;
    /// Delete the files of a connection
    async fn delete_connection_files(&self, connection_id: &str) -> Result<(), HostError>;
    /// Delete a workbook with its files
    async fn delete_workbook(&self, workbook_id: &str) -> Result<(), HostError>;

    /// The statistics of a key changed
    fn statistics_changed(&self, _key: &str, _statistics: &WriteStatistics) {}
    /// The holds or the failed writes changed, e.g. a write that would overwrite a change outside the app holds its
    /// workbook
    fn status_changed(&self, _status: &WriterStatus) {}
}
