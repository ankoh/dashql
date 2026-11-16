//! The views of the storage writer: the outcomes of the writes, the statistics of a key, the holds and the failed
//! writes, as JS objects (`serde-wasm-bindgen`) with TypeScript declarations in the generated `.d.ts` (`tsify`). See
//! docs/design/dashql_core.md.
//!
//! A failed write hands back the value that the host failed with.

use dashql_core_runtime::storage::{FailedWrite, HoldReason, WriteError, WriteHold, WriteOutcome, WriteStatistics};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use super::error_value;

/// The outcome of a write. A failed write carries what the host failed with, a patch of a workbook file that is not
/// available names the workbook.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "status", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[tsify(missing_as_null)]
pub enum StorageWriteOutcome {
    Written,
    Superseded,
    Cancelled,
    Deferred,
    Failed {
        #[serde(serialize_with = "serde_wasm_bindgen::preserve::serialize")]
        #[tsify(type = "unknown")]
        error: JsValue,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        unavailable_workbook: Option<String>,
    },
}

impl From<WriteOutcome> for StorageWriteOutcome {
    fn from(outcome: WriteOutcome) -> Self {
        match outcome {
            WriteOutcome::Written => Self::Written,
            WriteOutcome::Superseded => Self::Superseded,
            WriteOutcome::Cancelled => Self::Cancelled,
            WriteOutcome::Deferred => Self::Deferred,
            WriteOutcome::Failed(WriteError::Host(error)) => {
                Self::Failed { error: error_value(&error), unavailable_workbook: None }
            }
            WriteOutcome::Failed(WriteError::WorkbookUnavailable { workbook_id, cause }) => {
                Self::Failed { error: error_value(&cause), unavailable_workbook: Some(workbook_id) }
            }
        }
    }
}

/// The statistics of a key: the scheduled writes of the key and the writes of its file
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageWriteStatistics {
    pub scheduled_writes: u64,
    pub writes: u64,
    pub written_bytes: u64,
    pub write_time_ms: f64,
    /// The time of the last write in milliseconds since the epoch
    pub last_write_ms: Option<f64>,
}

impl From<&WriteStatistics> for StorageWriteStatistics {
    fn from(statistics: &WriteStatistics) -> Self {
        StorageWriteStatistics {
            scheduled_writes: statistics.scheduled_writes,
            writes: statistics.writes,
            written_bytes: statistics.written_bytes,
            write_time_ms: statistics.write_time_ms,
            last_write_ms: statistics.last_write_ms,
        }
    }
}

/// The statistics of the writes of a key, with the key within its workbook for display
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageKeyStatistics {
    pub key: String,
    /// The key without the prefix of its workbook, e.g. `scripts/a.sql:delete`
    pub label: String,
    pub statistics: StorageWriteStatistics,
}

/// Why the writes of the writer or of a workbook are held
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]

pub enum StorageHoldReason {
    /// A file changed outside the app, the app asks the user
    ExternalChange,
    /// A check of a folder or a reload from disk
    Reload,
    /// An import replaces the workbook
    Import,
    /// Another tab took over the app
    Handover,
    /// The app paused the writes, e.g. while it moves a workbook
    Pause,
}

impl From<StorageHoldReason> for HoldReason {
    fn from(reason: StorageHoldReason) -> Self {
        match reason {
            StorageHoldReason::ExternalChange => HoldReason::ExternalChange,
            StorageHoldReason::Reload => HoldReason::Reload,
            StorageHoldReason::Import => HoldReason::Import,
            StorageHoldReason::Handover => HoldReason::Handover,
            StorageHoldReason::Pause => HoldReason::Pause,
        }
    }
}

impl From<HoldReason> for StorageHoldReason {
    fn from(reason: HoldReason) -> Self {
        match reason {
            HoldReason::ExternalChange => StorageHoldReason::ExternalChange,
            HoldReason::Reload => StorageHoldReason::Reload,
            HoldReason::Import => StorageHoldReason::Import,
            HoldReason::Handover => StorageHoldReason::Handover,
            HoldReason::Pause => StorageHoldReason::Pause,
        }
    }
}

/// A hold of the writer (no workbook) or of a workbook
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct StorageHoldView {
    pub workbook_id: Option<String>,
    pub reason: StorageHoldReason,
    pub count: u32,
}

impl From<&WriteHold> for StorageHoldView {
    fn from(hold: &WriteHold) -> Self {
        StorageHoldView { workbook_id: hold.workbook_id.clone(), reason: hold.reason.into(), count: hold.count }
    }
}

/// A write that failed. One that failed for a moment runs again after a backoff, one whose target is gone stops
/// (`permanent`) until a newer write of its key or until the app discards it (`storageDiscardWrites`).
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct FailedStorageWriteView {
    pub key: String,
    /// The workbook of the key, null for the files of the app
    pub workbook_id: Option<String>,
    /// The last error
    pub error: String,
    /// The failed attempts in a row
    pub attempts: u32,
    /// The target of the write is gone, e.g. a moved workbook folder: the writer stopped retrying it
    pub permanent: bool,
}

impl From<&FailedWrite> for FailedStorageWriteView {
    fn from(write: &FailedWrite) -> Self {
        FailedStorageWriteView {
            key: write.key.clone(),
            workbook_id: write.workbook_id.clone(),
            error: write.error.clone(),
            attempts: write.attempts,
            permanent: write.permanent,
        }
    }
}
