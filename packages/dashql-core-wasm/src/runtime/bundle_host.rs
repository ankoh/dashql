//! The bundle of an archive as the storage of a restore: a workbook opens into memory with the restore of the storage,
//! which reads the workbook file, the scripts and the catalogs of the connections from the bundle and writes nothing.
//! A runtime without storage opens an import this way (`imports.rs`).

use std::future::Future;

use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_storage::restore::catalog::{CATALOG_FUNCTIONS_FILE, CATALOG_RELATIONS_FILE};
use dashql_core_storage::restore::{RestoreHost, RestoreProgress};
use dashql_core_storage::storage::{ConnectionsUpdate, Expect, FileStamp, StorageHost};
use dashql_core_storage::workbook_format::bundle::WorkbookBundle;
use serde_json::Value;

use super::archives::HostFile;
use crate::host::JsPlatform;

/// What a bundle refuses, it is read only
const READ_ONLY: &str = "a workbook opened into memory writes no files";

/// A bundle that a restore reads
pub(crate) struct BundleHost {
    pub platform: JsPlatform,
    pub bundle: WorkbookBundle<HostFile>,
}

impl BundleHost {
    fn workbook_id(&self) -> &str {
        &self.bundle.workbook.workbook_id
    }

    fn check(&self, workbook_id: &str) -> Result<(), HostError> {
        if workbook_id == self.workbook_id() {
            Ok(())
        } else {
            Err(HostError::unavailable(format!("the bundle holds no workbook {workbook_id}")))
        }
    }
}

impl Host for BundleHost {
    fn now(&self) -> f64 {
        self.platform.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.platform.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.platform.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, "workbook_import");
    }
}

impl StorageHost for BundleHost {
    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        self.check(workbook_id)?;
        Ok(self.bundle.workbook.to_json())
    }

    async fn save_workbook(&self, _workbook_id: &str, _workbook: &Value, _expect: Expect) -> Result<Option<FileStamp>, HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn save_script(&self, _workbook_id: &str, _file_name: &str, _text: &str, _expect: Expect) -> Result<Option<FileStamp>, HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn delete_script(&self, _workbook_id: &str, _file_name: &str, _expect: Expect) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn rename_script(&self, _workbook_id: &str, _from: &str, _to: &str, _expect_from: Expect, _expect_to: Expect) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn list_attachments(&self, workbook_id: &str) -> Result<Vec<String>, HostError> {
        self.check(workbook_id)?;
        Ok(self.bundle.data.iter().map(|file| file.name.clone()).collect())
    }

    async fn update_connections(&self, _update: ConnectionsUpdate) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn save_connection_file(&self, _connection_id: &str, _file_name: &str, _text: &str) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn delete_connection_files(&self, _connection_id: &str) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }

    async fn delete_workbook(&self, _workbook_id: &str) -> Result<(), HostError> {
        Err(HostError::new(READ_ONLY))
    }
}

impl RestoreHost for BundleHost {
    /// The connections of the bundle are the copies in its workbook file, there is no app manifest
    fn owns_connections(&self) -> bool {
        false
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        Ok(vec![self.workbook_id().to_string()])
    }

    async fn load_manifest_connections(&self) -> Result<Option<Vec<Value>>, HostError> {
        Ok(None)
    }

    async fn load_scripts(&self, workbook_id: &str) -> Result<Vec<(String, String)>, HostError> {
        self.check(workbook_id)?;
        Ok(self.bundle.scripts.iter().map(|script| (script.name.clone(), script.sql.clone())).collect())
    }

    async fn list_data_files(&self, workbook_id: &str) -> Result<Vec<DataFile>, HostError> {
        self.check(workbook_id)?;
        Ok(Vec::new())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        let catalog = self.bundle.catalogs.iter().find(|catalog| catalog.connection_id == connection_id);
        Ok(catalog.and_then(|catalog| match file_name {
            CATALOG_RELATIONS_FILE => catalog.relations.clone(),
            CATALOG_FUNCTIONS_FILE => catalog.functions.clone(),
            _ => None,
        }))
    }

    fn restore_progress(&self, _progress: &RestoreProgress) {}
}
