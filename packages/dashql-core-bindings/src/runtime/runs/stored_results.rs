//! The stored results of the scripts of the workbooks (docs/design/workbook_results.md): the script view names the file
//! of the last result of a script, `storedResult` with its key, when it was written and whether the key is the key of
//! the script as it is now; and a workbook that is shown for the first time reads the stored results of its scripts.
//!
//! A workbook is looked up again when what the keys of its scripts depend on changed: the analyses of its scripts, its
//! attachments, the connections the scripts run on and their params, and the latest queries of the scripts with the
//! keys of their results. A move of the cursor changes none of them. The end of a run of the workbook looks it up again,
//! it wrote the files of its scripts. A workbook whose analyses are outdated keeps what it shows until they are current
//! again.
//!
//! The checks wait until the changes pause like the analyses of the scripts that the editors show
//! (`background_analysis_delay_ms` of the settings), typing looks the workbook up once. A check compares the stamp of
//! what the keys depend on and looks up only a workbook whose stamp moved: one lookup per workbook at a time, it plans
//! the keys of the scripts once and lists the results folder of the workbook once. The lookup also removes the garbage
//! of the folder.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::rc::Rc;

use dashql_core_runtime::executor::QueryId;
use dashql_core_runtime::host::{Host, LogLevel};
use dashql_core_runtime::workbook::{ScriptStoredResult, Workbook, WorkbookAction, WorkbookScript};
use dashql_core_runtime::workbook_run::{start_run, PlanRun, RunOptions};

use super::view::WorkbookRunKind;
use super::{HeldRun, Runs};
use crate::runtime::results;
use crate::runtime::workbooks::WorkbookEntry;

/// What the runtime looked up for the workbooks
#[derive(Default)]
pub(crate) struct StoredResults {
    /// The stamp of what the stored results of a workbook were looked up for, by workbook
    stamps: RefCell<BTreeMap<String, String>>,
    /// The workbooks whose lookup runs
    looking_up: RefCell<BTreeSet<String>>,
    /// The workbooks to check once the changes paused
    pending: RefCell<BTreeSet<String>>,
    /// Is every workbook checked once the changes paused?
    all: Cell<bool>,
    /// Counts the restarts of the pause, a timer of an earlier one does nothing
    generation: Cell<u64>,
    /// The workbooks that were shown and read their stored results
    opened: RefCell<BTreeSet<String>>,
    /// The workbooks that were shown while a run held them, they read their stored results once it ended
    waiting: RefCell<BTreeSet<String>>,
}

impl Runs {
    /// Check the stored results of a workbook, of every workbook without one, once the changes paused
    pub(crate) fn check_stored_results(self: &Rc<Self>, workbook_id: Option<&str>) {
        if self.destroyed.get() || !self.platform.has_results() {
            return;
        }
        match workbook_id {
            Some(id) => {
                self.stored.pending.borrow_mut().insert(id.to_string());
            }
            None => self.stored.all.set(true),
        }
        let generation = self.stored.generation.get() + 1;
        self.stored.generation.set(generation);
        let sleep = self.platform.sleep(self.platform.settings().background_analysis_delay_ms);
        let runs = Rc::downgrade(self);
        self.platform.spawn(Box::pin(async move {
            sleep.await;
            let Some(runs) = runs.upgrade() else { return };
            if runs.stored.generation.get() == generation {
                runs.look_up_changed();
            }
        }));
    }

    /// Check the stored results of workbooks. After their files changed, every one of them is looked up again.
    pub(crate) fn check_workbooks_stored_results(self: &Rc<Self>, workbook_ids: &[String], files: bool) {
        if files {
            self.stored.stamps.borrow_mut().retain(|id, _| !workbook_ids.contains(id));
        }
        for workbook_id in workbook_ids {
            self.check_stored_results(Some(workbook_id));
        }
    }

    /// The stamp of what the keys of the scripts of a workbook depend on, none while an analysis is outdated
    fn stored_results_stamp(&self, workbook: &Workbook) -> Option<String> {
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
            let _ =
                write!(stamp, "{}:{}:{}:{}", script.key(), script.file_name(), connection_id, script.analysis_serial());
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
        // The keys of a connection depend on its params and whether it reuses results
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
        let all = self.stored.all.replace(false);
        let mut pending = std::mem::take(&mut *self.stored.pending.borrow_mut());
        let mut changed: Vec<(String, String, Vec<(u32, String)>)> = Vec::new();
        {
            let entries = self.workbooks.entries.borrow();
            // The stamps of workbooks that are gone are forgotten
            self.stored.stamps.borrow_mut().retain(|id, _| entries.iter().any(|entry| entry.id == *id));
            let checked: Vec<&WorkbookEntry> =
                entries.iter().filter(|entry| all || pending.contains(&entry.id)).collect();
            for entry in checked {
                // A workbook whose lookup runs is checked again once it ended
                if self.stored.looking_up.borrow().contains(&entry.id) {
                    pending.insert(entry.id.clone());
                    continue;
                }
                pending.remove(&entry.id);
                // A workbook that a run holds is checked with the next change of the run
                let Ok(workbook) = entry.workbook.try_borrow() else { continue };
                let Some(stamp) = self.stored_results_stamp(&workbook) else { continue };
                if self.stored.stamps.borrow().get(&entry.id) == Some(&stamp) {
                    continue;
                }
                let scripts =
                    workbook.scripts().iter().map(|script| (script.key(), script.file_name().to_string())).collect();
                changed.push((entry.id.clone(), stamp, scripts));
            }
            pending.retain(|id| entries.iter().any(|entry| entry.id == *id));
        }
        self.stored.pending.borrow_mut().extend(pending);
        for (workbook_id, stamp, scripts) in changed {
            self.look_up(workbook_id, stamp, scripts);
        }
    }

    /// Look up the stored results of the scripts of a workbook and show them on the scripts, then remove the garbage of
    /// its results
    fn look_up(self: &Rc<Self>, workbook_id: String, stamp: String, scripts: Vec<(u32, String)>) {
        // A busy workbook is looked up with its next change
        let Ok(keys) = self.result_keys(&workbook_id, None) else { return };
        self.stored.looking_up.borrow_mut().insert(workbook_id.clone());
        let runs = Rc::downgrade(self);
        let platform = self.platform.clone();
        self.platform.spawn(Box::pin(async move {
            let keys = keys.await;
            let names: Vec<String> = scripts.iter().map(|(_, name)| name.clone()).collect();
            let listing = match results::listing(&platform, &workbook_id, Some(&names)).await {
                Ok(listing) => Some(listing),
                Err(error) => {
                    platform.log_on(
                        LogLevel::Debug,
                        "Listing the stored results of a workbook failed",
                        &[("workbookId", workbook_id.as_str()), ("error", error.message())],
                        results::LOG_TARGET,
                    );
                    None
                }
            };
            if let Some(listing) = &listing {
                results::remove_garbage(&platform, &workbook_id, listing).await;
            }
            let found: Vec<Option<ScriptStoredResult>> = scripts
                .iter()
                .zip(keys.iter().map(Some).chain(std::iter::repeat(None)))
                .map(|((_, name), key)| {
                    let result = listing.as_ref()?.result(name)?;
                    let current = key.and_then(Option::as_ref).is_some_and(|key| key.key == result.key);
                    Some(ScriptStoredResult {
                        name: result.name.clone(),
                        key: result.key.clone(),
                        written_at: result.written_at,
                        current,
                    })
                })
                .collect();
            let Some(runs) = runs.upgrade() else { return };
            runs.stored.looking_up.borrow_mut().remove(&workbook_id);
            if runs.destroyed.get() {
                return;
            }
            // The scripts moved or changed in between: the check below looks them up again
            let keys_of_scripts: Vec<u32> = scripts.iter().map(|(key, _)| *key).collect();
            let current = runs.workbooks.get(&workbook_id).and_then(|workbook| {
                let workbook = workbook.try_borrow().ok()?;
                let keys: Vec<u32> = workbook.scripts().iter().map(|script| script.key()).collect();
                (keys == keys_of_scripts).then(|| runs.stored_results_stamp(&workbook)).flatten()
            });
            if current.as_ref() == Some(&stamp) {
                runs.stored.stamps.borrow_mut().insert(workbook_id.clone(), stamp);
                for (key, stored) in keys_of_scripts.into_iter().zip(found) {
                    if let Err(error) =
                        runs.workbooks.apply(&workbook_id, WorkbookAction::SetStoredResult { key, stored })
                    {
                        runs.log(
                            LogLevel::Debug,
                            "Showing a stored result failed",
                            &[("workbookId", workbook_id.as_str()), ("error", error.what())],
                        );
                    }
                }
            }
            runs.check_stored_results(Some(&workbook_id));
        }));
    }

    /// A view shows a workbook. The first time a workbook is shown, the runtime reads the stored results of its scripts
    /// that show no result yet; a workbook that a run holds reads them once the run ended.
    pub(crate) fn show_workbook(self: &Rc<Self>, workbook_id: &str) {
        if self.destroyed.get() || !self.platform.has_results() || self.stored.opened.borrow().contains(workbook_id) {
            return;
        }
        if self.read(workbook_id, |entry| entry.is_some_and(|entry| entry.held.is_some())) {
            self.stored.waiting.borrow_mut().insert(workbook_id.to_string());
            return;
        }
        self.open(workbook_id);
    }

    /// A run of a workbook ended, a workbook that was shown meanwhile reads its stored results
    pub(crate) fn open_waiting(self: &Rc<Self>, workbook_id: &str) {
        if self.stored.waiting.borrow_mut().remove(workbook_id) {
            self.show_workbook(workbook_id);
        }
    }

    /// Read the stored results of a workbook: a run that runs nothing and reads the file of every script that shows no
    /// result yet, whatever its key
    fn open(self: &Rc<Self>, workbook_id: &str) {
        let Some(scope) = self.scope(workbook_id) else { return };
        self.stored.opened.borrow_mut().insert(workbook_id.to_string());
        if scope.empty {
            return;
        }
        self.log(LogLevel::Info, "Reading the stored results of a workbook", &[("workbookId", workbook_id)]);
        let host = self.host(&scope, workbook_id, Some(Vec::new()), None);
        let number = host.number;
        let options = RunOptions {
            run: PlanRun::Workbook,
            targets: None,
            inputs: None,
            refresh: false,
            stored: true,
            reports_state: false,
            analyze: true,
        };
        let (handle, run) = start_run(Rc::new(host), scope.workbook.clone(), options);
        self.update(workbook_id, |entry| {
            entry.held = Some(HeldRun {
                kind: WorkbookRunKind::Open,
                number,
                handle: Rc::new(handle),
                connections: Vec::new(),
                online: Vec::new(),
            });
        });
        let runs = self.clone();
        let workbook_id = workbook_id.to_string();
        self.platform.spawn(Box::pin(async move {
            let result = run.await;
            if let Some(failure) = &result.failure {
                runs.log(
                    LogLevel::Info,
                    "Reading the stored results of a workbook failed",
                    &[("workbookId", &workbook_id), ("error", &failure.message)],
                );
            }
            runs.release(&workbook_id, number);
        }));
    }

    /// Forget what the stored results know of a workbook that was deleted or replaced
    pub(crate) fn forget_stored_results(&self, workbook_id: &str) {
        self.stored.stamps.borrow_mut().remove(workbook_id);
        self.stored.opened.borrow_mut().remove(workbook_id);
        self.stored.waiting.borrow_mut().remove(workbook_id);
    }
}
