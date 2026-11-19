//! The cached query results that an exported workbook carries, and their import into the query result cache. The cache
//! stays with the host.

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

/// The limits of the query result cache
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CacheCapacity {
    /// The bytes the cache keeps
    pub max_bytes: u64,
    /// The files the cache keeps
    pub max_files: u64,
}

/// The outcome of an import of the query results of a workbook
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ImportedWorkbookQueryResults {
    /// The results of the workbook
    pub total: u64,
    /// The results that became files of the cache
    pub added: u64,
    /// The results whose keys were cached already, the results of the app win
    pub kept: u64,
    /// The results that couldn't be added
    pub failed: u64,
    /// The results left out because the workbook holds more than the cache keeps
    pub dropped: u64,
    /// The bytes of the results that were added
    pub bytes: u64,
    /// Why the first result that failed couldn't be added, or why none was
    pub error: Option<String>,
}

impl ImportedWorkbookQueryResults {
    /// The outcome of an import whose results all failed at once, e.g. without a cache
    pub fn failed_all(total: u64, error: impl Into<String>) -> Self {
        Self { total, failed: total, error: Some(error.into()), ..Self::default() }
    }

    /// A result became a file of the cache
    pub fn added(&mut self, size: u64) {
        self.added += 1;
        self.bytes += size;
    }

    /// The key of a result was cached already
    pub fn kept(&mut self) {
        self.kept += 1;
    }

    /// A result couldn't be added
    pub fn failed(&mut self, error: impl Into<String>) {
        self.failed += 1;
        if self.error.is_none() {
            self.error = Some(error.into());
        }
    }
}

/// Which results of a workbook an import adds to the cache, by their sizes: true for a result to add, false for one
/// beyond the limits of the cache, which would evict the ones before it again. Counts the dropped results.
pub fn plan_result_import(sizes: &[u64], capacity: CacheCapacity, outcome: &mut ImportedWorkbookQueryResults) -> Vec<bool> {
    outcome.total = sizes.len() as u64;
    let mut budget_bytes = capacity.max_bytes;
    let mut budget_files = capacity.max_files;
    sizes
        .iter()
        .map(|size| {
            if *size > budget_bytes || budget_files < 1 {
                outcome.dropped += 1;
                return false;
            }
            budget_bytes -= size;
            budget_files -= 1;
            true
        })
        .collect()
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
    fn leaves_out_results_beyond_the_capacity() {
        let mut outcome = ImportedWorkbookQueryResults::default();
        let plan = plan_result_import(&[3, 3], CacheCapacity { max_bytes: 5, max_files: 10 }, &mut outcome);
        assert_eq!(plan, [true, false]);
        outcome.added(3);
        assert_eq!(outcome, ImportedWorkbookQueryResults { total: 2, added: 1, dropped: 1, bytes: 3, ..Default::default() });
        let mut outcome = ImportedWorkbookQueryResults::default();
        plan_result_import(&[1, 3, 4], CacheCapacity { max_bytes: 100, max_files: 100 }, &mut outcome);
        outcome.failed("NotReadableError");
        outcome.added(3);
        outcome.kept();
        outcome.failed("other");
        assert_eq!(outcome, ImportedWorkbookQueryResults { total: 3, added: 1, kept: 1, failed: 2, bytes: 3, error: Some("NotReadableError".into()), ..Default::default() });
    }
}
