//! When the catalog of a connection is updated: described when the connection comes online, refreshed on request, and
//! asked about the relations that executed statements touched.
//!
//! A full refresh only runs on user input, for the initial description of a connection that nothing describes yet,
//! and whenever a connection whose database doesn't outlive the app comes online. Everything else asks the connection
//! about single relations, once it has room for another query, after a running update, and with a growing wait after
//! a failure, three attempts in all.
//!
//! The host hands the loader the connections whenever they change (`observe`), requests refreshes (`enqueue`) and
//! reports the end of every update it started (`finished`). After each of these and when the wake-up time passed, it
//! asks for the commands to run (`schedule`).
//!
//! The microtask scheduling, the timers and the cancellation tokens of a connection stay with the host.

use std::collections::{BTreeSet, HashMap};

use crate::connections::{
    CatalogUpdates, ConnectionDetails, ConnectionHealth, ConnectionParams, ConnectionState, RelationName, Timestamp,
    MAX_TOUCHED_ATTEMPTS,
};

/// The wait before asking a connection again about the relations of executed statements, per failed attempt
pub const TOUCHED_RETRY_DELAY_MS: f64 = 2000.0;

/// What the loader reads of a connection
#[derive(Debug, Clone, Copy)]
pub struct CatalogLoaderConnection<'a> {
    pub connection_id: &'a str,
    pub health: ConnectionHealth,
    pub params: &'a ConnectionParams,
    pub details: &'a ConnectionDetails,
    pub catalog_updates: &'a CatalogUpdates,
    /// The queries that run on the connection
    pub active_queries: usize,
}

impl<'a> CatalogLoaderConnection<'a> {
    /// A connection with the number of queries that run on it
    pub fn of(connection: &'a ConnectionState, active_queries: usize) -> Self {
        Self {
            connection_id: connection.connection_id(),
            health: connection.health(),
            params: connection.params(),
            details: connection.details(),
            catalog_updates: connection.catalog_updates(),
            active_queries,
        }
    }

    /// Does the connection have room for another query?
    fn has_room(&self) -> bool {
        self.active_queries
            < self.details.connector_type().connector().max_concurrent_queries(self.details.setup_params.as_ref())
    }
}

/// What the host does
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogLoaderCommand {
    /// Abort a running update, a forced refresh supersedes it
    Abort { task_id: u32 },
    /// Start an update with `CatalogUpdate::start`, of all of the catalog or of relations, and report its end with
    /// `finished`
    Start { connection_id: String, task_id: u32, relations: Option<Vec<RelationName>> },
}

/// The commands of a scheduling pass
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CatalogSchedule {
    /// The commands, in order
    pub commands: Vec<CatalogLoaderCommand>,
    /// When to schedule again, for the next attempt to ask about relations
    pub wake_at: Option<Timestamp>,
    /// Was a requested refresh of a busy connection skipped? It stays queued, the host schedules again.
    pub retry: bool,
}

/// The scheduler of the catalog updates of the connections
#[derive(Debug, Clone)]
pub struct CatalogLoader {
    /// The requested refreshes and whether they are forced, in the order of their requests
    queue: Vec<(String, bool)>,
    /// The connections that are online
    online: BTreeSet<String>,
    /// The connections with an update in progress
    in_progress: BTreeSet<String>,
    /// When the last update of a connection finished
    last_finished_at: HashMap<String, Timestamp>,
    /// The updates that were aborted already
    aborted: BTreeSet<u32>,
    /// The next task id
    next_task_id: u32,
}

impl Default for CatalogLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl CatalogLoader {
    pub fn new() -> Self {
        Self {
            queue: Vec::new(),
            online: BTreeSet::new(),
            in_progress: BTreeSet::new(),
            last_finished_at: HashMap::new(),
            aborted: BTreeSet::new(),
            next_task_id: 1,
        }
    }

    /// Allocate the id of an update
    fn allocate_task_id(&mut self) -> u32 {
        let task_id = self.next_task_id;
        self.next_task_id = self.next_task_id.wrapping_add(1).max(1);
        task_id
    }

    /// Is a refresh of a connection requested?
    pub fn is_queued(&self, connection_id: &str) -> bool {
        self.queue.iter().any(|(id, _)| id == connection_id)
    }

    /// Follow the connections: a connection that comes online is described if nothing describes it yet, and always if
    /// its database doesn't outlive the app. A busy connection, one whose state is borrowed by an action, isn't seen and
    /// keeps what the loader knows of it.
    pub fn observe(&mut self, connections: &[CatalogLoaderConnection], busy: &[String]) {
        for connection in connections {
            let id = connection.connection_id;
            if connection.health != ConnectionHealth::Online {
                self.online.remove(id);
            } else if self.online.insert(id.to_string()) {
                if !connection.params.connector.connector().catalog_is_durable(&connection.params.params) {
                    self.enqueue(id, true);
                } else if !connection.catalog_updates.described {
                    self.enqueue(id, false);
                }
            }
        }
        self.online
            .retain(|id| connections.iter().any(|connection| connection.connection_id == id) || busy.contains(id));
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update. A request that is
    /// queued already stays forced.
    pub fn enqueue(&mut self, connection_id: &str, force: bool) {
        match self.queue.iter_mut().find(|(id, _)| id == connection_id) {
            Some((_, forced)) => *forced |= force,
            None => self.queue.push((connection_id.to_string(), force)),
        }
    }

    /// An update that the loader started finished, however it ended
    pub fn finished(&mut self, connection_id: &str, now: Timestamp) {
        self.in_progress.remove(connection_id);
        self.last_finished_at.insert(connection_id.to_string(), now);
    }

    /// The updates to start and to abort. A requested refresh of a busy connection stays queued for the next schedule,
    /// one of a connection that is not online until it comes online.
    pub fn schedule(
        &mut self,
        connections: &[CatalogLoaderConnection],
        busy: &[String],
        now: Timestamp,
    ) -> CatalogSchedule {
        let mut schedule = CatalogSchedule::default();

        // The requested refreshes go first, a lookup follows them
        let queue = std::mem::take(&mut self.queue);
        for (id, force) in queue {
            let Some(connection) = connections.iter().find(|connection| connection.connection_id == id) else {
                if busy.contains(&id) {
                    // The connection is busy, the request waits for the next schedule
                    self.queue.push((id, force));
                    schedule.retry = true;
                }
                // The connection is gone otherwise
                continue;
            };
            // A refresh runs once the connection is online, the schedule after it came online starts it
            if connection.health != ConnectionHealth::Online {
                self.queue.push((id, force));
                continue;
            }
            let updates = connection.catalog_updates;
            // A running update is kept unless the request is forced, a forced one aborts it first
            if !updates.tasks_running.is_empty() {
                if !force {
                    self.queue.push((id, force));
                    continue;
                }
                for task_id in updates.tasks_running.keys() {
                    if self.aborted.insert(*task_id) {
                        schedule.commands.push(CatalogLoaderCommand::Abort { task_id: *task_id });
                    }
                }
            }
            // A forced request stays queued until the aborted update settled
            if self.in_progress.contains(&id) {
                self.queue.push((id, force));
                continue;
            }
            // A refresh described the connection meanwhile
            if !force && updates.described {
                continue;
            }
            let task_id = self.allocate_task_id();
            self.in_progress.insert(id.clone());
            schedule.commands.push(CatalogLoaderCommand::Start { connection_id: id, task_id, relations: None });
        }

        // Ask the connections about the relations of executed statements, when they have room for another query. A
        // refresh that runs may have read the relations too early, the lookup follows it and corrects them.
        for connection in connections {
            let id = connection.connection_id;
            let updates = connection.catalog_updates;
            if updates.touched_relations.is_empty()
                || self.in_progress.contains(id)
                || !updates.tasks_running.is_empty()
            {
                continue;
            }
            // A refresh that is still requested goes first, the lookup follows it
            if self.is_queued(id) {
                continue;
            }
            // Relations that a restored catalog still has to ask about wait for the connection
            if connection.health != ConnectionHealth::Online || !connection.has_room() {
                continue;
            }
            // The next statement or a manual refresh tries again
            if updates.touched_failures >= MAX_TOUCHED_ATTEMPTS {
                continue;
            }
            if updates.touched_failures > 0 {
                let last = self.last_finished_at.get(id).copied().unwrap_or(0.0);
                let retry_at = last + TOUCHED_RETRY_DELAY_MS * f64::from(updates.touched_failures);
                if retry_at > now {
                    schedule.wake_at = Some(schedule.wake_at.map_or(retry_at, |wake_at: f64| wake_at.min(retry_at)));
                    continue;
                }
            }
            let task_id = self.allocate_task_id();
            self.in_progress.insert(id.to_string());
            schedule.commands.push(CatalogLoaderCommand::Start {
                connection_id: id.to_string(),
                task_id,
                relations: Some(updates.touched_relations.clone()),
            });
        }

        // The aborted updates that still run, a busy connection may run one
        if busy.is_empty() {
            self.aborted.retain(|task_id| {
                connections.iter().any(|connection| connection.catalog_updates.tasks_running.contains_key(task_id))
            });
        }
        schedule
    }
}
