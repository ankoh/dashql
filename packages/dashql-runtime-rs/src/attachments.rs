//! The attachments of a workbook: Parquet files in the `attachments` folder of the workbook. An attachment is the table
//! parameter of its name, `sales.parquet` is `:sales`. Ported from
//! `packages/dashql-runtime/src/workbook/attachments/workbook_attachments.ts`.

use std::sync::Arc;

/// The extension of an attachment
pub const ATTACHMENT_EXTENSION: &str = ".parquet";

/// A data file of a workbook as storage lists it
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataFile {
    /// The file name
    pub name: String,
    /// The size of the file
    pub size_bytes: u64,
    /// The time of the last modification in milliseconds since the epoch, 0 if storage doesn't know it
    pub mtime_ms: u64,
}

/// An attachment of a workbook
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookAttachment {
    /// The file name
    pub file_name: String,
    /// The name of the table parameter, the file name without `.parquet`
    pub name: String,
    /// The size of the file
    pub size_bytes: u64,
    /// The time of the last modification, 0 if storage doesn't know it
    pub mtime_ms: u64,
    /// The columns of the file, none until they were read
    pub columns: Option<Vec<Arc<str>>>,
}

impl WorkbookAttachment {
    /// What changes when the file changes
    pub fn stamp(&self) -> String {
        format!("{}-{}", self.size_bytes, self.mtime_ms)
    }
}

/// The name of the table parameter of an attachment, the file name without `.parquet`. None for a file that is no
/// attachment.
pub fn attachment_parameter_name(file_name: &str) -> Option<&str> {
    let base_len = file_name.len().checked_sub(ATTACHMENT_EXTENSION.len()).filter(|len| *len > 0)?;
    let extension = file_name.get(base_len..)?;
    extension.eq_ignore_ascii_case(ATTACHMENT_EXTENSION).then(|| &file_name[..base_len])
}

/// The attachments of a listing of the data files of a workbook, other files are no attachments. An attachment whose
/// file is unchanged keeps the columns of `previous`.
pub fn read_workbook_attachments(files: &[DataFile], previous: &[WorkbookAttachment]) -> Vec<WorkbookAttachment> {
    files
        .iter()
        .filter_map(|file| {
            let name = attachment_parameter_name(&file.name)?;
            let mut attachment = WorkbookAttachment {
                file_name: file.name.clone(),
                name: name.to_string(),
                size_bytes: file.size_bytes,
                mtime_ms: file.mtime_ms,
                columns: None,
            };
            if let Some(kept) = previous.iter().find(|kept| kept.file_name == file.name && kept.stamp() == attachment.stamp()) {
                attachment.columns = kept.columns.clone();
            }
            Some(attachment)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, size_bytes: u64) -> DataFile {
        DataFile { name: name.into(), size_bytes, mtime_ms: 1 }
    }

    #[test]
    fn names_the_table_parameter_of_a_parquet_file() {
        assert_eq!(attachment_parameter_name("sales.parquet"), Some("sales"));
        assert_eq!(attachment_parameter_name("sales.PARQUET"), Some("sales"));
        assert_eq!(attachment_parameter_name(".parquet"), None);
        assert_eq!(attachment_parameter_name("sales.csv"), None);
        assert_eq!(attachment_parameter_name("é.parquet"), Some("é"));
    }

    #[test]
    fn keeps_the_columns_of_unchanged_files() {
        let columns: Option<Vec<Arc<str>>> = Some(vec!["a".into()]);
        let previous = read_workbook_attachments(&[file("a.parquet", 1), file("b.parquet", 1)], &[]);
        let previous: Vec<_> = previous.into_iter().map(|attachment| WorkbookAttachment { columns: columns.clone(), ..attachment }).collect();
        let next = read_workbook_attachments(&[file("a.parquet", 1), file("b.parquet", 2), file("notes.txt", 1)], &previous);
        assert_eq!(next.iter().map(|a| (a.name.as_str(), a.columns.is_some())).collect::<Vec<_>>(), [("a", true), ("b", false)]);
    }
}
