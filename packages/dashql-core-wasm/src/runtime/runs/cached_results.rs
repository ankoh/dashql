//! The cached results of the scripts of the workbooks: the script view names the newest file of the reusable key of a
//! script in the query result cache, `cachedResult` with its key and when it was written.
//!
//! The runtime looks them up again when what a key depends on changed: the analyses of the scripts, the connections
//! they run on and their params, the latest queries of the scripts with their cache keys and deleted cache entries, and
//! the end of a run, which writes the files of its keys. A workbook whose analyses are outdated keeps what it shows
//! until they are current again, every keystroke outdates all scripts of a workbook. One lookup runs per workbook at a
//! time: it plans the keys of every script once and looks each key up in the query result cache.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::rc::Rc;

use dashql_core_runtime::executor::QueryId;
use dashql_core_runtime::host::{Host, LogLevel};
use dashql_core_runtime::workbook::{ScriptCachedResult, Workbook, WorkbookAction};

use super::Runs;
use crate::host::field;
use crate::runtime::workbooks::editor_update_key;

/// What the runtime looked up for the workbooks
#[derive(Default)]
pub(crate) struct CachedResults {
    /// The stamp of what the cached results of a workbook were looked up for, by workbook
    stamps: RefCell<BTreeMap<String, String>>,
    /// The workbooks whose lookup runs
    looking_up: RefCell<BTreeSet<String>>,
    /// Is a check of the workbooks scheduled?
    scheduled: Cell<bool>,
}

impl Runs {
    /// Check the cached results of the workbooks once the current task ended
    pub(crate) fn check_cached_results(self: &Rc<Self>) {
        if self.destroyed.get() || !self.platform.has_cache() || self.cached.scheduled.replace(true) {
            return;
        }
        let runs = Rc::downgrade(self);
        self.platform.spawn(Box::pin(async move {
            let Some(runs) = runs.upgrade() else { return };
            runs.cached.scheduled.set(false);
            runs.look_up_changed();
        }));
    }

    /// Look up the cached results of a workbook again, e.g. after a run wrote the files of its keys
    pub(crate) fn forget_cached_results(self: &Rc<Self>, workbook_id: &str) {
        self.cached.stamps.borrow_mut().remove(workbook_id);
        self.check_cached_results();
    }

    /// The stamp of what the keys of the scripts of a workbook depend on, none while an analysis is outdated
    fn cached_results_stamp(&self, workbook: &Workbook) -> Option<String> {
        if workbook.scripts().iter().any(|script| script.analysis_outdated()) {
            return None;
        }
        let registry = self.connections.registry.borrow();
        let mut stamp = String::new();
        let mut connections: BTreeSet<&str> = BTreeSet::new();
        for script in workbook.scripts() {
            let connection_id = script.connection().connection_id.as_str();
            connections.insert(connection_id);
            let update = script.editor_update().map(editor_update_key).unwrap_or_default();
            let _ = write!(stamp, "{}:{}:{}", script.key(), connection_id, update);
            for query_id in [script.latest_query_id(), script.latest_result_query_id()] {
                let query = query_id.and_then(|id| {
                    let (_, history) = registry.query_history(id as QueryId)?;
                    let history = history.try_borrow().ok()?;
                    history.query(id as QueryId).map(|query| (query.cache_key.clone().unwrap_or_default(), query.cache_deleted))
                });
                let _ = write!(stamp, ":{query_id:?}{query:?}");
            }
            stamp.push(';');
        }
        // The keys of a connection depend on its params, a connection that caches no results has none
        for connection_id in connections {
            let connection = registry.get(connection_id).and_then(|connection| {
                let state = connection.state.try_borrow().ok()?;
                let params = state.details().setup_params.as_ref().map(|params| serde_json::Value::Object(params.clone()).to_string());
                Some((state.caches_query_results(), params))
            });
            let _ = write!(stamp, "{connection_id}:{connection:?};");
        }
        Some(stamp)
    }

    /// Start the lookups of the workbooks whose stamp changed
    fn look_up_changed(self: &Rc<Self>) {
        if self.destroyed.get() {
            return;
        }
        let mut changed: Vec<(String, String, Vec<u32>)> = Vec::new();
        {
            let entries = self.workbooks.entries.borrow();
            // The stamps of workbooks that are gone are forgotten
            self.cached.stamps.borrow_mut().retain(|id, _| entries.iter().any(|entry| entry.id == *id));
            for entry in entries.iter() {
                let Ok(workbook) = entry.workbook.try_borrow() else { continue };
                let Some(stamp) = self.cached_results_stamp(&workbook) else { continue };
                if self.cached.stamps.borrow().get(&entry.id) == Some(&stamp) || self.cached.looking_up.borrow().contains(&entry.id) {
                    continue;
                }
                let keys = workbook.scripts().iter().map(|script| script.key()).collect();
                changed.push((entry.id.clone(), stamp, keys));
            }
        }
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
                        platform.log_on(LogLevel::Debug, "Looking up a cached result failed", &[("key", key.as_str()), ("error", error.message())], super::LOG_TARGET);
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
            // The scripts moved or changed in between: the next check looks them up again
            let current = runs.workbooks.get(&workbook_id).and_then(|workbook| {
                let workbook = workbook.try_borrow().ok()?;
                let keys: Vec<u32> = workbook.scripts().iter().map(|script| script.key()).collect();
                (keys == scripts).then(|| runs.cached_results_stamp(&workbook)).flatten()
            });
            if current.as_ref() == Some(&stamp) {
                runs.cached.stamps.borrow_mut().insert(workbook_id.clone(), stamp);
                for (key, cached) in scripts.into_iter().zip(found) {
                    if let Err(error) = runs.workbooks.apply(&workbook_id, WorkbookAction::SetCachedResult { key, cached }) {
                        runs.log(LogLevel::Debug, "Showing a cached result failed", &[("workbookId", workbook_id.as_str()), ("error", error.what())]);
                    }
                }
            }
            runs.look_up_changed();
        }));
    }
}
