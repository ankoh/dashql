//! The connections of a runtime with the histories of their queries, and the histories without a connection (e.g. the
//! one of the shell).
//!
//! The registry keeps the connections in the order they were registered and hands out the ids of the queries of all
//! histories from one sequence, a query id names a query of one history. It applies the actions of a connection with
//! the rules of the registry: a connection that workbooks use is never deleted and switches its connector only while
//! one workbook uses it, the embedded Hyper is never deleted. The workbooks that use a connection come from the host
//! (`set_references`) until the workbooks are part of the runtime.
//!
//! Ported from `applyConnectionAction` of `packages/dashql/src/runtime/connections/connection_registry_state.ts`.

use std::cell::RefCell;
use std::rc::Rc;

use dashql_core::error::{Error, Result};

use super::label::is_hyper_wasm_connection;
use super::{ConnectionAction, ConnectionEffect, ConnectionState, ConnectorType, Timestamp, CONNECTOR_TYPES};
use crate::catalog_loader::FollowedConnection;
use crate::handles::Handle;
use crate::query::{QueryExecutionAction, QueryExecutionEffect, QueryExecutionHistory, QueryExecutionOutcome, QueryId};

/// The history that a query belongs to
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum QueryOwner {
    /// The history of a connection
    Connection(String),
    /// A history without a connection, by its name
    History(String),
}

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
    /// Did the action change a connection or a history?
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<RegistryEffect>,
    /// The queries that were active when the history was cleared, the executor stops them
    pub stopped: Vec<QueryId>,
    /// Was the connection deleted?
    pub deleted: bool,
}

impl RegistryOutcome {
    fn of_queries(outcome: QueryExecutionOutcome) -> Self {
        RegistryOutcome { changed: outcome.changed, effects: outcome.effects.iter().map(Into::into).collect(), ..Default::default() }
    }
}

/// A connection of the list: what the pickers and the labels need
#[derive(Debug, Clone, PartialEq)]
pub struct ListedConnection {
    pub connection_id: String,
    pub connector_type: ConnectorType,
    pub active: bool,
    /// Is the connection listed next to the workbooks? Connections that workbooks use are, as are active ones.
    pub listed: bool,
    /// The number of the connection among the listed connections of its connector from 1, none if it is the only one
    pub ordinal: Option<u32>,
}

/// The connections and the histories of a runtime. A runtime holds few connections and histories, they are lists: a
/// map of each would grow the module by its own code.
#[derive(Default)]
pub struct ConnectionRegistry {
    /// The connections in the order of registration
    connections: Vec<(String, FollowedConnection)>,
    /// The histories without a connection by name
    histories: Vec<(String, Rc<RefCell<QueryExecutionHistory>>)>,
    /// The last query id
    last_query_id: QueryId,
    /// The workbooks that use a connection, in the order of the host
    references: Vec<(String, Vec<String>)>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a connection under its id
    pub fn insert(&mut self, state: ConnectionState) -> Result<FollowedConnection> {
        let connection_id = state.connection_id().to_string();
        if self.get(&connection_id).is_some() {
            return Err(Error::invalid_argument(format!("the connection {connection_id} exists already")));
        }
        let connection = FollowedConnection {
            state: Rc::new(RefCell::new(state)),
            queries: Rc::new(RefCell::new(QueryExecutionHistory::new())),
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

    /// Set the workbooks that use the connections, returns whether they changed
    pub fn set_references(&mut self, references: Vec<(String, Vec<String>)>) -> bool {
        let mut references: Vec<(String, Vec<String>)> = references.into_iter().filter(|(_, workbooks)| !workbooks.is_empty()).collect();
        references.sort_by(|left, right| left.0.cmp(&right.0));
        if references == self.references {
            return false;
        }
        self.references = references;
        true
    }

    /// The connections of the list, in the order of registration
    pub fn list(&self) -> Vec<ListedConnection> {
        let mut listed: Vec<ListedConnection> = self
            .connections()
            .map(|(id, connection)| {
                let state = connection.state.borrow();
                ListedConnection {
                    connection_id: id.to_string(),
                    connector_type: state.connector_type(),
                    active: state.active(),
                    listed: !self.workbooks_of(id).is_empty() || state.active(),
                    ordinal: None,
                }
            })
            .collect();
        for connector in CONNECTOR_TYPES {
            let of_connector: Vec<usize> =
                listed.iter().enumerate().filter(|(_, c)| c.listed && c.connector_type == connector).map(|(i, _)| i).collect();
            if of_connector.len() < 2 {
                continue;
            }
            for (ordinal, index) in of_connector.into_iter().enumerate() {
                if let Some(connection) = listed.get_mut(index) {
                    connection.ordinal = Some(ordinal as u32 + 1);
                }
            }
        }
        listed
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
                    let mut queries = connection.queries.try_borrow_mut().map_err(|_| Error::invalid_argument("the queries are in use"))?;
                    outcome.stopped.extend_from_slice(queries.active_ids());
                    let cleared = queries.clear(reason);
                    outcome.effects.extend(cleared.effects.iter().map(RegistryEffect::from));
                    outcome.changed = true;
                }
            }
        }
        if deleted {
            self.connections.retain(|(id, _)| id != connection_id);
            self.references.retain(|(id, _)| id != connection_id);
        }
        Ok(outcome)
    }

    /// Create a history without a connection that keeps at most `limit` queries, an existing one stays
    pub fn create_history(&mut self, name: &str, limit: Option<usize>) {
        if self.histories.iter().any(|(held, _)| held == name) {
            return;
        }
        let history = match limit {
            Some(limit) => QueryExecutionHistory::with_limit(limit),
            None => QueryExecutionHistory::new(),
        };
        self.histories.push((name.to_string(), Rc::new(RefCell::new(history))));
    }

    /// Drop a history without a connection, the effects release the handles of its queries
    pub fn drop_history(&mut self, name: &str) -> RegistryOutcome {
        let Some(index) = self.histories.iter().position(|(held, _)| held == name) else { return RegistryOutcome::default() };
        let (_, history) = self.histories.remove(index);
        let mut history = history.borrow_mut();
        let stopped = history.active_ids().to_vec();
        let mut outcome = RegistryOutcome::of_queries(history.clear("The query history was cleared"));
        outcome.stopped = stopped;
        outcome
    }

    /// The histories without a connection
    pub fn histories(&self) -> impl Iterator<Item = (&str, &Rc<RefCell<QueryExecutionHistory>>)> {
        self.histories.iter().map(|(name, history)| (name.as_str(), history))
    }

    /// The history of an owner
    pub fn history(&self, owner: &QueryOwner) -> Option<Rc<RefCell<QueryExecutionHistory>>> {
        match owner {
            QueryOwner::Connection(id) => self.get(id).map(|connection| connection.queries.clone()),
            QueryOwner::History(name) => self.histories.iter().find(|(held, _)| held == name).map(|(_, history)| history.clone()),
        }
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

    /// The history that holds a query and its owner, none for a query that left its history
    pub fn query_history(&self, query_id: QueryId) -> Option<(QueryOwner, Rc<RefCell<QueryExecutionHistory>>)> {
        let holds = |history: &Rc<RefCell<QueryExecutionHistory>>| history.try_borrow().is_ok_and(|history| history.query(query_id).is_some());
        let connection = self.connections.iter().find(|(_, connection)| holds(&connection.queries));
        if let Some((id, connection)) = connection {
            return Some((QueryOwner::Connection(id.clone()), connection.queries.clone()));
        }
        let history = self.histories.iter().find(|(_, history)| holds(history));
        history.map(|(name, history)| (QueryOwner::History(name.clone()), history.clone()))
    }

    /// Apply an action to a query of a history. The id of a new query comes from `next_query_id`.
    pub fn apply_query(&mut self, owner: &QueryOwner, action: QueryExecutionAction) -> Result<RegistryOutcome> {
        let history = self.history(owner).ok_or_else(|| Error::invalid_argument(format!("no query history of {owner:?}")))?;
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
    fn keeps_the_order_and_numbers_the_listed_connections() {
        let mut registry = ConnectionRegistry::new();
        registry.insert(connection("a", ConnectorType::Trino, true)).unwrap();
        registry.insert(connection("b", ConnectorType::Hyper, false)).unwrap();
        registry.insert(connection("c", ConnectorType::Trino, false)).unwrap();
        assert!(registry.insert(connection("a", ConnectorType::Trino, false)).is_err());
        assert_eq!(registry.ids(), ["a", "b", "c"]);
        // c is listed once a workbook uses it, then both Trino connections are numbered
        let list = registry.list();
        assert_eq!(list.iter().map(|c| (c.listed, c.ordinal)).collect::<Vec<_>>(), [(true, None), (false, None), (false, None)]);
        assert!(registry.set_references(vec![("c".to_string(), vec!["w".to_string()])]));
        assert!(!registry.set_references(vec![("c".to_string(), vec!["w".to_string()])]));
        let list = registry.list();
        assert_eq!(list.iter().map(|c| c.ordinal).collect::<Vec<_>>(), [Some(1), None, Some(2)]);
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
        let owner = QueryOwner::Connection("t".into());
        let first = registry.next_query_id();
        let second = registry.next_query_id();
        assert_eq!(second, first + 1);
        for (query_id, handle) in [(first, None), (second, Some(7))] {
            let mut state = QueryExecutionState::new(query_id, 1, "select 1", QueryMetadata::new(QueryType::UserProvided), 0);
            state.handle = handle;
            registry.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
        }
        assert_eq!(registry.query_history(first).map(|(owner, _)| owner), Some(owner));
        let outcome = registry.apply("t", ConnectionAction::Reset, 0.0).unwrap();
        assert_eq!(outcome.stopped, [first, second]);
        assert!(registry.query_history(first).is_none());
        assert!(outcome.effects.contains(&RegistryEffect::Abort { handle: 7, reason: "Connection was reset" }));
        assert!(outcome.effects.contains(&RegistryEffect::Release { handle: 7 }));
        assert!(registry.get("t").unwrap().queries.borrow().active_ids().is_empty());
    }

    #[test]
    fn keeps_histories_without_a_connection() {
        let mut registry = ConnectionRegistry::new();
        registry.create_history("shell", Some(1));
        let owner = QueryOwner::History("shell".into());
        for _ in 0..2 {
            let query_id = registry.next_query_id();
            let state = QueryExecutionState::new(query_id, 1, "select 1", QueryMetadata::new(QueryType::UserProvided), 0);
            registry.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
        }
        let history = registry.history(&owner).unwrap();
        assert_eq!(history.borrow().active_ids().len(), 1, "the limit drops the oldest query");
        assert!(registry.apply_query(&QueryOwner::History("other".into()), QueryExecutionAction::QueryCacheDeleted { query_id: 1 }).is_err());
        registry.drop_history("shell");
        assert!(registry.history(&owner).is_none());
    }
}
