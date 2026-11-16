//! The changes of the runtime that the host takes (docs/design/dashql_runtime.md, "Changes and the flush").
//!
//! A service that changes a slice marks it on the platform where it tells the host (`JsPlatform::changed`), and the
//! host takes only the marked slices: `takeChanges` reads them and nothing else, no change rescans the state. A marked
//! slice moves. Its revision is the revision of its object where it has one (a script, a query, a computation, a run,
//! the storage), which tells the objects of a mark that changed from the others, and a new revision otherwise (a
//! connection, a history, a workbook, the lists). The derived view of a workbook moves when the hash of its buffers
//! changed. Nothing is hashed or compared but these, every change site marks.
//!
//! The queries of a history are marked one by one (`Slice::Query`): a change of a query moves only that query. Its
//! history moves its owner, the connection or the history, and all its queries are compared when the lists of the
//! history changed, a query that started or finished.
//!
//! A slice that is busy, borrowed by a task that runs, is never reported as gone: it stays marked for the next changes
//! and the host is told again. While a slice is busy the releases of handles wait, a view of the last flush may still
//! name them. A host that failed to project a slice asks for it again (`resync`): the slice moves with the next
//! changes even if it didn't change. Changes that failed to cross to the host are reported again with the next ones.

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use dashql_core_runtime::compute::types::TableId;
use dashql_core_runtime::connections::registry::{ConnectionRegistry, QueryOwner};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::query::{QueryExecutionHistory, QueryId};
use dashql_core_runtime::workbook::{next_revision, Workbook};
use serde::{Serialize, Serializer};
use wasm_bindgen::prelude::*;

use super::workbooks::WorkbookEntry;
use super::{
    ChangeSet, Runtime, SliceChange, SliceId, COMPUTATION, CONNECTION, CONNECTION_LIST, HISTORY, QUERY, ROOT, RUN, SCRIPT, STORAGE,
    WORKBOOK, WORKBOOK_DERIVED, WORKBOOK_LIST,
};
use crate::host::HandleEffect;

/// A slice that a service changed
#[derive(Clone, Copy, Debug)]
pub(crate) enum Slice<'a> {
    /// The computations, they keep revisions of their own
    Computations,
    /// The list of the connections
    ConnectionList,
    /// The view of a connection and the list of the connections
    Connection(&'a str),
    /// The view of a history without a connection
    History(&'a str),
    /// The queries of a history: they are compared if its lists changed
    Queries(&'a QueryOwner),
    /// A query of a history, and the queries of the history if its lists changed
    Query(&'a QueryOwner, QueryId),
    /// A workbook with its scripts, what it derives and the list of the workbooks
    Workbook(&'a str),
    /// The scripts of a workbook
    Scripts(&'a str),
    /// What a workbook derives
    Derived(&'a str),
    /// The list of the workbooks
    WorkbookList,
    /// The view of the storage
    Storage,
    /// The runs of the workbooks
    Runs,
}

/// The slices that changed since the host took the changes
#[derive(Default, Debug)]
pub(crate) struct Dirty {
    computations: bool,
    connection_list: bool,
    connections: BTreeSet<String>,
    histories: BTreeSet<String>,
    /// The marked queries by history, a history without queries is compared by its lists only
    queries: BTreeMap<QueryOwner, BTreeSet<QueryId>>,
    workbooks: BTreeSet<String>,
    scripts: BTreeSet<String>,
    derived: BTreeSet<String>,
    workbook_list: bool,
    storage: bool,
    runs: bool,
}

impl Dirty {
    pub fn mark(&mut self, slice: Slice<'_>) {
        match slice {
            Slice::Computations => self.computations = true,
            Slice::ConnectionList => self.connection_list = true,
            Slice::Connection(id) => {
                self.connections.insert(id.to_string());
            }
            Slice::History(name) => {
                self.histories.insert(name.to_string());
            }
            Slice::Queries(owner) => {
                self.queries.entry(owner.clone()).or_default();
            }
            Slice::Query(owner, query_id) => {
                self.queries.entry(owner.clone()).or_default().insert(query_id);
            }
            Slice::Workbook(id) => {
                self.workbooks.insert(id.to_string());
            }
            Slice::Scripts(id) => {
                self.scripts.insert(id.to_string());
            }
            Slice::Derived(id) => {
                self.derived.insert(id.to_string());
            }
            Slice::WorkbookList => self.workbook_list = true,
            Slice::Storage => self.storage = true,
            Slice::Runs => self.runs = true,
        }
    }

    pub fn merge(&mut self, other: Dirty) {
        self.computations |= other.computations;
        self.connection_list |= other.connection_list;
        self.connections.extend(other.connections);
        self.histories.extend(other.histories);
        for (owner, queries) in other.queries {
            self.queries.entry(owner).or_default().extend(queries);
        }
        self.workbooks.extend(other.workbooks);
        self.scripts.extend(other.scripts);
        self.derived.extend(other.derived);
        self.workbook_list |= other.workbook_list;
        self.storage |= other.storage;
        self.runs |= other.runs;
    }

    pub fn is_empty(&self) -> bool {
        !(self.computations || self.connection_list || self.workbook_list || self.storage || self.runs)
            && self.connections.is_empty()
            && self.histories.is_empty()
            && self.queries.is_empty()
            && self.workbooks.is_empty()
            && self.scripts.is_empty()
            && self.derived.is_empty()
    }

    /// Is what a workbook derives marked, so the buffers of the last changes may be outdated?
    pub fn derives(&self, workbook_id: &str) -> bool {
        self.workbooks.contains(workbook_id) || self.derived.contains(workbook_id)
    }

    /// The marks of the connections, the histories and their queries
    fn of_connections(&self) -> Dirty {
        Dirty {
            connection_list: self.connection_list,
            connections: self.connections.clone(),
            histories: self.histories.clone(),
            queries: self.queries.clone(),
            ..Dirty::default()
        }
    }
}

/// What a read of a slice found. It crosses as the view, null for a slice that is gone and `'busy'` for one that a task
/// holds.
pub(crate) enum Read<T> {
    /// The view of the slice
    Value(T),
    /// The slice is gone
    Gone,
    /// The slice is borrowed by a task that runs, it is read again with the next changes
    Busy,
}

impl<T> Read<T> {
    /// The value, none for a slice that is gone or busy
    pub fn value(self) -> Option<T> {
        match self {
            Read::Value(value) => Some(value),
            Read::Gone | Read::Busy => None,
        }
    }
}

/// How a busy slice crosses in the views
pub(crate) const BUSY: &str = "busy";

impl<T: Serialize> Serialize for Read<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Read::Value(view) => view.serialize(serializer),
            Read::Gone => serializer.serialize_none(),
            Read::Busy => serializer.serialize_str(BUSY),
        }
    }
}

/// What a workbook derives as the host took it: the buffers with the names that they refer to
pub(crate) struct DerivedParts {
    /// The checked references, the dataflow and the inputs, packed
    pub buffers: [Vec<u8>; 3],
    /// The keys of the scripts in feed order, the order of the buffers
    pub script_keys: Vec<u32>,
    /// The file names of the scripts in feed order
    pub script_files: Vec<String>,
    /// The file names of the attachments in the order that the references name them
    pub attachments: Vec<String>,
}

/// The derived view of a workbook that the host took, with the hash of its buffers. None forces the next changes to
/// move it.
struct HeldDerived {
    parts: Rc<DerivedParts>,
    hash: Option<u64>,
}

/// The queries of a history that the host took
#[derive(Default)]
struct HeldQueries {
    /// The lists of the history (`snapshot_queries_active_finished`), none compares all queries with the next changes
    lists: Option<u64>,
    /// The revisions of the queries, 0 forces a change
    queries: BTreeMap<QueryId, u64>,
}

/// The slices that the host took
#[derive(Default)]
pub(crate) struct Taken {
    /// The revisions of the computations, 0 forces a change
    computations: BTreeMap<TableId, u64>,
    connections: BTreeSet<String>,
    histories: BTreeSet<String>,
    queries: BTreeMap<QueryOwner, HeldQueries>,
    workbooks: BTreeSet<String>,
    /// The revisions of the scripts of every workbook, 0 forces a change
    scripts: HashMap<String, BTreeMap<u32, u64>>,
    derived: HashMap<String, HeldDerived>,
    /// The revision of the storage, none forces a change
    storage: Option<u64>,
    /// The revisions of the runs of the workbooks, 0 forces a change
    runs: BTreeMap<String, u64>,
    /// The changes of a take that failed to cross to the host, they come with the next changes
    unsent: Vec<SliceChange>,
}

/// The changes of one take by kind. The host projects them in this order, the one order of the kinds.
#[derive(Default)]
struct Changes {
    computations: Vec<SliceChange>,
    connection_list: Vec<SliceChange>,
    connections: Vec<SliceChange>,
    histories: Vec<SliceChange>,
    queries: Vec<SliceChange>,
    workbook_list: Vec<SliceChange>,
    workbooks: Vec<SliceChange>,
    scripts: Vec<SliceChange>,
    derived: Vec<SliceChange>,
    storage: Vec<SliceChange>,
    runs: Vec<SliceChange>,
}

impl Changes {
    /// The changes of a kind
    fn of(&mut self, kind: &str) -> Option<&mut Vec<SliceChange>> {
        Some(match kind {
            COMPUTATION => &mut self.computations,
            CONNECTION_LIST => &mut self.connection_list,
            CONNECTION => &mut self.connections,
            HISTORY => &mut self.histories,
            QUERY => &mut self.queries,
            WORKBOOK_LIST => &mut self.workbook_list,
            WORKBOOK => &mut self.workbooks,
            SCRIPT => &mut self.scripts,
            WORKBOOK_DERIVED => &mut self.derived,
            STORAGE => &mut self.storage,
            RUN => &mut self.runs,
            _ => return None,
        })
    }

    /// The changes in the order of the kinds, the last change of a slice wins
    fn into_vec(self) -> Vec<SliceChange> {
        [
            self.computations,
            self.connection_list,
            self.connections,
            self.histories,
            self.queries,
            self.workbook_list,
            self.workbooks,
            self.scripts,
            self.derived,
            self.storage,
            self.runs,
        ]
        .into_iter()
        .flat_map(|changes| {
            let mut seen: Vec<&SliceId> = Vec::new();
            let mut last: Vec<&SliceChange> = Vec::with_capacity(changes.len());
            for change in changes.iter().rev() {
                if !seen.contains(&&change.id) {
                    seen.push(&change.id);
                    last.push(change);
                }
            }
            last.into_iter().rev().cloned().collect::<Vec<_>>()
        })
        .collect()
    }
}

fn change(kind: &str, id: SliceId, revision: Option<u64>) -> SliceChange {
    SliceChange { kind: kind.into(), id, revision }
}

fn text(id: &str) -> SliceId {
    SliceId::Text(id.to_string())
}

/// Derive the buffers of the derived view of a workbook with the names that they refer to, and their hash
pub(crate) fn derive(workbook: &Workbook) -> (Rc<DerivedParts>, u64) {
    let buffers = workbook.with_planner(|request, sessions| {
        [crate::pack_reference_check(request, sessions, true), crate::pack_dataflow(request, sessions, true), crate::pack_inputs(request)]
    });
    let scripts = workbook.scripts();
    let parts = DerivedParts {
        buffers,
        script_keys: scripts.iter().map(|script| script.key()).collect(),
        script_files: scripts.iter().map(|script| script.file_name().to_string()).collect(),
        attachments: workbook.attachments().unwrap_or_default().iter().map(|attachment| attachment.file_name.clone()).collect(),
    };
    let mut hasher = DefaultHasher::new();
    (&parts.buffers, &parts.script_keys, &parts.script_files, &parts.attachments).hash(&mut hasher);
    (Rc::new(parts), hasher.finish())
}

impl Runtime {
    /// Take the marked slices and the effects on handles
    pub(crate) fn take(&self) -> ChangeSet {
        let dirty = self.platform.take_dirty();
        let Ok(mut taken) = self.taken.try_borrow_mut() else {
            // A take within a take, e.g. from a projection that took the changes again: the outer one goes on
            self.platform.mark_all(dirty);
            self.platform.signal(false);
            return ChangeSet { changes: Vec::new(), effects: Vec::new() };
        };
        let taken = &mut *taken;
        let mut effects = self.platform.take_effects();
        let mut retry = Dirty::default();
        let mut out = Changes::default();
        for unsent in std::mem::take(&mut taken.unsent) {
            if let Some(changes) = out.of(&unsent.kind) {
                changes.push(unsent);
            }
        }
        if dirty.computations {
            self.take_computations(taken, &mut out, &mut retry);
        }
        self.take_connections(&dirty, taken, &mut out, &mut retry);
        self.take_workbooks(&dirty, taken, &mut out, &mut retry);
        if dirty.storage {
            let revision = self.storage.revision();
            if taken.storage != Some(revision) {
                out.storage.push(change(STORAGE, text(ROOT), Some(revision)));
                taken.storage = Some(revision);
            }
        }
        if dirty.runs {
            match self.runs.revisions() {
                Some(runs) => {
                    let runs: BTreeMap<String, u64> = runs.into_iter().collect();
                    for (id, revision) in &runs {
                        if taken.runs.get(id) != Some(revision) {
                            out.runs.push(change(RUN, text(id), Some(*revision)));
                        }
                    }
                    for id in taken.runs.keys().filter(|id| !runs.contains_key(*id)) {
                        out.runs.push(change(RUN, text(id), None));
                    }
                    taken.runs = runs;
                }
                None => retry.runs = true,
            }
        }
        if !retry.is_empty() {
            let details = format!("{retry:?}");
            self.platform.log_on(LogLevel::Warn, "Slices were busy when the host took the changes, they follow with the next changes", &[("slices", &details)], "runtime");
            self.platform.mark_all(retry);
            self.platform.signal(false);
            // A busy slice keeps its view of the last flush, the handles that it names stay until it moved
            let (releases, now): (Vec<HandleEffect>, Vec<HandleEffect>) = effects.into_iter().partition(|effect| matches!(effect, HandleEffect::Release { .. }));
            self.platform.requeue_effects(releases);
            effects = now;
        }
        ChangeSet { changes: out.into_vec(), effects }
    }

    /// Keep the changes of a take that failed to cross to the host, they come with the next changes. Its effects wait
    /// for them.
    pub(crate) fn keep_unsent(&self, changes: ChangeSet) {
        if let Ok(mut taken) = self.taken.try_borrow_mut() {
            let mut unsent = changes.changes;
            unsent.append(&mut taken.unsent);
            taken.unsent = unsent;
        }
        self.platform.requeue_effects(changes.effects);
        self.platform.signal(false);
    }

    /// The computations by their revisions
    fn take_computations(&self, taken: &mut Taken, out: &mut Changes, retry: &mut Dirty) {
        let current: Option<BTreeMap<TableId, u64>> =
            self.computations.try_read(|state| state.computations().map(|(id, computation)| (id, computation.revision())).collect());
        let Some(current) = current else {
            retry.computations = true;
            return;
        };
        for (id, revision) in &current {
            if taken.computations.get(id) != Some(revision) {
                out.computations.push(change(COMPUTATION, SliceId::Number(*id), Some(*revision)));
            }
        }
        for id in taken.computations.keys().filter(|id| !current.contains_key(*id)) {
            out.computations.push(change(COMPUTATION, SliceId::Number(*id), None));
        }
        taken.computations = current;
    }

    /// The marked connections, histories and queries, and the list of the connections
    fn take_connections(&self, dirty: &Dirty, taken: &mut Taken, out: &mut Changes, retry: &mut Dirty) {
        let marked = dirty.connection_list || !dirty.connections.is_empty() || !dirty.histories.is_empty() || !dirty.queries.is_empty();
        if !marked {
            return;
        }
        let Ok(registry) = self.connections.registry.try_borrow() else {
            retry.merge(dirty.of_connections());
            return;
        };
        let list = dirty.connection_list || !dirty.connections.is_empty();
        let mut connections = dirty.connections.clone();
        let mut histories = dirty.histories.clone();
        // The queries first: a history whose lists changed moves its owner
        for (owner, marked) in &dirty.queries {
            let history = registry.history(owner);
            match take_queries(taken, owner, history.as_deref(), marked, &mut out.queries) {
                Some(true) => match owner {
                    QueryOwner::Connection(id) => {
                        connections.insert(id.clone());
                    }
                    QueryOwner::History(name) => {
                        histories.insert(name.clone());
                    }
                },
                Some(false) => {}
                None => {
                    retry.queries.insert(owner.clone(), marked.clone());
                }
            }
        }
        for id in &connections {
            take_owner(&registry, taken, &QueryOwner::Connection(id.clone()), out);
        }
        for name in &histories {
            take_owner(&registry, taken, &QueryOwner::History(name.clone()), out);
        }
        if list {
            out.connection_list.push(change(CONNECTION_LIST, text(ROOT), Some(next_revision())));
        }
    }

    /// The marked workbooks with their scripts and what they derive, and the list of the workbooks
    fn take_workbooks(&self, dirty: &Dirty, taken: &mut Taken, out: &mut Changes, retry: &mut Dirty) {
        let marked = dirty.workbook_list || !dirty.workbooks.is_empty() || !dirty.scripts.is_empty() || !dirty.derived.is_empty();
        if !marked {
            return;
        }
        let Ok(entries) = self.workbooks.entries.try_borrow() else {
            retry.merge(Dirty {
                workbooks: dirty.workbooks.clone(),
                scripts: dirty.scripts.clone(),
                derived: dirty.derived.clone(),
                workbook_list: dirty.workbook_list,
                ..Dirty::default()
            });
            return;
        };
        let ids: BTreeSet<&String> = dirty.workbooks.iter().chain(&dirty.scripts).chain(&dirty.derived).collect();
        let mut list = dirty.workbook_list;
        for id in ids {
            let whole = dirty.workbooks.contains(id);
            list |= whole;
            let Some(entry) = entries.iter().find(|entry| entry.id == *id) else {
                // The workbook went with its scripts and what it derived
                if taken.workbooks.remove(id) {
                    out.workbooks.push(change(WORKBOOK, text(id), None));
                }
                for key in taken.scripts.remove(id).unwrap_or_default().into_keys() {
                    out.scripts.push(change(SCRIPT, SliceId::Number(key.into()), None));
                }
                if taken.derived.remove(id).is_some() {
                    out.derived.push(change(WORKBOOK_DERIVED, text(id), None));
                }
                continue;
            };
            let Ok(workbook) = entry.workbook.try_borrow() else {
                retry.mark(if whole { Slice::Workbook(id) } else { Slice::Scripts(id) });
                if dirty.derived.contains(id) {
                    retry.mark(Slice::Derived(id));
                }
                continue;
            };
            if whole {
                out.workbooks.push(change(WORKBOOK, text(id), Some(next_revision())));
                taken.workbooks.insert(id.clone());
            }
            if whole || dirty.scripts.contains(id) {
                self.take_scripts(entry, &workbook, taken, out);
            }
            if whole || dirty.derived.contains(id) {
                let (parts, hash) = derive(&workbook);
                let held = taken.derived.insert(id.clone(), HeldDerived { parts, hash: Some(hash) });
                if held.is_none_or(|held| held.hash != Some(hash)) {
                    out.derived.push(change(WORKBOOK_DERIVED, text(id), Some(next_revision())));
                }
            }
        }
        if list {
            out.workbook_list.push(change(WORKBOOK_LIST, text(ROOT), Some(next_revision())));
        }
    }

    /// The scripts of a workbook by their revisions
    fn take_scripts(&self, entry: &WorkbookEntry, workbook: &Workbook, taken: &mut Taken, out: &mut Changes) {
        let held = taken.scripts.entry(entry.id.clone()).or_default();
        let mut current = BTreeMap::new();
        for script in workbook.scripts() {
            let (key, revision) = (script.key(), script.revision());
            if held.remove(&key) != Some(revision) {
                out.scripts.push(change(SCRIPT, SliceId::Number(key.into()), Some(revision)));
            }
            current.insert(key, revision);
        }
        for key in std::mem::replace(held, current).into_keys() {
            out.scripts.push(change(SCRIPT, SliceId::Number(key.into()), None));
        }
        self.workbooks.index_scripts(&entry.id, workbook);
    }

    /// The derived view of a workbook: the buffers of the last changes unless the workbook changed since
    pub(crate) fn derived_parts(&self, workbook_id: &str) -> Read<Rc<DerivedParts>> {
        let current = !self.platform.dirty(|dirty| dirty.derives(workbook_id));
        if current {
            if let Ok(taken) = self.taken.try_borrow() {
                if let Some(held) = taken.derived.get(workbook_id) {
                    return Read::Value(held.parts.clone());
                }
            }
        }
        let workbook = match self.workbooks.try_get(workbook_id) {
            Read::Value(workbook) => workbook,
            Read::Gone => return Read::Gone,
            Read::Busy => return Read::Busy,
        };
        let Ok(workbook) = workbook.try_borrow() else { return Read::Busy };
        Read::Value(derive(&workbook).0)
    }

    /// The host failed to project slices: they move with the next changes, also if they didn't change
    pub(crate) fn resync_slices(&self, kind: &str, ids: &[JsValue]) -> Result<(), JsError> {
        let Ok(mut taken) = self.taken.try_borrow_mut() else { return Err(JsError::new("the runtime takes the changes")) };
        let text_ids = || ids.iter().filter_map(JsValue::as_string);
        let number_ids = || ids.iter().filter_map(JsValue::as_f64).map(|id| id as u64);
        match kind {
            COMPUTATION => {
                for id in number_ids() {
                    if let Some(revision) = taken.computations.get_mut(&id) {
                        *revision = 0;
                    }
                }
                self.platform.mark(Slice::Computations);
            }
            CONNECTION_LIST => self.platform.mark(Slice::ConnectionList),
            CONNECTION => {
                for id in text_ids() {
                    self.platform.mark(Slice::Connection(&id));
                }
            }
            HISTORY => {
                for name in text_ids() {
                    self.platform.mark(Slice::History(&name));
                }
            }
            QUERY => {
                for id in number_ids() {
                    let owner = taken.queries.iter_mut().find(|(_, held)| held.queries.contains_key(&id));
                    if let Some((owner, held)) = owner {
                        held.queries.insert(id, 0);
                        self.platform.mark(Slice::Query(owner, id));
                    }
                }
            }
            WORKBOOK_LIST => self.platform.mark(Slice::WorkbookList),
            WORKBOOK => {
                for id in text_ids() {
                    self.platform.mark(Slice::Workbook(&id));
                }
            }
            SCRIPT => {
                for key in number_ids() {
                    let Ok(key) = u32::try_from(key) else { continue };
                    let workbook = taken.scripts.iter_mut().find(|(_, scripts)| scripts.contains_key(&key));
                    if let Some((workbook_id, scripts)) = workbook {
                        scripts.insert(key, 0);
                        self.platform.mark(Slice::Scripts(workbook_id));
                    }
                }
            }
            WORKBOOK_DERIVED => {
                for id in text_ids() {
                    if let Some(held) = taken.derived.get_mut(&id) {
                        held.hash = None;
                    }
                    self.platform.mark(Slice::Derived(&id));
                }
            }
            STORAGE => {
                taken.storage = None;
                self.platform.mark(Slice::Storage);
            }
            RUN => {
                for id in text_ids() {
                    if let Some(revision) = taken.runs.get_mut(&id) {
                        *revision = 0;
                    }
                }
                self.platform.mark(Slice::Runs);
            }
            _ => return Err(JsError::new(&format!("the runtime has no views of the kind {kind}"))),
        }
        drop(taken);
        self.platform.signal(false);
        Ok(())
    }
}

/// The view of the owner of a history, the connection or the history: moved, or gone with the queries of its history
fn take_owner(registry: &ConnectionRegistry, taken: &mut Taken, owner: &QueryOwner, out: &mut Changes) {
    let (kind, id, held, changes) = match owner {
        QueryOwner::Connection(id) => (CONNECTION, id, &mut taken.connections, &mut out.connections),
        QueryOwner::History(name) => (HISTORY, name, &mut taken.histories, &mut out.histories),
    };
    if registry.history(owner).is_some() {
        changes.push(change(kind, text(id), Some(next_revision())));
        held.insert(id.clone());
        return;
    }
    if held.remove(id) {
        changes.push(change(kind, text(id), None));
    }
    for query_id in taken.queries.remove(owner).unwrap_or_default().queries.into_keys() {
        out.queries.push(change(QUERY, SliceId::Number(query_id), None));
    }
}

/// The marked queries of a history by their revisions, all of them if the lists of the history changed. A history
/// that is gone takes its queries with it. Some(true) if the lists changed, none if the history is busy.
fn take_queries(
    taken: &mut Taken,
    owner: &QueryOwner,
    history: Option<&std::cell::RefCell<QueryExecutionHistory>>,
    marked: &BTreeSet<QueryId>,
    out: &mut Vec<SliceChange>,
) -> Option<bool> {
    let Some(history) = history else {
        for query_id in taken.queries.remove(owner).unwrap_or_default().queries.into_keys() {
            out.push(change(QUERY, SliceId::Number(query_id), None));
        }
        return Some(true);
    };
    let history = history.try_borrow().ok()?;
    let held = taken.queries.entry(owner.clone()).or_default();
    let lists = history.snapshot_queries_active_finished();
    if held.lists == Some(lists) {
        for query_id in marked {
            let Some(query) = history.query(*query_id) else { continue };
            if held.queries.insert(*query_id, query.revision) != Some(query.revision) {
                out.push(change(QUERY, SliceId::Number(*query_id), Some(query.revision)));
            }
        }
        return Some(false);
    }
    let mut current = BTreeMap::new();
    for query_id in history.active_ids().iter().chain(history.finished_ids()) {
        let Some(query) = history.query(*query_id) else { continue };
        if held.queries.remove(query_id) != Some(query.revision) {
            out.push(change(QUERY, SliceId::Number(*query_id), Some(query.revision)));
        }
        current.insert(*query_id, query.revision);
    }
    for query_id in std::mem::replace(&mut held.queries, current).into_keys() {
        out.push(change(QUERY, SliceId::Number(query_id), None));
    }
    held.lists = Some(lists);
    Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_merge_and_tell_what_a_workbook_derives() {
        let mut dirty = Dirty::default();
        assert!(dirty.is_empty());
        dirty.mark(Slice::Scripts("w"));
        assert!(!dirty.is_empty());
        assert!(!dirty.derives("w"));
        let mut other = Dirty::default();
        other.mark(Slice::Derived("w"));
        other.mark(Slice::Workbook("v"));
        other.mark(Slice::Storage);
        let owner = QueryOwner::History("shell".into());
        other.mark(Slice::Query(&owner, 7));
        other.mark(Slice::Queries(&owner));
        dirty.merge(other);
        assert!(dirty.derives("w") && dirty.derives("v") && !dirty.derives("u"));
        assert!(dirty.storage && dirty.scripts.contains("w"));
        assert_eq!(dirty.queries.get(&owner).map(|queries| queries.iter().copied().collect::<Vec<_>>()), Some(vec![7]));
    }

    #[test]
    fn changes_come_in_the_order_of_the_kinds_with_the_last_change_of_a_slice() {
        let mut changes = Changes::default();
        changes.derived.push(change(WORKBOOK_DERIVED, text("w"), Some(3)));
        changes.scripts.push(change(SCRIPT, SliceId::Number(1), Some(2)));
        changes.workbooks.push(change(WORKBOOK, text("w"), Some(1)));
        changes.connections.push(change(CONNECTION, text("c"), None));
        // A change that failed to cross and the one of the next take
        changes.scripts.push(change(SCRIPT, SliceId::Number(4), Some(5)));
        changes.scripts.push(change(SCRIPT, SliceId::Number(1), None));
        let changes: Vec<(String, Option<u64>)> = changes.into_vec().into_iter().map(|change| (change.kind, change.revision)).collect();
        let expected: Vec<(String, Option<u64>)> = [(CONNECTION, None), (WORKBOOK, Some(1)), (SCRIPT, Some(5)), (SCRIPT, None), (WORKBOOK_DERIVED, Some(3))]
            .into_iter()
            .map(|(kind, revision)| (kind.to_string(), revision))
            .collect();
        assert_eq!(changes, expected);
    }
}
