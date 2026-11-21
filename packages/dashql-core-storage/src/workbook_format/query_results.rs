//! The query results that an exported workbook carries, and the outcome of their import into the results folder of the
//! workbook (docs/design/workbook_results.md).

/// The folder of the query results in an exported workbook of older versions, `results/<key>.parquet`
pub const WORKBOOK_RESULTS_FOLDER: &str = "results";

/// The path of a query result in an exported workbook of older versions
pub fn workbook_result_path(key: &str) -> String {
    format!("{WORKBOOK_RESULTS_FOLDER}/{key}.parquet")
}

/// The cache key of a file of the results folder, 64 lowercase hex digits, None for any other file
pub fn workbook_result_key(file_name: &str) -> Option<&str> {
    let key = file_name.strip_suffix(".parquet")?;
    (key.len() == 64 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))).then_some(key)
}

/// The outcome of an import of the query results of a workbook into its results folder
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ImportedWorkbookQueryResults {
    /// The results of the workbook
    pub total: u64,
    /// The results that became the files of their scripts
    pub added: u64,
    /// The results that name no script of the workbook, e.g. a result of an archive of an earlier version whose key
    /// is the key of no script
    pub unmatched: u64,
    /// The results that couldn't be added
    pub failed: u64,
    /// The bytes of the results that were added
    pub bytes: u64,
    /// Why the first result that failed couldn't be added, or why none was
    pub error: Option<String>,
}

impl ImportedWorkbookQueryResults {
    /// The outcome of an import whose results all failed at once, e.g. without a results folder
    pub fn failed_all(total: u64, error: impl Into<String>) -> Self {
        Self { total, failed: total, error: Some(error.into()), ..Self::default() }
    }

    /// A result became the file of its script
    pub fn added(&mut self, size: u64) {
        self.added += 1;
        self.bytes += size;
    }

    /// A result names no script of the workbook
    pub fn unmatched(&mut self) {
        self.unmatched += 1;
    }

    /// A result couldn't be added
    pub fn failed(&mut self, error: impl Into<String>) {
        self.failed += 1;
        if self.error.is_none() {
            self.error = Some(error.into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_result_files_after_their_keys() {
        let key = "a".repeat(64);
        assert_eq!(workbook_result_path(&key), format!("results/{key}.parquet"));
        assert_eq!(workbook_result_key(&format!("{key}.parquet")), Some(key.as_str()));
        assert_eq!(workbook_result_key(&format!("{}.parquet", "A".repeat(64))), None);
        assert_eq!(workbook_result_key("notes.txt"), None);
    }

    #[test]
    fn counts_the_outcome_of_an_import() {
        let mut outcome = ImportedWorkbookQueryResults { total: 4, ..Default::default() };
        outcome.failed("NotReadableError");
        outcome.added(3);
        outcome.unmatched();
        outcome.failed("other");
        assert_eq!(
            outcome,
            ImportedWorkbookQueryResults {
                total: 4,
                added: 1,
                unmatched: 1,
                failed: 2,
                bytes: 3,
                error: Some("NotReadableError".into()),
            }
        );
    }
}
