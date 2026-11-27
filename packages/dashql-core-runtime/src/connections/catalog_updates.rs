//! The updates of the catalog of a connection: full refreshes and the lookups of the relations that executed
//! statements touched.
//!
//! The catalog loader runs the updates, the connection keeps their state.

use std::collections::BTreeMap;

use dashql_buffers::analyzer::QualifiedTableNameT;

use super::details::{DetailedError, Timestamp};

/// The attempts to answer the relations of executed statements before the catalog counts as out of date
pub const MAX_TOUCHED_ATTEMPTS: u32 = 3;

/// What a catalog update does
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogUpdateVariant {
    /// Load the whole catalog of the connection
    FullCatalogRefresh,
    /// Ask the connection about the relations that executed statements touched
    RelationRefresh,
}

/// How far a catalog update got
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogUpdateTaskStatus {
    Started,
    Succeeded,
    Failed,
    Cancelled,
    /// Some databases answered, others failed
    PartiallySucceeded,
}

/// A relation that a statement touched, e.g. created or dropped
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RelationName {
    /// The database
    pub database_name: String,
    /// The schema, empty if a statement didn't name one. The connection decides which schema that is, it can be a
    /// temporary schema or one of the search path, so a name without a schema matches every schema.
    pub schema_name: String,
    /// The table, empty for everything in the schema
    pub table_name: String,
}

impl RelationName {
    /// A relation name
    pub fn new(database_name: &str, schema_name: &str, table_name: &str) -> Self {
        Self {
            database_name: database_name.to_string(),
            schema_name: schema_name.to_string(),
            table_name: table_name.to_string(),
        }
    }
}

/// The relation of a table name of the analyzer, a name without a database gets the default database
pub fn read_relation_name(name: &QualifiedTableNameT, default_database: &str) -> RelationName {
    let database_name =
        name.database_name.as_deref().filter(|database| !database.is_empty()).unwrap_or(default_database);
    RelationName::new(
        database_name,
        name.schema_name.as_deref().unwrap_or(""),
        name.table_name.as_deref().unwrap_or(""),
    )
}

/// Merge relation names, every relation once
pub fn merge_relation_names(into: &[RelationName], names: &[RelationName]) -> Vec<RelationName> {
    let mut out = into.to_vec();
    for name in names {
        if !out.contains(name) {
            out.push(name.clone());
        }
    }
    out
}

/// A catalog update
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogUpdateTask {
    /// The id of the task
    pub task_id: u32,
    /// What the update does
    pub variant: CatalogUpdateVariant,
    /// How far the update got
    pub status: CatalogUpdateTaskStatus,
    /// The queries of the update
    pub queries: Vec<u32>,
    /// The error of an update that didn't succeed
    pub error: Option<DetailedError>,
    /// When the update started
    pub started_at: Option<Timestamp>,
    /// When the update finished
    pub finished_at: Option<Timestamp>,
    /// The relations of executed statements that the update answers
    pub touched_relations: Vec<RelationName>,
}

impl CatalogUpdateTask {
    /// A started update
    pub fn new(task_id: u32, variant: CatalogUpdateVariant, started_at: Timestamp) -> Self {
        Self {
            task_id,
            variant,
            status: CatalogUpdateTaskStatus::Started,
            queries: Vec::new(),
            error: None,
            started_at: Some(started_at),
            finished_at: None,
            touched_relations: Vec::new(),
        }
    }
}

/// The catalog updates of a connection
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CatalogUpdates {
    /// The running updates by task id
    pub tasks_running: BTreeMap<u32, CatalogUpdateTask>,
    /// The update that finished last. Older ones aren't kept, a connection runs an update after every statement that
    /// touches relations.
    pub last_finished: Option<CatalogUpdateTask>,
    /// Does the catalog describe the connection, from a restored file or a full refresh that succeeded? Until then a
    /// connection is described when it comes online, and nothing is saved: a few relations aren't a catalog.
    pub described: bool,
    /// The id of the running or most recently started full refresh
    pub current_full_refresh: Option<u32>,
    /// The relations that executed statements created or dropped and that no update has answered yet
    pub touched_relations: Vec<RelationName>,
    /// The updates in a row that failed to answer them
    pub touched_failures: u32,
}

impl CatalogUpdates {
    /// Might the catalog miss what executed statements did, since asking the connection failed?
    pub fn is_out_of_date(&self) -> bool {
        self.touched_failures >= MAX_TOUCHED_ATTEMPTS
    }

    /// Is a full refresh running?
    pub fn is_refresh_running(&self) -> bool {
        self.current_full_refresh.is_some_and(|id| self.tasks_running.contains_key(&id))
    }

    /// The relations that nothing has answered about yet, also those of a running update
    pub fn pending_relations(&self) -> Vec<RelationName> {
        let mut pending = self.touched_relations.clone();
        for task in self.tasks_running.values() {
            pending = merge_relation_names(&pending, &task.touched_relations);
        }
        pending
    }

    /// Record the relations that executed statements touched, false if nothing changed
    pub(crate) fn touch(&mut self, relations: &[RelationName]) -> bool {
        let merged = merge_relation_names(&self.touched_relations, relations);
        let changed = merged != self.touched_relations || self.touched_failures != 0;
        self.touched_relations = merged;
        self.touched_failures = 0;
        changed
    }

    /// Start an update. It takes the relations it answers, a statement may have touched others meanwhile.
    pub(crate) fn start(&mut self, task: CatalogUpdateTask) {
        if task.variant == CatalogUpdateVariant::FullCatalogRefresh {
            self.current_full_refresh = Some(task.task_id);
        }
        // A full refresh leaves the other relations, only the answer about a relation can say that it is gone
        self.touched_relations.retain(|relation| !task.touched_relations.contains(relation));
        self.tasks_running.insert(task.task_id, task);
    }

    /// Register a query of a running update, false for an update that isn't running
    pub(crate) fn register_query(&mut self, task_id: u32, query_id: u32) -> bool {
        let Some(task) = self.tasks_running.get_mut(&task_id) else {
            return false;
        };
        task.queries.push(query_id);
        true
    }

    /// Finish a running update, false for an update that isn't running
    pub(crate) fn finish(
        &mut self,
        task_id: u32,
        status: CatalogUpdateTaskStatus,
        error: Option<DetailedError>,
        now: Timestamp,
    ) -> bool {
        let Some(mut task) = self.tasks_running.remove(&task_id) else {
            return false;
        };
        let succeeded = status == CatalogUpdateTaskStatus::Succeeded;
        if succeeded && task.variant == CatalogUpdateVariant::FullCatalogRefresh {
            self.described = true;
        }
        if succeeded {
            self.touched_failures = 0;
        } else {
            // A cancelled update was superseded or its connection stopped, that is no failure of the connection. A
            // database that failed in a partial update didn't answer about its relations.
            self.touched_relations = merge_relation_names(&self.touched_relations, &task.touched_relations);
            if status != CatalogUpdateTaskStatus::Cancelled && !task.touched_relations.is_empty() {
                self.touched_failures = self.touched_failures.saturating_add(1);
            }
        }
        task.status = status;
        task.error = if succeeded { None } else { error };
        task.finished_at = Some(now);
        self.last_finished = Some(task);
        true
    }
}
