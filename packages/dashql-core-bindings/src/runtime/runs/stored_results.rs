//! The stored results of the scripts of the workbooks (docs/design/workbook_results.md): the script view names the file
//! of the last result of a script, `storedResult` with its key, when it was written and whether the key is the key of
//! the script as it is now; and a workbook that is shown for the first time runs on the embedded Hyper, the scripts of
//! the other connections show their stored results.
//!
//! A workbook is looked up again when what it derives changed (the keys come from its plan; not a move of the cursor,
//! a registered query or the stored results that a lookup showed), when a connection of its scripts changed,
//! when a query of it recorded its result and when a run of it ended. The lookups wait until the changes pause like the
//! analyses of the scripts that the editors show (`background_analysis_delay_ms` of the settings), typing looks the
//! workbook up once. A lookup lists the results folder of the workbook once, plans the keys of the scripts over the
//! files it found and removes the garbage of the folder, unless a run holds the workbook: the run removes it once it
//! ended. A workbook whose analyses are outdated is skipped, it changes again once they are current. A workbook that changes while it is looked up is looked up again afterwards.

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;

use dashql_core_runtime::connections::label::is_hyper_wasm_connection;
use dashql_core_runtime::executor::StoredFile;
use dashql_core_runtime::host::{Host, LocalFuture, LogLevel};
use dashql_core_runtime::workbook::{ScriptStoredResult, WorkbookAction, WorkbookScript};
use dashql_core_runtime::workbook_run::{start_run, PlanRun, RunOptions};

use super::view::WorkbookRunKind;
use super::{HeldRun, Runs};
use crate::runtime::results;

/// What the runtime looks up of the stored results of the workbooks
#[derive(Default)]
pub(crate) struct StoredResults {
    /// The workbooks to look up once the changes paused
    pending: RefCell<BTreeSet<String>>,
    /// The workbooks whose lookup runs
    looking_up: RefCell<BTreeSet<String>>,
    /// Counts the restarts of the pause, a timer of an earlier one does nothing
    generation: Cell<u64>,
    /// The workbooks that were shown and read their stored results
    opened: RefCell<BTreeSet<String>>,
    /// The workbooks that were shown while a run held them, they read their stored results once it ended
    waiting: RefCell<BTreeSet<String>>,
}

impl Runs {
    /// Look up the stored results of workbooks once the changes paused
    pub(crate) fn check_stored_results(self: &Rc<Self>, workbook_ids: &[String]) {
        if self.destroyed.get() || !self.platform.has_results() || workbook_ids.is_empty() {
            return;
        }
        self.stored.pending.borrow_mut().extend(workbook_ids.iter().cloned());
        let generation = self.stored.generation.get() + 1;
        self.stored.generation.set(generation);
        let sleep = self.platform.sleep(self.platform.settings().background_analysis_delay_ms);
        let runs = Rc::downgrade(self);
        self.platform.spawn(Box::pin(async move {
            sleep.await;
            let Some(runs) = runs.upgrade() else { return };
            if runs.stored.generation.get() == generation {
                runs.look_up_pending();
            }
        }));
    }

    /// Start the lookups of the pending workbooks. A workbook whose lookup runs stays pending until it ended.
    fn look_up_pending(self: &Rc<Self>) {
        if self.destroyed.get() {
            return;
        }
        let pending = std::mem::take(&mut *self.stored.pending.borrow_mut());
        for workbook_id in pending {
            if self.stored.looking_up.borrow().contains(&workbook_id) {
                self.stored.pending.borrow_mut().insert(workbook_id);
                continue;
            }
            let Some(scripts) = self.workbooks.get(&workbook_id).and_then(|workbook| {
                let workbook = workbook.try_borrow().ok()?;
                if workbook.scripts().iter().any(WorkbookScript::is_analysis_outdated) {
                    return None;
                }
                Some(workbook.scripts().iter().map(|script| (script.key(), script.file_name().to_string())).collect())
            }) else {
                continue;
            };
            self.look_up(workbook_id, scripts);
        }
    }

    /// Look up the stored results of the scripts of a workbook and show them on the scripts, and remove the garbage of
    /// its results unless a run holds the workbook. The keys follow the listing: the keys downstream of a script cover
    /// its stored file.
    fn look_up(self: &Rc<Self>, workbook_id: String, scripts: Vec<(u32, String)>) {
        self.stored.looking_up.borrow_mut().insert(workbook_id.clone());
        let runs = Rc::downgrade(self);
        let platform = self.platform.clone();
        self.platform.spawn(Box::pin(async move {
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
            // A run of the workbook uses its mount, removing files would make the next use refresh it while the queries
            // of the run use the compute database. The run removes the garbage once it ended (`vacuum`).
            let held = runs
                .upgrade()
                .is_none_or(|runs| runs.read(&workbook_id, |entry| entry.is_some_and(|entry| entry.held.is_some())));
            if let (Some(listing), false) = (&listing, held) {
                results::remove_garbage(&platform, &workbook_id, listing).await;
            }
            let file = |name: &str| listing.as_ref().and_then(|listing| listing.result(name));
            let files: Vec<Option<StoredFile>> = scripts
                .iter()
                .map(|(_, name)| {
                    file(name).map(|result| StoredFile {
                        name: result.name.clone(),
                        key: result.key.clone(),
                        written_at: result.written_at,
                    })
                })
                .collect();
            let keys = runs.upgrade().map(|runs| runs.result_keys(&workbook_id, None, Some(files)));
            let keys = match keys {
                Some(Ok(keys)) => Some(keys.await),
                _ => None,
            };
            let Some(runs) = runs.upgrade() else { return };
            runs.stored.looking_up.borrow_mut().remove(&workbook_id);
            if runs.destroyed.get() {
                return;
            }
            // A workbook that is busy is looked up again
            let Some(keys) = keys else {
                runs.check_stored_results(&[workbook_id]);
                return;
            };
            for (index, (key, name)) in scripts.iter().enumerate() {
                let stored = file(name).map(|result| {
                    // The keys downstream of a script whose connection can't run cover its stored file like in a run,
                    // the stored result of the script itself fits only its own key
                    let current =
                        keys.get(index).and_then(Option::as_ref).is_some_and(|key| key.script_key() == result.key);
                    ScriptStoredResult {
                        name: result.name.clone(),
                        key: result.key.clone(),
                        written_at: result.written_at,
                        current,
                    }
                });
                // A script that is gone meanwhile shows nothing, the workbook is pending again then
                let _ = runs.workbooks.apply(&workbook_id, WorkbookAction::SetStoredResult { key: *key, stored });
            }
            // A change during the lookup looks the workbook up again
            if runs.stored.pending.borrow().contains(&workbook_id) {
                runs.check_stored_results(&[workbook_id]);
            }
        }));
    }

    /// Remove the garbage of the results of a workbook once a run of it ended and its writes are done: the older files
    /// of its scripts, which a run leaves until it ended so that the compute database keeps the files it knows while
    /// the queries of the run use it. Files that are read stay for a later listing.
    pub(crate) fn vacuum(self: &Rc<Self>, workbook_id: &str) -> LocalFuture<()> {
        let names: Option<Vec<String>> = self.workbooks.get(workbook_id).and_then(|workbook| {
            let workbook = workbook.try_borrow().ok()?;
            Some(workbook.scripts().iter().map(|script| script.file_name().to_string()).collect())
        });
        let (Some(names), false, true) = (names, self.destroyed.get(), self.platform.has_results()) else {
            return Box::pin(std::future::ready(()));
        };
        let writes = self.connections.executor().map(|executor| executor.flush_result_writes());
        let platform = self.platform.clone();
        let workbook_id = workbook_id.to_string();
        Box::pin(async move {
            if let Some(writes) = writes {
                writes.await;
            }
            match results::listing(&platform, &workbook_id, Some(&names)).await {
                Ok(listing) => results::remove_garbage(&platform, &workbook_id, &listing).await,
                Err(error) => platform.log_on(
                    LogLevel::Debug,
                    "Listing the stored results of a workbook failed",
                    &[("workbookId", workbook_id.as_str()), ("error", error.message())],
                    results::LOG_TARGET,
                ),
            }
        })
    }

    /// A view shows a workbook. The first time a workbook is shown, it runs on the embedded Hyper and the scripts of
    /// the other connections show their stored results (`open`). A workbook waits while a run holds it or its embedded
    /// Hyper is busy, e.g. connecting, and starts once the run ended or the connection changed.
    pub(crate) fn show_workbook(self: &Rc<Self>, workbook_id: &str) {
        if self.destroyed.get() || !self.platform.has_results() || self.stored.opened.borrow().contains(workbook_id) {
            return;
        }
        if let Some(reason) = self.open_blocker(workbook_id) {
            if self.stored.waiting.borrow_mut().insert(workbook_id.to_string()) {
                self.log(
                    LogLevel::Info,
                    "A shown workbook waits to show its results",
                    &[("workbookId", workbook_id), ("reason", &reason)],
                );
            }
            return;
        }
        self.stored.waiting.borrow_mut().remove(workbook_id);
        self.open(workbook_id);
    }

    /// Start the shown workbooks that wait, once the runs and connections that they waited for are free
    pub(crate) fn open_waiting(self: &Rc<Self>) {
        let waiting: Vec<String> = self.stored.waiting.borrow().iter().cloned().collect();
        for workbook_id in waiting {
            self.show_workbook(&workbook_id);
        }
    }

    /// The connections of the embedded Hyper among the connections of a workbook, whatever their health
    fn embedded(&self, connections: &[String]) -> Vec<String> {
        let registry = self.connections.registry.borrow();
        connections
            .iter()
            .filter(|id| {
                registry.get(id).is_some_and(|connection| {
                    connection.state.try_borrow().is_ok_and(|state| is_hyper_wasm_connection(&state))
                })
            })
            .cloned()
            .collect()
    }

    /// Why a shown workbook can't run now, none if it can: a run holds it or its embedded Hyper
    fn open_blocker(&self, workbook_id: &str) -> Option<String> {
        let scope = self.scope(workbook_id)?;
        self.blocker(workbook_id, &self.embedded(&scope.connections), false)
    }

    /// Show a workbook: an Execute All that runs only on the embedded Hyper and calls no client function. The scripts
    /// of the other connections show their stored results whatever their keys (docs/design/workbook_results.md).
    fn open(self: &Rc<Self>, workbook_id: &str) {
        let Some(scope) = self.scope(workbook_id) else { return };
        self.stored.opened.borrow_mut().insert(workbook_id.to_string());
        if scope.empty {
            return;
        }
        let embedded = self.online(&scope.connections, true);
        self.log(
            LogLevel::Info,
            "Showing a workbook, running it on the embedded Hyper",
            &[("workbookId", workbook_id), ("online", &embedded.join(", "))],
        );
        let host = self.host(&scope, workbook_id, Some(embedded.clone()), None);
        let number = host.number;
        let options = RunOptions {
            run: PlanRun::Workbook,
            targets: None,
            inputs: None,
            refresh: false,
            local: true,
            reports_state: true,
            analyze: true,
        };
        let (handle, run) = start_run(Rc::new(host), scope.workbook.clone(), options);
        self.update(workbook_id, |entry| {
            entry.held = Some(HeldRun {
                kind: WorkbookRunKind::Open,
                number,
                handle: Rc::new(handle),
                connections: embedded.clone(),
                online: embedded,
                inputs: Vec::new(),
            });
        });
        let runs = self.clone();
        let workbook_id = workbook_id.to_string();
        self.platform.spawn(Box::pin(async move {
            let result = run.await;
            if let Some(failure) = &result.failure {
                runs.log(
                    LogLevel::Info,
                    "Showing a workbook failed",
                    &[("workbookId", &workbook_id), ("error", &failure.message)],
                );
            }
            runs.release(&workbook_id, number);
            // The scripts that ran replaced their stored results
            runs.vacuum(&workbook_id).await;
        }));
    }

    /// Forget what the stored results know of a workbook that was deleted or replaced
    pub(crate) fn forget_stored_results(&self, workbook_id: &str) {
        self.stored.pending.borrow_mut().remove(workbook_id);
        self.stored.opened.borrow_mut().remove(workbook_id);
        self.stored.waiting.borrow_mut().remove(workbook_id);
    }
}
