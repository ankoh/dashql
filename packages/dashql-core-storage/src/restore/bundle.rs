//! The bundle of an archive as the storage of a restore: a workbook opens into memory with the restore of the storage
//! (`AppRestore::in_memory`), which reads the workbook file, the scripts and the catalogs of the connections from the
//! bundle and writes nothing. A runtime without storage opens an import this way. The host gives the clock, the tasks
//! and the log, the files of the bundle are any bytes that know their size (`BundleFile`).

use dashql_core_runtime::attachments::DataFile;
use dashql_core_runtime::host::{Host, HostError, OnHost};

use serde_json::Value;

use super::{RestoreHost, RestoreProgress};
use crate::workbook_format::bundle::WorkbookBundle;
use crate::workbook_format::layout::{STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS};

/// The bytes of a file of a bundle, e.g. a handle of the platform or the bytes themselves
pub trait BundleFile {
    /// The size in bytes
    fn size_bytes(&self) -> u64;
}

impl BundleFile for Vec<u8> {
    fn size_bytes(&self) -> u64 {
        self.len() as u64
    }
}

/// A bundle that a restore reads, on a host
pub struct BundleHost<H, B> {
    pub host: H,
    pub bundle: WorkbookBundle<B>,
}

impl<H, B> BundleHost<H, B> {
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

impl<H: Host, B: 'static> OnHost for BundleHost<H, B> {
    type Inner = H;

    fn inner_host(&self) -> &H {
        &self.host
    }
}

impl<H: Host, B: BundleFile + 'static> RestoreHost for BundleHost<H, B> {
    /// The connections of the bundle are the copies in its workbook file, there is no app manifest
    fn owns_connections(&self) -> bool {
        false
    }

    async fn list_workbooks(&self) -> Result<Vec<String>, HostError> {
        Ok(vec![self.workbook_id().to_string()])
    }

    async fn load_workbook(&self, workbook_id: &str) -> Result<Value, HostError> {
        self.check(workbook_id)?;
        Ok(self.bundle.workbook.to_json())
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
        Ok(self
            .bundle
            .data
            .iter()
            .map(|file| DataFile { name: file.name.clone(), size_bytes: file.bytes.size_bytes(), mtime_ms: 0 })
            .collect())
    }

    async fn load_connection_file(&self, connection_id: &str, file_name: &str) -> Result<Option<String>, HostError> {
        let catalog = self.bundle.catalogs.iter().find(|catalog| catalog.connection_id == connection_id);
        Ok(catalog.and_then(|catalog| match file_name {
            STORAGE_CATALOG_RELATIONS => catalog.relations.clone(),
            STORAGE_CATALOG_FUNCTIONS => catalog.functions.clone(),
            _ => None,
        }))
    }

    fn restore_progress(&self, _progress: &RestoreProgress) {}
}
