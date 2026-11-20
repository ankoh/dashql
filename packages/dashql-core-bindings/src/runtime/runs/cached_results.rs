//! The cached results of the scripts of the workbooks: the script view names the newest file of the reusable key of a
//! script in the query result cache, `cachedResult` with its key and when it was written.
//!
//! A workbook is looked up again when what the keys of its scripts depend on changed: the analyses of its scripts, its
//! attachments, the connections the scripts run on and their params, and the latest queries of the scripts with their
//! cache keys and deleted cache entries. A move of the cursor changes none of them. A cached result that a query of a
//! connection recorded or deleted, the end of a run and an eviction of the cache change the files of keys that other
//! workbooks may share: the workbooks on the connection, or every workbook, are looked up again then. A workbook whose
//! analyses are outdated keeps what it shows until they are current again.
//!
//! The checks wait until the changes pause like the analyses of the scripts that the editors show
//! (`background_analysis_delay_ms` of the settings), typing looks the workbook up once. A check compares the stamp of what the keys
//! depend on and looks up only a workbook whose stamp moved: one lookup per workbook at a time, it plans the keys of the
//! scripts once and looks each key up in the query result cache.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::rc::Rc;

use dashql_core_runtime::executor::QueryId;
use dashql_core_runtime::host::{Host, LogLevel};
use dashql_core_runtime::workbook::{ScriptCachedResult, Workbook, WorkbookAction, WorkbookScript};

use super::Runs;
use crate::host::field;
use crate::runtime::workbooks::WorkbookEntry;

/// What the runtime looked up for the workbooks
#[derive(Default)]
pub(crate) struct CachedResults {
    /// The stamp of what the cached results of a workbook were looked up for, by workbook
    stamps: RefCell<BTreeMap<String, String>>,
    /// The workbooks whose lookup runs
    looking_up: RefCell<BTreeSet<String>>,
    /// The workbooks to check once the changes paused
    pending: RefCell<BTreeSet<String>>,
    /// Is every workbook checked once the changes paused?
    all: Cell<bool>,
    /// Counts the restarts of the pause, a timer of an earlier one does nothing
    generation: Cell<u64>,
}

impl Runs {
    /// Check the cached results of a workbook, of every workbook without one, once the changes paused
    pub(crate) fn check_cached_results(self: &Rc<Self>, workbook_id: Option<&str>) {
        if self.destroyed.get() || !self.platform.has_cache() {
            return;
        }
        match workbook_id {
            Some(id) => {
                self.cached.pending.borrow_mut().insert(id.to_string());
            }
            None => self.cached.all.set(true),
        }
        let generation = self.cached.generation.get() + 1;
        self.cached.generation.set(generation);
        let sleep = self.platform.sleep(self.platform.settings().background_analysis_delay_ms);
        let runs = Rc::downgrade(self);
        self.platform.spawn(Box::pin(async move {
            sleep.await;
            let Some(runs) = runs.upgrade() else { return };
            if runs.cached.generation.get() == generation {
                runs.look_up_changed();
            }
        }));
    }

    /// Check the cached results of workbooks. After the files of keys changed, every one of them is looked up again.
    pub(crate) fn check_workbooks_cached_results(self: &Rc<Self>, workbook_ids: &[String], files: bool) {
        if files {
            self.cached.stamps.borrow_mut().retain(|id, _| !workbook_ids.contains(id));
        }
        for workbook_id in workbook_ids {
            self.check_cached_results(Some(workbook_id));
        }
    }

    /// Look up the cached results of every workbook again, e.g. after a run wrote the files of its keys or the cache
    /// evicted files
    pub(crate) fn forget_cached_results(self: &Rc<Self>) {
        self.cached.stamps.borrow_mut().clear();
        self.check_cached_results(None);
    }

    /// The stamp of what the keys of the scripts of a workbook depend on, none while an analysis is outdated
    fn cached_results_stamp(&self, workbook: &Workbook) -> Option<String> {
        if workbook.scripts().iter().any(WorkbookScript::is_analysis_outdated) {
            return None;
        }
        let registry = self.connections.registry.borrow();
        let mut stamp = String::new();
        let mut connections: BTreeSet<&str> = BTreeSet::new();
        for script in workbook.scripts() {
            let connection_id = script.connection().connection_id.as_str();
            connections.insert(connection_id);
            // The analysis names the text, the catalog and the table parameters it was analyzed with
            let _ = write!(stamp, "{}:{}:{}", script.key(), connection_id, script.analysis_serial());
            for query_id in [script.latest_query_id(), script.latest_result_query_id()] {
                let query = query_id.and_then(|id| {
                    let (_, history) = registry.query_history(id as QueryId)?;
                    let history = history.try_borrow().ok()?;
                    history
                        .query(id as QueryId)
                        .map(|query| (query.cache_key.clone().unwrap_or_default(), query.cache_deleted))
                });
                let _ = write!(stamp, ":{query_id:?}{query:?}");
            }
            stamp.push(';');
        }
        // The keys of the scripts that read attachments cover the files
        for attachment in workbook.attachments().unwrap_or_default() {
            let _ = write!(stamp, "{}@{};", attachment.file_name, attachment.stamp());
        }
        // The keys of a connection depend on its params, a connection that caches no results has none
        for connection_id in connections {
            let connection = registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                let params = state
                    .details()
                    .setup_params
                    .as_ref()
                    .map(|params| serde_json::Value::Object(params.clone()).to_string());
                Some((state.caches_query_results(), params))
            });
            let _ = write!(stamp, "{connection_id}:{connection:?};");
        }
        Some(stamp)
    }

    /// Start the lookups of the checked workbooks whose stamp moved
    fn look_up_changed(self: &Rc<Self>) {
        if self.destroyed.get() {
            return;
        }
        let all = self.cached.all.replace(false);
        let mut pending = std::mem::take(&mut *self.cached.pending.borrow_mut());
        let mut changed: Vec<(String, String, Vec<u32>)> = Vec::new();
        {
            let entries = self.workbooks.entries.borrow();
            // The stamps of workbooks that are gone are forgotten
            self.cached.stamps.borrow_mut().retain(|id, _| entries.iter().any(|entry| entry.id == *id));
            let checked: Vec<&WorkbookEntry> =
                entries.iter().filter(|entry| all || pending.contains(&entry.id)).collect();
            for entry in checked {
                // A workbook whose lookup runs is checked again once it ended
                if self.cached.looking_up.borrow().contains(&entry.id) {
                    pending.insert(entry.id.clone());
                    continue;
                }
                pending.remove(&entry.id);
                // A workbook that a run holds is checked with the next change of the run
                let Ok(workbook) = entry.workbook.try_borrow() else { continue };
                let Some(stamp) = self.cached_results_stamp(&workbook) else { continue };
                if self.cached.stamps.borrow().get(&entry.id) == Some(&stamp) {
                    continue;
                }
                let keys = workbook.scripts().iter().map(|script| script.key()).collect();
                changed.push((entry.id.clone(), stamp, keys));
            }
            pending.retain(|id| entries.iter().any(|entry| entry.id == *id));
        }
        self.cached.pending.borrow_mut().extend(pending);
        for (workbook_id, stamp, scripts) in changed {
            self.look_up(workbook_id, stamp, scripts);
        }
    }

    /// Look up the cached results of the scripts of a workbook and show them on the scripts
    fn look_up(self: &Rc<Self>, workbook_id: String, stamp: String, scripts: Vec<u32>) {
        // A busy workbook is looked up with its next change
        let Ok(keys) = self.result_keys(&workbook_id, None) else { return };
        self.cached.looking_up.borrow_mut().insert(workbook_id.clone());
        let runs = Rc::downgrade(self);
        let platform = self.platform.clone();
        self.platform.spawn(Box::pin(async move {
            let keys = keys.await;
            let mut found: Vec<Option<ScriptCachedResult>> = Vec::with_capacity(keys.len());
            for key in keys {
                let Some(key) = key else {
                    found.push(None);
                    continue;
                };
                let cached_at = match platform.cache_lookup(&key).await {
                    Ok(entry) => field(&entry, "cachedAt").and_then(|at| at.as_f64()),
                    Err(error) => {
                        platform.log_on(
                            LogLevel::Debug,
                            "Looking up a cached result failed",
                            &[("key", key.as_str()), ("error", error.message())],
                            super::LOG_TARGET,
                        );
                        None
                    }
                };
                found.push(cached_at.map(|cached_at| ScriptCachedResult { key, cached_at }));
            }
            let Some(runs) = runs.upgrade() else { return };
            runs.cached.looking_up.borrow_mut().remove(&workbook_id);
            if runs.destroyed.get() {
                return;
            }
            // The scripts moved or changed in between: the check below looks them up again
            let current = runs.workbooks.get(&workbook_id).and_then(|workbook| {
                let workbook = workbook.try_borrow().ok()?;
                let keys: Vec<u32> = workbook.scripts().iter().map(|script| script.key()).collect();
                (keys == scripts).then(|| runs.cached_results_stamp(&workbook)).flatten()
            });
            if current.as_ref() == Some(&stamp) {
                runs.cached.stamps.borrow_mut().insert(workbook_id.clone(), stamp);
                for (key, cached) in scripts.into_iter().zip(found) {
                    if let Err(error) =
                        runs.workbooks.apply(&workbook_id, WorkbookAction::SetCachedResult { key, cached })
                    {
                        runs.log(
                            LogLevel::Debug,
                            "Showing a cached result failed",
                            &[("workbookId", workbook_id.as_str()), ("error", error.what())],
                        );
                    }
                }
            }
            runs.check_cached_results(Some(&workbook_id));
        }));
    }
}
