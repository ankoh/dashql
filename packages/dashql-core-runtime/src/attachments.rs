//! The attachments of a workbook: Parquet files in the `attachments` folder of the workbook. An attachment is the table
//! parameter of its name, `sales.parquet` is `:sales`.

use std::sync::Arc;

use crate::natural::sort_naturally;

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
    if !extension.eq_ignore_ascii_case(ATTACHMENT_EXTENSION) {
        return None;
    }
    file_name.get(..base_len)
}

/// A file name for a new attachment whose table parameter takes no name of a script or another attachment, the same
/// name in another case neither: `sales.parquet` becomes `sales-2.parquet`. A file with the name of an attachment
/// replaces it and keeps its name. None for a file that is no attachment or no plain file name.
pub fn unique_attachment_file_name<'a>(
    file_name: &str,
    script_names: impl IntoIterator<Item = &'a str>,
    attachments: &[WorkbookAttachment],
) -> Option<String> {
    if attachment_parameter_name(file_name).is_some()
        && attachments.iter().any(|attachment| attachment.file_name == file_name)
    {
        return free_attachment_file_name(file_name, std::iter::empty(), &[]);
    }
    free_attachment_file_name(file_name, script_names, attachments)
}

/// The file name of a renamed attachment: the requested name with `.parquet` unless it has it, past the names of the
/// scripts and of the other attachments like a new attachment, but never the name of another one. None for a name that
/// is no plain file name.
pub fn renamed_attachment_file_name<'a>(
    file_name: &str,
    requested: &str,
    script_names: impl IntoIterator<Item = &'a str>,
    attachments: &[WorkbookAttachment],
) -> Option<String> {
    let requested = requested.trim();
    let name = match attachment_parameter_name(requested) {
        Some(_) => requested.to_string(),
        None => format!("{requested}{ATTACHMENT_EXTENSION}"),
    };
    let others: Vec<WorkbookAttachment> =
        attachments.iter().filter(|attachment| attachment.file_name != file_name).cloned().collect();
    free_attachment_file_name(&name, script_names, &others)
}

/// A file name whose table parameter takes no name of a script or of an attachment in any case, suffixing "-2", "-3",
/// ... to the name. None for a file that is no attachment or no plain file name.
fn free_attachment_file_name<'a>(
    file_name: &str,
    script_names: impl IntoIterator<Item = &'a str>,
    attachments: &[WorkbookAttachment],
) -> Option<String> {
    let base = attachment_parameter_name(file_name)?;
    if file_name.contains(['/', '\\', '\0']) {
        return None;
    }
    let extension = file_name.get(base.len()..)?;
    let taken: std::collections::HashSet<String> = script_names
        .into_iter()
        .map(str::to_lowercase)
        .chain(attachments.iter().map(|attachment| attachment.name.to_lowercase()))
        .collect();
    let mut candidate = base.to_string();
    let mut suffix = 2;
    while taken.contains(&candidate.to_lowercase()) {
        candidate = format!("{base}-{suffix}");
        suffix += 1;
    }
    Some(format!("{candidate}{extension}"))
}

/// The attachments of a listing of the data files of a workbook in natural order, other files are no attachments. An
/// attachment whose file is unchanged keeps the columns of `previous`.
pub fn read_workbook_attachments(files: &[DataFile], previous: &[WorkbookAttachment]) -> Vec<WorkbookAttachment> {
    let mut attachments: Vec<WorkbookAttachment> = files
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
            if let Some(kept) =
                previous.iter().find(|kept| kept.file_name == file.name && kept.stamp() == attachment.stamp())
            {
                attachment.columns = kept.columns.clone();
            }
            Some(attachment)
        })
        .collect();
    sort_naturally(&mut attachments, |attachment| attachment.file_name.as_str());
    attachments
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
        let previous: Vec<_> = previous
            .into_iter()
            .map(|attachment| WorkbookAttachment { columns: columns.clone(), ..attachment })
            .collect();
        let next =
            read_workbook_attachments(&[file("a.parquet", 1), file("b.parquet", 2), file("notes.txt", 1)], &previous);
        assert_eq!(
            next.iter().map(|a| (a.name.as_str(), a.columns.is_some())).collect::<Vec<_>>(),
            [("a", true), ("b", false)]
        );
    }

    #[test]
    fn lists_the_attachments_in_natural_order() {
        let listed =
            read_workbook_attachments(&[file("b10.parquet", 1), file("b9.parquet", 1), file("A.parquet", 1)], &[]);
        assert_eq!(
            listed.iter().map(|a| a.file_name.as_str()).collect::<Vec<_>>(),
            ["A.parquet", "b9.parquet", "b10.parquet"]
        );
    }

    #[test]
    fn names_a_new_attachment_past_the_scripts_and_the_attachments() {
        let attachments = read_workbook_attachments(&[file("sales.parquet", 1), file("Orders.parquet", 1)], &[]);
        // A file with the name of an attachment replaces it
        assert_eq!(unique_attachment_file_name("sales.parquet", [], &attachments).as_deref(), Some("sales.parquet"));
        // The table parameter takes no name of an attachment in another case, nor of a script
        assert_eq!(
            unique_attachment_file_name("orders.parquet", [], &attachments).as_deref(),
            Some("orders-2.parquet")
        );
        assert_eq!(
            unique_attachment_file_name("Report.parquet", ["report", "report-2"], &attachments).as_deref(),
            Some("Report-3.parquet")
        );
        assert_eq!(
            unique_attachment_file_name("fresh.PARQUET", ["other"], &attachments).as_deref(),
            Some("fresh.PARQUET")
        );
        // Other files and paths are no attachments
        assert_eq!(unique_attachment_file_name("notes.txt", [], &attachments), None);
        assert_eq!(unique_attachment_file_name("a/b.parquet", [], &attachments), None);
    }
}
