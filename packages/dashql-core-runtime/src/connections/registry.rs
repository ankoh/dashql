//! The connections of a runtime with the histories of their queries.
//!
//! The registry keeps the connections in the order they were registered and hands out the ids of the queries of all
//! connections from one sequence, a query id names a query of one history. It applies the actions of a connection with
//! the rules of the registry: a connection that workbooks use is never deleted and switches its connector only while
//! one workbook uses it, the embedded Hyper is never deleted. The workbooks that use a connection come from the host
//! (`set_references`), the workbooks of the runtime set them.

use std::cell::RefCell;
use std::rc::Rc;

use dashql_core::error::{Error, Result};

use super::label::is_hyper_wasm_connection;
use super::{ConnectionAction, ConnectionEffect, ConnectionState, ConnectorType, Timestamp};
use crate::catalog_loader::FollowedConnection;
use crate::handles::Handle;
use crate::query::{QueryExecutionAction, QueryExecutionEffect, QueryExecutionHistory, QueryExecutionOutcome, QueryId, INTERNAL_QUERY_HISTORY_LIMIT};

/// What the host does after an action of the registry, in order
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryEffect {
    /// Release a handle
    Release { handle: Handle },
    /// Close a handle, a channel, and release it
    Close { handle: Handle },
    /// Abort a handle, e.g. the record of a query, it stays until a release
    Abort { handle: Handle, reason: &'static str },
    /// Cancel the setup of the connection that is running
    CancelSetup,
    /// Cancel a running catalog update of the catalog loader
    CancelCatalogUpdate { task_id: u32, reason: &'static str },
}

impl From<&QueryExecutionEffect> for RegistryEffect {
    fn from(effect: &QueryExecutionEffect) -> Self {
        match *effect {
            QueryExecutionEffect::Abort { handle, reason } => RegistryEffect::Abort { handle, reason },
            QueryExecutionEffect::Release { handle } => RegistryEffect::Release { handle },
        }
    }
}

/// What an action of the registry did
#[derive(Debug, Default)]
pub struct RegistryOutcome {
    /// Did the action change a connection or its queries?
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<RegistryEffect>,
    /// The queries that were active when the history was cleared, the executor stops them
    pub stopped: Vec<QueryId>,
    /// The queries whose results a later result of their owner superseded, the host drops their computations
    pub superseded: Vec<QueryId>,
    /// Was the connection deleted?
    pub deleted: bool,
}

impl RegistryOutcome {
    fn of_queries(outcome: QueryExecutionOutcome) -> Self {
        RegistryOutcome {
            changed: outcome.changed,
            effects: outcome.effects.iter().map(Into::into).collect(),
            superseded: outcome.superseded,
            ..Default::default()
        }
    }
}

/// A connection of the list: what the pickers and the labels need. How a host shows the list, e.g. which connections
/// it lists next to the workbooks, is the host's.
#[derive(Debug, Clone, PartialEq)]
pub struct ListedConnection {
    pub connection_id: String,
    pub connector_type: ConnectorType,
    /// Does the connection belong to a committed workbook, or was it connected once?
    pub active: bool,
    /// Do workbooks use the connection?
    pub used: bool,
    /// The name the user gave the connection
    pub name: Option<String>,
    /// The detail of the label, the protocol, e.g. `Wasm`
    pub label_detail: &'static str,
}

/// The connections of a runtime. A runtime holds few connections, they are a list: a map would grow the module by its
/// own code.
pub struct ConnectionRegistry {
    /// The connections in the order of registration
    connections: Vec<(String, FollowedConnection)>,
    /// The last query id
    last_query_id: QueryId,
    /// The workbooks that use a connection, in the order of the host
    references: Vec<(String, Vec<String>)>,
    /// The finished internal queries that the history of a connection keeps
    history_limit: usize,
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::with_history_limit(INTERNAL_QUERY_HISTORY_LIMIT)
    }
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The connections of a runtime whose histories keep a number of finished internal queries
    pub fn with_history_limit(history_limit: usize) -> Self {
        Self { connections: Vec::new(), last_query_id: 0, references: Vec::new(), history_limit }
    }

    /// Register a connection under its id
    pub fn insert(&mut self, state: ConnectionState) -> Result<FollowedConnection> {
        let connection_id = state.connection_id().to_string();
        if self.get(&connection_id).is_some() {
            return Err(Error::invalid_argument(format!("the connection {connection_id} exists already")));
        }
        let connection = FollowedConnection {
            state: Rc::new(RefCell::new(state)),
            queries: Rc::new(RefCell::new(QueryExecutionHistory::with_internal_limit(self.history_limit))),
        };
        self.connections.push((connection_id, connection.clone()));
        Ok(connection)
    }

    /// A connection by id
    pub fn get(&self, connection_id: &str) -> Option<&FollowedConnection> {
        self.connections.iter().find(|(id, _)| id == connection_id).map(|(_, connection)| connection)
    }

    /// The ids of the connections in the order of registration
    pub fn ids(&self) -> Vec<&str> {
        self.connections.iter().map(|(id, _)| id.as_str()).collect()
    }

    /// The connections in the order of registration
    pub fn connections(&self) -> impl Iterator<Item = (&str, &FollowedConnection)> {
        self.connections.iter().map(|(id, connection)| (id.as_str(), connection))
    }

    /// The workbooks that use a connection
    pub fn workbooks_of(&self, connection_id: &str) -> &[String] {
        self.references.iter().find(|(id, _)| id == connection_id).map(|(_, workbooks)| workbooks.as_slice()).unwrap_or_default()
    }

    /// Set the workbooks that use the connections, returns the connections whose workbooks changed
    pub fn set_references(&mut self, references: Vec<(String, Vec<String>)>) -> Vec<String> {
        let mut references: Vec<(String, Vec<String>)> = references.into_iter().filter(|(_, workbooks)| !workbooks.is_empty()).collect();
        references.sort_by(|left, right| left.0.cmp(&right.0));
        if references == self.references {
            return Vec::new();
        }
        let of = |references: &[(String, Vec<String>)], id: &str| references.iter().find(|(held, _)| held == id).map(|(_, workbooks)| workbooks.clone());
        let mut changed: Vec<String> = Vec::new();
        for (id, _) in references.iter().chain(self.references.iter()) {
            if !changed.contains(id) && of(&references, id) != of(&self.references, id) {
                changed.push(id.clone());
            }
        }
        self.references = references;
        changed
    }

    /// The connections of the list, in the order of registration. None while the state of a connection is borrowed.
    pub fn list(&self) -> Option<Vec<ListedConnection>> {
        self.connections()
            .map(|(id, connection)| {
                let state = connection.state.try_borrow().ok()?;
                Some(ListedConnection {
                    connection_id: id.to_string(),
                    connector_type: state.connector_type(),
                    active: state.active(),
                    used: !self.workbooks_of(id).is_empty(),
                    name: state.name().map(str::to_string),
                    label_detail: state.connector_type().connector().label_detail(state.details().setup_params.as_ref()),
                })
            })
            .collect()
    }

    /// Apply an action to a connection. A connection that stops its queries clears its history, a deleted connection
    /// leaves the registry.
    pub fn apply(&mut self, connection_id: &str, action: ConnectionAction, now: Timestamp) -> Result<RegistryOutcome> {
        let connection = self
            .get(connection_id)
            .cloned()
            .ok_or_else(|| Error::invalid_argument(format!("no connection registered with id {connection_id}")))?;
        let workbooks = self.workbooks_of(connection_id).len();
        match action {
            ConnectionAction::Delete if workbooks > 0 => {
                return Err(Error::invalid_argument("refusing to delete a connection that workbooks reference"));
            }
            ConnectionAction::Delete if is_hyper_wasm_connection(&connection.state.borrow()) => {
                return Err(Error::invalid_argument("refusing to delete the connection to the embedded Hyper"));
            }
            ConnectionAction::SwitchConnectorType(_) if workbooks > 1 => {
                return Err(Error::invalid_argument("refusing to switch the type of a shared connection"));
            }
            _ => {}
        }
        let deleted = matches!(action, ConnectionAction::Delete);
        // The history is taken before the state changes: an action that stops the queries fails as a whole
        let mut queries = connection.queries.try_borrow_mut().map_err(|_| Error::invalid_argument("the queries are in use"))?;
        let applied = connection
            .state
            .try_borrow_mut()
            .map_err(|_| Error::invalid_argument("the connection is in use"))?
            .apply(action, now)?;
        let mut outcome = RegistryOutcome { changed: applied.changed, deleted, ..Default::default() };
        for effect in applied.effects {
            match effect {
                ConnectionEffect::CancelSetup => outcome.effects.push(RegistryEffect::CancelSetup),
                // The catalog loader publishes only for a connection that runs its update, the updates are aborted
                ConnectionEffect::InvalidateCatalogBatch => {}
                ConnectionEffect::Abort { handle, reason } => outcome.effects.push(RegistryEffect::Abort { handle, reason }),
                ConnectionEffect::CancelCatalogUpdate { task_id, reason } => {
                    outcome.effects.push(RegistryEffect::CancelCatalogUpdate { task_id, reason })
                }
                ConnectionEffect::Close { handle } => outcome.effects.push(RegistryEffect::Close { handle }),
                ConnectionEffect::Release { handle } => outcome.effects.push(RegistryEffect::Release { handle }),
                ConnectionEffect::StopQueries { reason } => {
                    outcome.stopped.extend_from_slice(queries.active_ids());
                    let cleared = queries.clear(reason);
                    outcome.effects.extend(cleared.effects.iter().map(RegistryEffect::from));
                    outcome.changed = true;
                }
            }
        }
        drop(queries);
        if deleted {
            self.connections.retain(|(id, _)| id != connection_id);
            self.references.retain(|(id, _)| id != connection_id);
        }
        Ok(outcome)
    }

    /// The history of the queries of a connection
    pub fn history(&self, connection_id: &str) -> Option<Rc<RefCell<QueryExecutionHistory>>> {
        self.get(connection_id).map(|connection| connection.queries.clone())
    }

    /// Hand out the id of a new query
    pub fn next_query_id(&mut self) -> QueryId {
        self.last_query_id += 1;
        self.last_query_id
    }

    /// Hand out an id of the sequence of the queries without a query, e.g. for the computation of a result that no
    /// query of the runtime produced
    pub fn allocate_id(&mut self) -> QueryId {
        self.last_query_id += 1;
        self.last_query_id
    }

    /// The history that holds a query and its connection, none for a query that left its history
    pub fn query_history(&self, query_id: QueryId) -> Option<(String, Rc<RefCell<QueryExecutionHistory>>)> {
        let holds = |history: &Rc<RefCell<QueryExecutionHistory>>| history.try_borrow().is_ok_and(|history| history.query(query_id).is_some());
        let connection = self.connections.iter().find(|(_, connection)| holds(&connection.queries));
        connection.map(|(id, connection)| (id.clone(), connection.queries.clone()))
    }

    /// Apply an action to a query of the history of a connection. The id of a new query comes from `next_query_id`.
    pub fn apply_query(&mut self, connection_id: &str, action: QueryExecutionAction) -> Result<RegistryOutcome> {
        let history = self.history(connection_id).ok_or_else(|| Error::invalid_argument(format!("no connection {connection_id}")))?;
        let outcome = history.try_borrow_mut().map_err(|_| Error::invalid_argument("the queries are in use"))?.apply(action)?;
        Ok(RegistryOutcome::of_queries(outcome))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connections::{ConnectionDetails, ConnectionParams, ConnectionStateOptions};
    use crate::query::{QueryExecutionState, QueryMetadata, QueryType};

    fn connection(id: &str, connector: ConnectorType, active: bool) -> ConnectionState {
        let options = ConnectionStateOptions { active, ..Default::default() };
        ConnectionState::new(id, ConnectionDetails::default_for(connector), options, 0.0)
    }

    fn trino(id: &str) -> ConnectionState {
        let params = ConnectionParams::default_for(ConnectorType::Trino);
        ConnectionState::from_params(id, params, 0.0)
    }

    #[test]
    fn keeps_the_order_and_says_which_connections_workbooks_use() {
        let mut registry = ConnectionRegistry::new();
        registry.insert(connection("a", ConnectorType::Trino, true)).unwrap();
        registry.insert(connection("b", ConnectorType::Hyper, false)).unwrap();
        registry.insert(connection("c", ConnectorType::Trino, false)).unwrap();
        assert!(registry.insert(connection("a", ConnectorType::Trino, false)).is_err());
        assert_eq!(registry.ids(), ["a", "b", "c"]);
        let list = registry.list().unwrap();
        assert_eq!(list.iter().map(|c| (c.active, c.used)).collect::<Vec<_>>(), [(true, false), (false, false), (false, false)]);
        assert_eq!(registry.set_references(vec![("c".to_string(), vec!["w".to_string()])]), ["c"]);
        assert!(registry.set_references(vec![("c".to_string(), vec!["w".to_string()])]).is_empty());
        let list = registry.list().unwrap();
        assert_eq!(list.iter().map(|c| c.used).collect::<Vec<_>>(), [false, false, true]);
    }

    #[test]
    fn refuses_to_delete_what_workbooks_use() {
        let mut registry = ConnectionRegistry::new();
        registry.insert(trino("t")).unwrap();
        registry.insert(connection("h", ConnectorType::Hyper, false)).unwrap();
        registry.set_references(vec![("t".to_string(), vec!["w".to_string()])]);
        assert!(registry.apply("t", ConnectionAction::Delete, 0.0).is_err());
        assert!(registry.apply("h", ConnectionAction::Delete, 0.0).is_err(), "the embedded Hyper stays");
        registry.set_references(Vec::new());
        let outcome = registry.apply("t", ConnectionAction::Delete, 0.0).unwrap();
        assert!(outcome.deleted && outcome.changed);
        assert!(registry.get("t").is_none());
        assert_eq!(registry.ids(), ["h"]);
        assert!(registry.apply("t", ConnectionAction::Reset, 0.0).is_err());
    }

    #[test]
    fn a_reset_stops_the_queries_of_the_connection() {
        let mut registry = ConnectionRegistry::new();
        registry.insert(trino("t")).unwrap();
        let owner = "t";
        let first = registry.next_query_id();
        let second = registry.next_query_id();
        assert_eq!(second, first + 1);
        for (query_id, handle) in [(first, None), (second, Some(7))] {
            let mut state = QueryExecutionState::new(query_id, 1, "select 1", QueryMetadata::new(QueryType::UserProvided), 0);
            state.handle = handle;
            registry.apply_query(owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
        }
        assert_eq!(registry.query_history(first).map(|(owner, _)| owner).as_deref(), Some(owner));
        let outcome = registry.apply("t", ConnectionAction::Reset, 0.0).unwrap();
        assert_eq!(outcome.stopped, [first, second]);
        assert!(registry.query_history(first).is_none());
        assert!(outcome.effects.contains(&RegistryEffect::Abort { handle: 7, reason: "Connection was reset" }));
        assert!(outcome.effects.contains(&RegistryEffect::Release { handle: 7 }));
        assert!(registry.get("t").unwrap().queries.borrow().active_ids().is_empty());
    }

    #[test]
    fn an_action_on_a_connection_whose_queries_are_in_use_changes_nothing() {
        let mut registry = ConnectionRegistry::new();
        registry.insert(trino("a")).unwrap();
        let connection = registry.get("a").unwrap().clone();
        let (revision, epoch) = (connection.state.borrow().revision(), connection.state.borrow().setup_epoch());
        let held = connection.queries.borrow_mut();
        assert!(registry.apply("a", ConnectionAction::Reset, 1.0).is_err());
        drop(held);
        assert_eq!((connection.state.borrow().revision(), connection.state.borrow().setup_epoch()), (revision, epoch));
        assert!(registry.apply("a", ConnectionAction::Reset, 1.0).is_ok());
        assert!(connection.state.borrow().setup_epoch() > epoch);
    }
}
