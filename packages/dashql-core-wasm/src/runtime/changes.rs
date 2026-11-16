//! The changes of the runtime that the host takes (docs/design/dashql_runtime.md, "Changes and the flush").
//!
//! A service that changes a slice marks it on the platform where it tells the host (`JsPlatform::changed`), and the
//! host takes only the marked slices: `takeChanges` reads them and nothing else, no change rescans the state. A marked
//! slice moves when its view changed: the slices of the views that the runtime builds from several objects (a
//! connection, a history, a workbook, the lists) compare the hash of their serialized views (`views::view_hash`), the
//! slices of single objects compare the revisions of their objects (a script, a query, a computation, a run, the
//! storage), and the derived view of a workbook compares the hash of its derived buffers. No key is written by hand.
//!
//! A slice that is busy, borrowed by a task that runs, is never reported as gone: it stays marked for the next changes
//! and the host is told again. A host that failed to project a slice asks for it again (`resync`): the slice moves with
//! the next changes even if its view didn't change.

use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use dashql_core_runtime::compute::types::TableId;
use dashql_core_runtime::connections::registry::{ListedConnection, QueryOwner};
use dashql_core_runtime::host::LogLevel;
use dashql_core_runtime::query::{QueryExecutionHistory, QueryId};
use dashql_core_runtime::workbook::{next_revision, Workbook};
use wasm_bindgen::prelude::*;

use super::workbooks::{workbook_view, WorkbookEntry};
use super::{
    ChangeSet, Runtime, SliceChange, SliceId, COMPUTATION, CONNECTION, CONNECTION_LIST, HISTORY, QUERY, ROOT, RUN, SCRIPT, STORAGE,
    WORKBOOK, WORKBOOK_DERIVED, WORKBOOK_LIST,
};
use crate::query_history::view::QueryHistoryView;
use crate::views::view_hash;

/// A slice that a service changed
#[derive(Clone, Copy, Debug)]
pub(crate) enum Slice<'a> {
    /// The computations, they keep revisions of their own
    Computations,
    /// The list of the connections
    ConnectionList,
    /// A connection with the queries of its history and the list of the connections
    Connection(&'a str),
    /// Every connection and every history, e.g. when the workbooks that use them changed
    Connections,
    /// A history without a connection with its queries
    History(&'a str),
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
    all_connections: bool,
    connections: BTreeSet<String>,
    histories: BTreeSet<String>,
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
            Slice::Connections => self.all_connections = true,
            Slice::History(name) => {
                self.histories.insert(name.to_string());
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
        self.all_connections |= other.all_connections;
        self.connections.extend(other.connections);
        self.histories.extend(other.histories);
        self.workbooks.extend(other.workbooks);
        self.scripts.extend(other.scripts);
        self.derived.extend(other.derived);
        self.workbook_list |= other.workbook_list;
        self.storage |= other.storage;
        self.runs |= other.runs;
    }

    pub fn is_empty(&self) -> bool {
        !(self.computations || self.connection_list || self.all_connections || self.workbook_list || self.storage || self.runs)
            && self.connections.is_empty()
            && self.histories.is_empty()
            && self.workbooks.is_empty()
            && self.scripts.is_empty()
            && self.derived.is_empty()
    }

    /// Is what a workbook derives marked, so the buffers of the last changes may be outdated?
    pub fn derives(&self, workbook_id: &str) -> bool {
        self.workbooks.contains(workbook_id) || self.derived.contains(workbook_id)
    }
}

/// What a read of a slice found
pub(crate) enum Read<T> {
    /// The view of the slice
    Value(T),
    /// The slice is gone
    Gone,
    /// The slice is borrowed by a task that runs, it is read again with the next changes
    Busy,
}

/// A slice that the host took: the hash of its view, none forces the next changes to move it, and its revision
#[derive(Clone, Copy)]
struct Held {
    hash: Option<u64>,
    revision: u64,
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

/// The derived view of a workbook that the host took
struct HeldDerived {
    parts: Rc<DerivedParts>,
    held: Held,
}

/// The slices that the host took
#[derive(Default)]
pub(crate) struct Taken {
    /// The revisions of the computations, 0 forces a change
    computations: BTreeMap<TableId, u64>,
    list: Option<(Vec<ListedConnection>, u64)>,
    connections: HashMap<String, Held>,
    histories: HashMap<String, Held>,
    /// The queries of every history: the revision of the history, 0 forces a scan, and the revisions of its queries
    queries: BTreeMap<QueryOwner, (u64, BTreeMap<QueryId, u64>)>,
    workbook_list: Option<Held>,
    workbooks: HashMap<String, Held>,
    /// The revisions of the scripts of every workbook, 0 forces a change
    scripts: HashMap<String, BTreeMap<u32, u64>>,
    derived: HashMap<String, HeldDerived>,
    /// The revision of the storage, none forces a change
    storage: Option<(u64, u64)>,
    /// The revisions of the runs of the workbooks, 0 forces a change
    runs: BTreeMap<String, u64>,
}

/// The changes of one take by kind, the host projects the kinds in this order
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
        .flatten()
        .collect()
    }
}

fn change(kind: &str, id: SliceId, revision: Option<u64>) -> SliceChange {
    SliceChange { kind: kind.into(), id, revision }
}

fn text(id: &str) -> SliceId {
    SliceId::Text(id.to_string())
}

/// Compare the hash of a view with the one that the host took, returns the change if the slice moves
fn compare(held: Option<&mut Held>, hash: Option<u64>) -> Option<u64> {
    match held {
        Some(held) if held.hash.is_some() && held.hash == hash => None,
        Some(held) => {
            held.hash = hash;
            held.revision = next_revision();
            Some(held.revision)
        }
        None => Some(next_revision()),
    }
}

/// Take a slice that is compared by the hash of its view: moved, gone or busy
fn take_hashed<T: serde::Serialize>(held: &mut HashMap<String, Held>, id: &str, read: Read<T>, kind: &str, out: &mut Vec<SliceChange>) -> bool {
    match read {
        Read::Value(view) => {
            let hash = view_hash(&view);
            let moved = match held.get_mut(id) {
                Some(entry) => compare(Some(entry), hash),
                None => {
                    let revision = next_revision();
                    held.insert(id.to_string(), Held { hash, revision });
                    Some(revision)
                }
            };
            if let Some(revision) = moved {
                out.push(change(kind, text(id), Some(revision)));
            }
            true
        }
        Read::Gone => {
            if held.remove(id).is_some() {
                out.push(change(kind, text(id), None));
            }
            true
        }
        Read::Busy => false,
    }
}

/// Derive the buffers of the derived view of a workbook with the names that they refer to, and their hash
pub(crate) fn derive(workbook: &Workbook) -> (Rc<DerivedParts>, Option<u64>) {
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
    // The bytes hash as they are, a view hash would write every byte as JSON
    let mut hasher = DefaultHasher::new();
    (&parts.buffers, &parts.script_keys, &parts.script_files, &parts.attachments).hash(&mut hasher);
    (Rc::new(parts), Some(hasher.finish()))
}

impl Runtime {
    /// Take the marked slices and the effects on handles
    pub(crate) fn take(&self) -> ChangeSet {
        let effects = self.platform.take_effects();
        let dirty = self.platform.take_dirty();
        let mut retry = Dirty::default();
        let mut out = Changes::default();
        let Ok(mut taken) = self.taken.try_borrow_mut() else {
            // A take within a take, e.g. from a projection that took the changes again: the outer one goes on
            self.platform.mark_all(dirty);
            self.platform.signal(false);
            return ChangeSet { changes: Vec::new(), effects };
        };
        let taken = &mut *taken;
        if dirty.computations {
            self.take_computations(taken, &mut out);
        }
        self.take_connections(&dirty, taken, &mut out, &mut retry);
        self.take_workbooks(&dirty, taken, &mut out, &mut retry);
        if dirty.storage {
            let revision = self.storage.revision();
            if taken.storage.map(|(taken, _)| taken) != Some(revision) {
                let slice = next_revision();
                out.storage.push(change(STORAGE, text(ROOT), Some(slice)));
                taken.storage = Some((revision, slice));
            }
        }
        if dirty.runs {
            let runs: BTreeMap<String, u64> = self.runs.revisions().into_iter().collect();
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
        if !retry.is_empty() {
            let details = format!("{retry:?}");
            self.platform.log_on(LogLevel::Warn, "Slices were busy when the host took the changes, they follow with the next changes", &[("slices", &details)], "runtime");
            self.platform.mark_all(retry);
            self.platform.signal(false);
        }
        ChangeSet { changes: out.into_vec(), effects }
    }

    /// The computations by their revisions
    fn take_computations(&self, taken: &mut Taken, out: &mut Changes) {
        let current: BTreeMap<TableId, u64> =
            self.computations.read(|state| state.computations().map(|(id, computation)| (id, computation.revision())).collect());
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

    /// The marked connections and histories with their queries, and the list of the connections
    fn take_connections(&self, dirty: &Dirty, taken: &mut Taken, out: &mut Changes, retry: &mut Dirty) {
        let marked = dirty.all_connections || dirty.connection_list || !dirty.connections.is_empty() || !dirty.histories.is_empty();
        if !marked {
            return;
        }
        let Ok(registry) = self.connections.registry.try_borrow() else {
            retry.all_connections = true;
            return;
        };
        let mut connections = dirty.connections.clone();
        let mut histories = dirty.histories.clone();
        if dirty.all_connections {
            connections.extend(registry.connections().map(|(id, _)| id.to_string()));
            connections.extend(taken.connections.keys().cloned());
            histories.extend(registry.histories().map(|(name, _)| name.to_string()));
            histories.extend(taken.histories.keys().cloned());
        }
        for id in &connections {
            let read = self.connections.view(&registry, id);
            if !take_hashed(&mut taken.connections, id, read, CONNECTION, &mut out.connections) {
                retry.mark(Slice::Connection(id));
                continue;
            }
            let owner = QueryOwner::Connection(id.clone());
            let history = registry.get(id).map(|connection| connection.queries.clone());
            if !take_queries(taken, owner, history.as_deref(), &mut out.queries) {
                retry.mark(Slice::Connection(id));
            }
        }
        for name in &histories {
            let owner = QueryOwner::History(name.clone());
            let history = registry.history(&owner);
            let read = match &history {
                Some(history) => match history.try_borrow() {
                    Ok(history) => Read::Value(QueryHistoryView::from(&*history)),
                    Err(_) => Read::Busy,
                },
                None => Read::Gone,
            };
            if !take_hashed(&mut taken.histories, name, read, HISTORY, &mut out.histories) || !take_queries(taken, owner, history.as_deref(), &mut out.queries) {
                retry.mark(Slice::History(name));
            }
        }
        // The list shows the connections by connector with their health
        let list = registry.list();
        if taken.list.as_ref().map(|(held, _)| held) != Some(&list) {
            let revision = next_revision();
            out.connection_list.push(change(CONNECTION_LIST, text(ROOT), Some(revision)));
            taken.list = Some((list, revision));
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
                if taken.workbooks.remove(id).is_some() {
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
                take_hashed(&mut taken.workbooks, id, Read::Value(workbook_view(entry, &workbook)), WORKBOOK, &mut out.workbooks);
            }
            if whole || dirty.scripts.contains(id) {
                self.take_scripts(entry, &workbook, taken, out);
            }
            if whole || dirty.derived.contains(id) {
                let (parts, hash) = derive(&workbook);
                let held = taken.derived.get_mut(id.as_str());
                let moved = match held {
                    Some(held) => {
                        held.parts = parts;
                        compare(Some(&mut held.held), hash)
                    }
                    None => {
                        let revision = next_revision();
                        taken.derived.insert(id.clone(), HeldDerived { parts, held: Held { hash, revision } });
                        Some(revision)
                    }
                };
                if let Some(revision) = moved {
                    out.derived.push(change(WORKBOOK_DERIVED, text(id), Some(revision)));
                }
            }
        }
        drop(entries);
        if list {
            let read = self.workbooks.list_view();
            let mut held: HashMap<String, Held> = taken.workbook_list.map(|held| (ROOT.to_string(), held)).into_iter().collect();
            if take_hashed(&mut held, ROOT, read, WORKBOOK_LIST, &mut out.workbook_list) {
                taken.workbook_list = held.remove(ROOT);
            } else {
                retry.mark(Slice::WorkbookList);
            }
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
        let Some(workbook) = self.workbooks.get(workbook_id) else { return Read::Gone };
        let Ok(workbook) = workbook.try_borrow() else { return Read::Busy };
        Read::Value(derive(&workbook).0)
    }

    /// The host failed to project slices: they move with the next changes, also if their views didn't change
    pub(crate) fn resync_slices(&self, kind: &str, ids: &[JsValue]) -> Result<(), JsError> {
        let Ok(mut taken) = self.taken.try_borrow_mut() else { return Err(JsError::new("the runtime takes the changes")) };
        let text_ids = || ids.iter().filter_map(JsValue::as_string);
        let number_ids = || ids.iter().filter_map(JsValue::as_f64).map(|id| id as u64);
        let force = |held: Option<&mut Held>| {
            if let Some(held) = held {
                held.hash = None;
            }
        };
        match kind {
            COMPUTATION => {
                for id in number_ids() {
                    taken.computations.insert(id, 0);
                }
                self.platform.mark(Slice::Computations);
            }
            CONNECTION_LIST => {
                taken.list = None;
                self.platform.mark(Slice::ConnectionList);
            }
            CONNECTION => {
                for id in text_ids() {
                    force(taken.connections.get_mut(&id));
                    self.platform.mark(Slice::Connection(&id));
                }
            }
            HISTORY => {
                for name in text_ids() {
                    force(taken.histories.get_mut(&name));
                    self.platform.mark(Slice::History(&name));
                }
            }
            QUERY => {
                for id in number_ids() {
                    let owner = taken.queries.iter_mut().find(|(_, (_, queries))| queries.contains_key(&id));
                    if let Some((owner, (revision, queries))) = owner {
                        *revision = 0;
                        queries.insert(id, 0);
                        match owner {
                            QueryOwner::Connection(id) => self.platform.mark(Slice::Connection(id)),
                            QueryOwner::History(name) => self.platform.mark(Slice::History(name)),
                        }
                    }
                }
            }
            WORKBOOK_LIST => {
                force(taken.workbook_list.as_mut());
                self.platform.mark(Slice::WorkbookList);
            }
            WORKBOOK => {
                for id in text_ids() {
                    force(taken.workbooks.get_mut(&id));
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
                    force(taken.derived.get_mut(&id).map(|held| &mut held.held));
                    self.platform.mark(Slice::Derived(&id));
                }
            }
            STORAGE => {
                taken.storage = None;
                self.platform.mark(Slice::Storage);
            }
            RUN => {
                for id in text_ids() {
                    taken.runs.insert(id, 0);
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

/// The queries of a history by their revisions, the queries of a history that went go with it. False if the history
/// is busy.
fn take_queries(taken: &mut Taken, owner: QueryOwner, history: Option<&std::cell::RefCell<QueryExecutionHistory>>, out: &mut Vec<SliceChange>) -> bool {
    let Some(history) = history else {
        for query_id in taken.queries.remove(&owner).map(|(_, queries)| queries).unwrap_or_default().into_keys() {
            out.push(change(QUERY, SliceId::Number(query_id), None));
        }
        return true;
    };
    let Ok(history) = history.try_borrow() else { return false };
    let revision = history.revision();
    let (held_revision, held) = taken.queries.entry(owner).or_default();
    if *held_revision == revision && revision != 0 {
        return true;
    }
    let mut current = BTreeMap::new();
    for query_id in history.active_ids().iter().chain(history.finished_ids()) {
        let Some(query) = history.query(*query_id) else { continue };
        if held.remove(query_id) != Some(query.revision) {
            out.push(change(QUERY, SliceId::Number(*query_id), Some(query.revision)));
        }
        current.insert(*query_id, query.revision);
    }
    for query_id in std::mem::replace(held, current).into_keys() {
        out.push(change(QUERY, SliceId::Number(query_id), None));
    }
    *held_revision = revision;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slice_moves_only_when_its_hash_changed_or_the_host_asked_for_it() {
        let mut held = Held { hash: Some(1), revision: 7 };
        assert_eq!(compare(Some(&mut held), Some(1)), None);
        let moved = compare(Some(&mut held), Some(2));
        assert!(moved.is_some_and(|revision| revision != 7 && held.revision == revision));
        assert_eq!(held.hash, Some(2));
        // A resync forces the next changes to move the slice with the same view
        held.hash = None;
        assert!(compare(Some(&mut held), Some(2)).is_some());
        // A view that can't be hashed always moves
        assert!(compare(Some(&mut held), None).is_some());
        assert!(compare(Some(&mut held), None).is_some());
        assert!(compare(None, Some(3)).is_some());
    }

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
        dirty.merge(other);
        assert!(dirty.derives("w") && dirty.derives("v") && !dirty.derives("u"));
        assert!(dirty.storage && dirty.scripts.contains("w"));
    }

    #[test]
    fn changes_come_in_the_order_of_the_kinds() {
        let mut changes = Changes::default();
        changes.derived.push(change(WORKBOOK_DERIVED, text("w"), Some(3)));
        changes.scripts.push(change(SCRIPT, SliceId::Number(1), Some(2)));
        changes.workbooks.push(change(WORKBOOK, text("w"), Some(1)));
        changes.connections.push(change(CONNECTION, text("c"), None));
        let kinds: Vec<String> = changes.into_vec().into_iter().map(|change| change.kind).collect();
        assert_eq!(kinds, [CONNECTION, WORKBOOK, SCRIPT, WORKBOOK_DERIVED]);
    }
}
