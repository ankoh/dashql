//! The results of the scripts of a workbook: Parquet files of `workbooks/<id>/results/`, one per script, named
//! `<script>.<key>.<gen>.parquet`, the script by its name without `.sql` (docs/design/workbook_results.md). The platform lists, writes, moves and removes the
//! files, this module names them and decides which file is the result of a script and which files are garbage.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use crate::workbook_format::files::{file_name_key, is_safe_file_name};

/// The folder of the results in a workbook folder
pub const RESULTS_FOLDER: &str = "results";
/// The suffix of a transient file: a materialized result that is no result of a script, or a file being written
pub const TRANSIENT_SUFFIX: &str = ".transient.parquet";
/// The extension of a result
const PARQUET: &str = ".parquet";
/// The extension of a script, which the name of a result leaves out
const SCRIPT_EXTENSION: &str = ".sql";
/// The hex digits of a key
const KEY_LENGTH: usize = 64;
/// The hex digits of a generation: the time it was named at in milliseconds since the epoch, 12 digits, and a sequence,
/// 8 digits. The names of the files of a script sort by the time they were named, the newest name is the largest.
const GENERATION_LENGTH: usize = 20;
/// The hex digits of the time of a generation
const GENERATION_TIME_LENGTH: usize = 12;
/// The hex digits of a random generation of earlier versions, the files of these sort by their modification times
const RANDOM_GENERATION_LENGTH: usize = 8;
/// The sequence of the first generation of a millisecond is random below this bound, the generations that follow
/// within the millisecond count up from it. Two processes that name a file in the same millisecond pick different
/// sequences.
const SEQUENCE_START_BOUND: u32 = 1 << 28;
/// The age after which a transient or empty file that nobody pins is garbage. Writing a file changes its time; the
/// pins of a process of Node are not seen by another one on the same root, so a younger file may be written right now.
pub const GARBAGE_AFTER_MS: f64 = 60.0 * 60.0 * 1000.0;

/// Is a text a number of lowercase hex digits?
fn is_hex(text: &str, length: usize) -> bool {
    text.len() == length && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Is a text a result key, 64 lowercase hex digits?
pub fn is_result_key(key: &str) -> bool {
    is_hex(key, KEY_LENGTH)
}

/// Is a text the generation of a file of a result, also a random one of earlier versions?
fn is_generation(text: &str) -> bool {
    is_hex(text, GENERATION_LENGTH) || is_hex(text, RANDOM_GENERATION_LENGTH)
}

/// The time a generation was named at in milliseconds since the epoch, none for a random one of earlier versions
pub fn generation_time(generation: &str) -> Option<f64> {
    if !is_hex(generation, GENERATION_LENGTH) {
        return None;
    }
    let time = u64::from_str_radix(generation.get(..GENERATION_TIME_LENGTH)?, 16).ok()?;
    Some(time as f64)
}

/// Names the generations of the new files of a process in the order they are named: the time and a sequence that
/// counts up within a millisecond. A clock that goes back keeps the last time, so a newer name never sorts lower.
#[derive(Debug, Default)]
pub struct Generations {
    time: u64,
    sequence: u32,
}

impl Generations {
    /// The generation of a new file, `random` picks the sequence of a new millisecond
    pub fn next(&mut self, now_ms: f64, random: u32) -> String {
        let now = now_ms.max(0.0) as u64;
        if now > self.time {
            self.time = now;
            self.sequence = random % SEQUENCE_START_BOUND;
        } else if let Some(sequence) = self.sequence.checked_add(1) {
            self.sequence = sequence;
        } else {
            self.time += 1;
            self.sequence = 0;
        }
        format!("{:012x}{:08x}", self.time & 0xffff_ffff_ffff, self.sequence)
    }
}

/// The name of a script without `.sql` (in any case), as the names of its results hold it. None for a name without
/// it or without anything before it.
pub fn script_stem(script: &str) -> Option<&str> {
    let split = script.len().checked_sub(SCRIPT_EXTENSION.len())?;
    let (stem, extension) = (script.get(..split)?, script.get(split..)?);
    (!stem.is_empty() && extension.eq_ignore_ascii_case(SCRIPT_EXTENSION)).then_some(stem)
}

/// The key of a script under which it matches the stem in the name of a file of a result, None for a name without
/// `.sql`
fn script_key(script: &str) -> Option<String> {
    script_stem(script).map(file_name_key)
}

/// The file name of the script of a file of a result, None for a transient file or a name that doesn't parse
pub fn script_of_result_file(name: &str) -> Option<String> {
    parse_result_file_name(name).map(|parsed| format!("{}{SCRIPT_EXTENSION}", parsed.stem))
}

/// The name of a file of the result of a script, None if the script name is no plain file name of a script, the key is
/// no key or the name gets too long for a file system
pub fn result_file_name(script: &str, key: &str, generation: &str) -> Option<String> {
    if !is_result_key(key) || !is_generation(generation) || !is_safe_file_name(script) {
        return None;
    }
    let name = format!("{}.{key}.{generation}{PARQUET}", script_stem(script)?);
    is_safe_file_name(&name).then_some(name)
}

/// The name of a transient file from a random UUID
pub fn transient_result_file_name(uuid: &str) -> String {
    format!("{uuid}{TRANSIENT_SUFFIX}")
}

/// Is a file transient, i.e. garbage once nobody pins it?
pub fn is_transient_result_file(name: &str) -> bool {
    name.ends_with(TRANSIENT_SUFFIX)
}

/// The parts of the name of a file of a result
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultFileName<'a> {
    /// The name of the script without `.sql`, e.g. `revenue` of `revenue.sql`
    pub stem: &'a str,
    /// The result key of the script when the result was written
    pub key: &'a str,
    /// The generation of the file
    pub generation: &'a str,
}

/// The parts of the name of a file of a result, None for any other file. The name splits at its last three dots, the
/// name of a script may hold dots itself.
pub fn parse_result_file_name(name: &str) -> Option<ResultFileName<'_>> {
    if is_transient_result_file(name) {
        return None;
    }
    let rest = name.strip_suffix(PARQUET)?;
    let (rest, generation) = rest.rsplit_once('.')?;
    let (stem, key) = rest.rsplit_once('.')?;
    (!stem.is_empty() && is_result_key(key) && is_generation(generation)).then_some(ResultFileName {
        stem,
        key,
        generation,
    })
}

/// A file of the results folder as the platform lists it
#[derive(Debug, Clone, PartialEq)]
pub struct ResultFileStat {
    /// The file name
    pub name: String,
    /// The size in bytes
    pub size: u64,
    /// The time of the write in milliseconds since the epoch
    pub mtime_ms: f64,
}

/// The stored result of a script
#[derive(Debug, Clone, PartialEq)]
pub struct StoredResult {
    /// The file name
    pub name: String,
    /// The name of the script without `.sql`, as the file names it
    pub stem: String,
    /// The key in the name of the file
    pub key: String,
    /// When the file was written, in milliseconds since the epoch: the time of its generation, or the modification time
    /// of a file of earlier versions
    pub written_at: f64,
    /// The size in bytes
    pub size: u64,
}

/// A listing of the results folder of a workbook
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResultListing {
    /// The result of each script, by the key of its name without `.sql` (`file_name_key`)
    pub results: BTreeMap<String, StoredResult>,
    /// The files to remove once nobody reads them
    pub garbage: Vec<String>,
}

impl ResultListing {
    /// The result of a script, by its file name
    pub fn result(&self, script: &str) -> Option<&StoredResult> {
        self.results.get(&script_key(script)?)
    }
}

/// The generation of a file that has a time, none for a random one of earlier versions or another file
fn timed_generation(file: &ResultFileStat) -> Option<&str> {
    parse_result_file_name(&file.name).map(|parsed| parsed.generation).filter(|g| generation_time(g).is_some())
}

/// The order of the files of the results, the newest first: by the generations in their names, a file of a generation
/// that has a time before a random one of earlier versions, and the files without one by their modification times
fn newest_first(a: &ResultFileStat, b: &ResultFileStat) -> Ordering {
    match (timed_generation(a), timed_generation(b)) {
        (Some(a), Some(b)) => b.cmp(a),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => b.mtime_ms.total_cmp(&a.mtime_ms).then_with(|| b.name.cmp(&a.name)),
    }
}

/// Sort the files of the results folder of a workbook: the newest file of every script of the workbook is its result.
/// Garbage are the older files of a script, the files of scripts that the workbook doesn't have (`scripts` None keeps
/// them, e.g. while the scripts are unknown), names that don't parse, and transient or empty files that are older than
/// `GARBAGE_AFTER_MS`. A younger empty file of a script is no result, it is being written.
pub fn sort_result_files(files: &[ResultFileStat], scripts: Option<&[&str]>, now: f64) -> ResultListing {
    let known: Option<Vec<String>> = scripts.map(|scripts| scripts.iter().copied().filter_map(script_key).collect());
    let old = |file: &ResultFileStat| file.mtime_ms < now - GARBAGE_AFTER_MS;
    let mut listing = ResultListing::default();
    // The newest file first, then by name
    let mut ordered: Vec<&ResultFileStat> = files.iter().collect();
    ordered.sort_by(|a, b| newest_first(a, b));
    for file in ordered {
        if is_transient_result_file(&file.name) {
            if old(file) {
                listing.garbage.push(file.name.clone());
            }
            continue;
        }
        let Some(parsed) = parse_result_file_name(&file.name) else {
            listing.garbage.push(file.name.clone());
            continue;
        };
        if file.size == 0 {
            if old(file) {
                listing.garbage.push(file.name.clone());
            }
            continue;
        }
        let script = file_name_key(parsed.stem);
        if known.as_ref().is_some_and(|known| !known.contains(&script)) || listing.results.contains_key(&script) {
            listing.garbage.push(file.name.clone());
            continue;
        }
        listing.results.insert(
            script,
            StoredResult {
                name: file.name.clone(),
                stem: parsed.stem.to_string(),
                key: parsed.key.to_string(),
                written_at: generation_time(parsed.generation).unwrap_or(file.mtime_ms),
                size: file.size,
            },
        );
    }
    listing.garbage.sort();
    listing
}

/// The files of a script, e.g. of one that ran to its end without a result. Files of other scripts stay.
pub fn files_of_script<'a>(files: &'a [ResultFileStat], script: &str) -> Vec<&'a str> {
    let Some(script) = script_key(script) else { return Vec::new() };
    files
        .iter()
        .filter(|file| parse_result_file_name(&file.name).is_some_and(|parsed| file_name_key(parsed.stem) == script))
        .map(|file| file.name.as_str())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(c: char) -> String {
        c.to_string().repeat(KEY_LENGTH)
    }

    fn stat(name: &str, size: u64, mtime_ms: f64) -> ResultFileStat {
        ResultFileStat { name: name.into(), size, mtime_ms }
    }

    #[test]
    fn names_files_after_script_key_and_generation() {
        let name = result_file_name("revenue.by.region.sql", &key('a'), "0123abcd").unwrap();
        assert_eq!(name, format!("revenue.by.region.{}.0123abcd.parquet", key('a')));
        let parsed = parse_result_file_name(&name).unwrap();
        assert_eq!(parsed.stem, "revenue.by.region");
        assert_eq!(script_of_result_file(&name).as_deref(), Some("revenue.by.region.sql"));
        assert_eq!(parsed.key, key('a'));
        assert_eq!(parsed.generation, "0123abcd");
        assert_eq!(result_file_name("a/b.sql", &key('a'), "0123abcd"), None);
        assert_eq!(result_file_name("a.sql", "ABC", "0123abcd"), None);
        // The name of a script ends in .sql, in any case, and has a name before it
        assert_eq!(result_file_name("A.SQL", &key('a'), "0123abcd"), Some(format!("A.{}.0123abcd.parquet", key('a'))));
        assert_eq!(result_file_name("a", &key('a'), "0123abcd"), None);
        assert_eq!(result_file_name(".sql", &key('a'), "0123abcd"), None);
        assert_eq!(result_file_name(&format!("{}.sql", "x".repeat(200)), &key('a'), "0123abcd"), None);
        assert_eq!(parse_result_file_name(&format!("{}.0123abcd.parquet", key('a'))), None);
        assert_eq!(parse_result_file_name(&format!("a.{}.0123abcd.parquet", key('A'))), None);
        assert_eq!(parse_result_file_name("1b4e28ba-2fa1-11d2-883f-0016d3cca427.transient.parquet"), None);
        // A generation has a time and a sequence, a random one of earlier versions has 8 digits
        let generation = "0000000000ff00000001";
        assert!(result_file_name("a.sql", &key('a'), generation).is_some());
        assert_eq!(generation_time(generation), Some(255.0));
        assert_eq!(generation_time("0123abcd"), None);
        assert_eq!(result_file_name("a.sql", &key('a'), "0123abc"), None);
    }

    #[test]
    fn sorts_the_newest_file_of_each_script_and_the_garbage() {
        let now = 10.0 * GARBAGE_AFTER_MS;
        let a_old = format!("a.{}.00000001.parquet", key('a'));
        let a_new = format!("A.{}.00000002.parquet", key('b'));
        let gone = format!("gone.{}.00000003.parquet", key('c'));
        let writing = format!("b.{}.00000004.parquet", key('d'));
        let crashed = format!("c.{}.00000005.parquet", key('d'));
        let files = [
            stat(&a_old, 10, now - 20.0),
            stat(&a_new, 10, now - 10.0),
            stat(&gone, 10, now),
            stat(&writing, 0, now),
            stat(&crashed, 0, 0.0),
            stat("x.transient.parquet", 10, now),
            stat("y.transient.parquet", 10, 0.0),
            stat("notes.txt", 1, now),
        ];
        let listing = sort_result_files(&files, Some(&["a.sql", "b.sql", "c.sql"]), now);
        assert_eq!(listing.result("a.SQL").map(|r| r.name.as_str()), Some(a_new.as_str()));
        assert_eq!(listing.result("a.sql").map(|r| r.key.as_str()), Some(key('b').as_str()));
        assert_eq!(listing.result("b.sql"), None);
        let mut garbage = vec![a_old, gone, crashed, "notes.txt".to_string(), "y.transient.parquet".to_string()];
        garbage.sort();
        assert_eq!(listing.garbage, garbage);
        // Without the scripts, the files of every script stay
        let listing = sort_result_files(&files, None, now);
        assert!(listing.result("gone.sql").is_some());
    }

    #[test]
    fn names_generations_in_the_order_they_are_named() {
        let mut generations = Generations::default();
        let first = generations.next(1000.0, 7);
        assert_eq!(first, "0000000003e800000007");
        // Within a millisecond and when the clock goes back the sequence counts up
        let second = generations.next(1000.0, 99);
        let third = generations.next(900.0, 99);
        assert_eq!((second.as_str(), third.as_str()), ("0000000003e800000008", "0000000003e800000009"));
        // A new millisecond starts a random sequence below the bound
        let fourth = generations.next(1001.0, u32::MAX);
        assert_eq!(fourth, format!("0000000003e9{:08x}", u32::MAX % SEQUENCE_START_BOUND));
        assert!(first < second && second < third && third < fourth);
        assert_eq!(generation_time(&fourth), Some(1001.0));
    }

    #[test]
    fn sorts_the_files_of_a_script_by_their_generations() {
        let now = 10.0 * GARBAGE_AFTER_MS;
        let legacy = format!("a.{}.00000001.parquet", key('a'));
        let older = format!("a.{}.0000000003e800000005.parquet", key('b'));
        let newer = format!("a.{}.0000000003e800000006.parquet", key('c'));
        // The modification times don't count for files with a time in their generation, they may be equal or swapped
        let files = [stat(&newer, 10, 1.0), stat(&older, 10, 2.0), stat(&legacy, 10, now)];
        let listing = sort_result_files(&files, Some(&["a.sql"]), now);
        let result = listing.result("a.sql").unwrap();
        assert_eq!((result.name.as_str(), result.written_at), (newer.as_str(), 1000.0));
        let mut garbage = vec![older, legacy];
        garbage.sort();
        assert_eq!(listing.garbage, garbage);
    }

    #[test]
    fn lists_the_files_of_a_script() {
        let a1 = format!("a.{}.00000001.parquet", key('a'));
        let a2 = format!("a.{}.00000002.parquet", key('b'));
        let ab = format!("a.b.{}.00000003.parquet", key('b'));
        let files = [stat(&a1, 1, 0.0), stat(&a2, 1, 0.0), stat(&ab, 1, 0.0), stat("t.transient.parquet", 1, 0.0)];
        assert_eq!(files_of_script(&files, "A.sql"), vec![a1.as_str(), a2.as_str()]);
    }
}
