//! The logic of the channel to the embedded Hyper, which itself stays with the host.
//!
//! A connection of the embedded Hyper runs on one session of the database of the instance, the session keeps the state
//! of the scripts such as settings and attached databases. The session runs one statement at a time: a query waits
//! until the result of the previous one is read to the end, cancelled or failed. A waiting query that is cancelled
//! leaves the queue without waiting for the running one.
//!
//! Ported from `packages/dashql-runtime/src/connections/embedded/embedded_database_channel.ts`.

use std::collections::VecDeque;

use super::error::HyperError;
use super::local_cloud::{embedded_cloud_databases, is_attachable_database, HYPER_CLOUDS_DIRECTORY};
use crate::connections::JsonObject;
use crate::query::QueryExecutionMetrics;

/// The database of the embedded Hyper connector in the instance
pub const EMBEDDED_DEFAULT_DATABASE: &str = "hyper";

/// A database that a session attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedAttachedDatabase {
    /// The path relative to the OPFS folder of the app, the host turns it into the Hyper path in the OPFS root of Hyper
    pub path: String,
    /// The alias that statements name the database by
    pub alias: String,
}

/// The options of the session of a connection to the embedded Hyper
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedSessionOptions {
    /// The database of the session, none for a local cloud: Hyper resolves unqualified names only in a session with a
    /// single database
    pub default_database: Option<String>,
    /// The databases of the clouds folder that the session attaches
    pub attached_databases: Vec<EmbeddedAttachedDatabase>,
}

/// The session options of a connection to the embedded Hyper with params. A local cloud attaches the databases of the
/// clouds folder of its params, like a Hyper server, and has no database of its own. A database outside of the clouds
/// folder is an error.
pub fn embedded_session_options(params: Option<&JsonObject>) -> Result<EmbeddedSessionOptions, HyperError> {
    let attached_databases = embedded_cloud_databases(params)
        .into_iter()
        .map(|database| {
            if !is_attachable_database(&database.path) {
                return Err(HyperError::Protocol(format!(
                    "The embedded Hyper only attaches databases in {HYPER_CLOUDS_DIRECTORY}/, not {}",
                    database.path
                )));
            }
            Ok(EmbeddedAttachedDatabase { path: database.path, alias: database.alias })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let default_database = attached_databases.is_empty().then(|| EMBEDDED_DEFAULT_DATABASE.to_string());
    Ok(EmbeddedSessionOptions { default_database, attached_databases })
}

/// A query of the queue
pub type EmbeddedTicket = u64;

/// The queries of a session of the embedded Hyper, one runs at a time
#[derive(Debug, Default)]
pub struct EmbeddedQueryQueue {
    /// The query that runs
    running: Option<EmbeddedTicket>,
    /// The queries that wait, in order
    waiting: VecDeque<EmbeddedTicket>,
    /// The next ticket
    next_ticket: EmbeddedTicket,
}

impl EmbeddedQueryQueue {
    /// An empty queue
    pub fn new() -> Self {
        Self::default()
    }

    /// Enqueue a query, returns its ticket and whether it runs right away
    pub fn enqueue(&mut self) -> (EmbeddedTicket, bool) {
        let ticket = self.next_ticket;
        self.next_ticket += 1;
        if self.running.is_none() && self.waiting.is_empty() {
            self.running = Some(ticket);
            (ticket, true)
        } else {
            self.waiting.push_back(ticket);
            (ticket, false)
        }
    }

    /// The query that runs
    pub fn running(&self) -> Option<EmbeddedTicket> {
        self.running
    }

    /// The queries that wait, in order
    pub fn waiting(&self) -> impl Iterator<Item = EmbeddedTicket> + '_ {
        self.waiting.iter().copied()
    }

    /// A query is done: its result was read to the end, it was cancelled, or it failed. A waiting query that is
    /// cancelled leaves the queue. Returns the query that runs next.
    pub fn finish(&mut self, ticket: EmbeddedTicket) -> Option<EmbeddedTicket> {
        if self.running == Some(ticket) {
            self.running = self.waiting.pop_front();
            return self.running;
        }
        self.waiting.retain(|waiting| *waiting != ticket);
        None
    }
}

/// The metrics of the response stream of a query of the embedded Hyper. The times are milliseconds of a monotonic
/// clock of the host.
#[derive(Debug, Clone, PartialEq)]
pub struct EmbeddedStreamMetrics {
    /// When the query started
    started_at: f64,
    /// The metrics so far
    metrics: QueryExecutionMetrics,
}

impl EmbeddedStreamMetrics {
    /// The metrics of a query that started, one request
    pub fn new(started_at: f64) -> Self {
        Self {
            started_at,
            metrics: QueryExecutionMetrics { total_query_requests_started: 1, ..QueryExecutionMetrics::default() },
        }
    }

    /// The metrics so far
    pub fn metrics(&self) -> &QueryExecutionMetrics {
        &self.metrics
    }

    fn since_start(&self, now: f64) -> i64 {
        (now - self.started_at).round() as i64
    }

    /// A batch arrived. Returns whether the host should yield to the browser, after every eighth batch.
    pub fn record_batch(&mut self, data_bytes: u64, rows: u64, now: f64) -> bool {
        if self.metrics.duration_until_first_batch_ms.is_none() {
            self.metrics.duration_until_first_batch_ms = Some(self.since_start(now));
        }
        self.metrics.total_data_bytes_received += data_bytes;
        self.metrics.total_batches_received += 1;
        self.metrics.total_rows_received += rows;
        self.metrics.total_batches_received % 8 == 0
    }

    /// The result was read to the end
    pub fn succeed(&mut self, now: f64) {
        self.metrics.total_query_requests_succeeded = 1;
        self.metrics.total_query_request_duration_ms = self.since_start(now);
    }

    /// Reading the result failed, the host cancels the query in the database
    pub fn fail(&mut self, now: f64) {
        self.metrics.total_query_requests_failed = 1;
        self.metrics.total_query_request_duration_ms = self.since_start(now);
    }
}
