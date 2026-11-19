//! The eviction policy of the query result cache, least recently used first.
//!
//! The host lists the files of the cache folder with their sizes and access times (the mtime of the `.last_access`
//! marker of a file, its write time without one) and removes the files that `CacheEviction` names. A file that is read
//! stays, the host reports it and the next one goes instead. `evict_to_fit` runs an eviction on a `CacheHost`, the
//! runtime runs it after every write of a file of a key.
//!
//! The cache is best-effort, not transactional: under concurrent writes the totals are approximate, a removal of a
//! file that is gone already counts as removed, and a file that is read is kept.

use dashql_core_runtime::host::HostError;

/// The files of the query result cache as the eviction sees them
#[allow(async_fn_in_trait)] // The futures hold values of the host and run on its thread, they are not Send
pub trait CacheHost {
    /// The Parquet files of the cache with their sizes and times, empty without a cache folder
    async fn list_files(&self) -> Result<Vec<CacheFileStat>, HostError>;
    /// Remove a file and its marker if nobody reads it, true if the file is gone
    async fn remove_file(&self, name: &str) -> Result<bool, HostError>;
}

/// Evict the least recently accessed files until the cache fits both limits, returns the names of the removed files
pub async fn evict_to_fit<H: CacheHost>(host: &H, max_bytes: u64, max_files: u64) -> Result<Vec<String>, HostError> {
    let mut eviction = CacheEviction::new(host.list_files().await?, max_bytes, max_files);
    let mut removed = Vec::new();
    while let Some(name) = eviction.next_candidate().map(|file| file.name.clone()) {
        if host.remove_file(&name).await? {
            eviction.deleted();
            removed.push(name);
        } else {
            // A file that is read stays, the next one goes instead
            eviction.kept();
        }
    }
    Ok(removed)
}

/// The size and the times of a cached file
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheFileStat {
    /// The file name, unique within the cache folder
    pub name: String,
    /// The size in bytes
    pub size: u64,
    /// The time of the write in milliseconds since the epoch
    pub mtime_ms: u64,
    /// The time of the last access in milliseconds since the epoch
    pub last_access_ms: u64,
}

/// The default cap on the total size of the cache
pub const DEFAULT_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// The default cap on the number of cached results
pub const DEFAULT_CACHE_MAX_FILES: u64 = 1000;

/// An eviction until the cache fits both thresholds, e.g. after a write
#[derive(Debug, Clone)]
pub struct CacheEviction {
    /// The files, least recently accessed first
    files: Vec<CacheFileStat>,
    /// The next candidate
    next: usize,
    total_bytes: u64,
    count: u64,
    max_bytes: u64,
    max_files: u64,
}

impl CacheEviction {
    /// Start an eviction over the files of the cache
    pub fn new(mut files: Vec<CacheFileStat>, max_bytes: u64, max_files: u64) -> Self {
        let total_bytes = files.iter().map(|file| file.size).sum();
        let count = files.len() as u64;
        files.sort_by_key(|file| file.last_access_ms);
        Self { files, next: 0, total_bytes, count, max_bytes, max_files }
    }

    /// Does the cache fit the thresholds?
    pub fn fits(&self) -> bool {
        self.total_bytes <= self.max_bytes && self.count <= self.max_files
    }

    /// The next file to delete, None once the cache fits or no file is left. The host reports the outcome with
    /// `deleted` or `kept` before it asks again.
    pub fn next_candidate(&self) -> Option<&CacheFileStat> {
        if self.fits() {
            return None;
        }
        self.files.get(self.next)
    }

    /// The candidate was deleted, or was gone already
    pub fn deleted(&mut self) {
        if let Some(file) = self.files.get(self.next) {
            self.total_bytes = self.total_bytes.saturating_sub(file.size);
            self.count = self.count.saturating_sub(1);
            self.next += 1;
        }
    }

    /// The candidate is read and stays, the next one goes instead
    pub fn kept(&mut self) {
        self.next = (self.next + 1).min(self.files.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat(name: &str, size: u64, mtime_ms: u64) -> CacheFileStat {
        CacheFileStat { name: name.into(), size, mtime_ms, last_access_ms: mtime_ms }
    }

    /// Run an eviction, the files in `read` stay
    fn evict(files: Vec<CacheFileStat>, max_bytes: u64, max_files: u64, read: &[&str]) -> Vec<String> {
        let mut eviction = CacheEviction::new(files, max_bytes, max_files);
        let mut deleted = Vec::new();
        while let Some(file) = eviction.next_candidate() {
            if read.contains(&file.name.as_str()) {
                eviction.kept();
            } else {
                deleted.push(file.name.clone());
                eviction.deleted();
            }
        }
        deleted
    }

    #[test]
    fn evicts_the_least_recently_accessed_files() {
        assert!(evict(vec![stat("a", 10, 1), stat("b", 10, 2)], 20, 2, &[]).is_empty());
        assert_eq!(evict(vec![stat("old", 40, 1), stat("mid", 40, 2), stat("new", 40, 3)], 50, 100, &[]), ["old", "mid"]);
        let lru = vec![
            CacheFileStat { name: "old".into(), size: 40, mtime_ms: 1, last_access_ms: 99 },
            CacheFileStat { name: "mid".into(), size: 40, mtime_ms: 2, last_access_ms: 50 },
            CacheFileStat { name: "new".into(), size: 40, mtime_ms: 3, last_access_ms: 5 },
        ];
        assert_eq!(evict(lru, 100, 100, &[]), ["new"]);
        assert_eq!(evict(vec![stat("old", 1, 1), stat("mid", 1, 2), stat("new", 1, 3)], 1000, 2, &[]), ["old"]);
        assert_eq!(evict(vec![stat("old", 40, 1), stat("mid", 40, 2), stat("new", 40, 3)], 80, 100, &["old"]), ["mid"]);
    }

    /// A cache in memory: the files that are read stay, the missing ones are gone already
    struct MemoryCache {
        files: Vec<CacheFileStat>,
        read: Vec<&'static str>,
        missing: Vec<&'static str>,
        removed: std::cell::RefCell<Vec<String>>,
    }

    impl CacheHost for MemoryCache {
        async fn list_files(&self) -> Result<Vec<CacheFileStat>, HostError> {
            Ok(self.files.clone())
        }

        async fn remove_file(&self, name: &str) -> Result<bool, HostError> {
            if self.read.contains(&name) {
                return Ok(false);
            }
            // A file that is gone already counts as removed
            if !self.missing.contains(&name) {
                self.removed.borrow_mut().push(name.to_string());
            }
            Ok(true)
        }
    }

    /// Run a future of the memory cache, it never waits
    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        let mut future = std::pin::pin!(future);
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        match future.as_mut().poll(&mut context) {
            std::task::Poll::Ready(value) => value,
            std::task::Poll::Pending => unreachable!("the memory cache never waits"),
        }
    }

    fn cache(read: Vec<&'static str>, missing: Vec<&'static str>) -> MemoryCache {
        let files = vec![stat("old.parquet", 40, 1), stat("mid.parquet", 40, 2), stat("new.parquet", 40, 3)];
        MemoryCache { files, read, missing, removed: Default::default() }
    }

    #[test]
    fn evicts_over_a_host() {
        // 120 bytes, at most 50: the oldest two go
        let host = cache(vec![], vec![]);
        assert_eq!(block_on(evict_to_fit(&host, 50, 100)).ok(), Some(vec!["old.parquet".to_string(), "mid.parquet".to_string()]));
        assert_eq!(*host.removed.borrow(), ["old.parquet", "mid.parquet"]);

        // A file that is read stays, the next one goes instead
        let host = cache(vec!["old.parquet"], vec![]);
        assert_eq!(block_on(evict_to_fit(&host, 80, 100)).ok(), Some(vec!["mid.parquet".to_string()]));

        // A file that is gone already counts as removed
        let host = cache(vec![], vec!["old.parquet"]);
        assert_eq!(block_on(evict_to_fit(&host, 100, 100)).ok(), Some(vec!["old.parquet".to_string()]));
        assert!(host.removed.borrow().is_empty());
    }
}
