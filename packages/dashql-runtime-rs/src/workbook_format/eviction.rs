//! The eviction policy of the query result cache, least recently used first. Ported from
//! `storage/query_result_cache_eviction.ts`.
//!
//! The host lists the files of the cache folder with their sizes and access times (the mtime of the `.last_access`
//! marker of a file, its write time without one) and deletes the files that `CacheEviction` names. A file that is read
//! stays, the host reports it and the next one goes instead.

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
}
