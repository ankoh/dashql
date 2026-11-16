//! The catalog loader as a service on a host: it follows the connections, schedules their updates and runs them.
//!
//! The host hands the service the connections of its registry (`follow`, `observe`) whenever the registry changed and
//! requests refreshes (`enqueue`). The service decides with the scheduler (`CatalogLoader`) what to update and runs an
//! update as a task: it drives the `CatalogUpdate` of the connection, runs its metadata queries through the query
//! executor of the host (`CatalogLoaderHost::run_query`), fetches the Data Cloud metadata of a Salesforce connection
//! over `HttpHost::fetch`, parses the catalog batches here and publishes into the catalog of the connection. The host
//! applies the start and the end of an update to the connection through its registry (`update_started`,
//! `update_finished`) and keeps the cancellation of an update: it calls `cancel` when it aborts one, e.g. when the
//! connection is reset. The client functions of the connections are registered on their catalogs on the way, the
//! host loads the specs.
//!
//! The service reads the connections that it follows as they are, a dispatch of the host changes them right away. It
//! keeps them as weak references: a connection that the host destroyed is gone for the service too.
//!
//! Ported from `CatalogLoaderService` of `packages/dashql/src/runtime/connections/catalog/catalog_loader_service.ts`.

use std::cell::{Ref, RefCell};
use std::collections::HashMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use arrow_array::RecordBatch;
use serde_json::Value;

use super::{
    CatalogGenerations, CatalogLoadError, CatalogLoader, CatalogLoaderCommand, CatalogLoaderConnection, CatalogQuery,
    CatalogStep, CatalogUpdate, CatalogUpdateOutcome,
};
use crate::clfn::{ClientFunctionRegistrations, ClientFunctionRegistryEffect};
use crate::connections::{CatalogUpdateTask, CatalogUpdateTaskStatus, ConnectionAction, ConnectionState, RelationName};
use crate::host::signal::{oneshot, Sender};
use crate::host::{join_all, HostError, LocalFuture, LogLevel};
use crate::http::{CancellationToken, HttpHost, HttpResponse};
use crate::query::QueryExecutionHistory;
use crate::salesforce::api::get_salesforce_data_space;
use crate::salesforce::{SalesforceMetadataLoad, SalesforceTokens};

/// The target of the log messages of the loader
pub const LOG_TARGET: &str = "catalog_loader";
/// The target of the log messages about the metadata of Salesforce
const SALESFORCE_LOG_TARGET: &str = "salesforce_catalog";
/// The reason of an update that a forced refresh aborted
pub const SUPERSEDED_MESSAGE: &str = "Superseded by forced catalog refresh";
/// The reason of an update whose connection is gone or got another catalog
pub const STALE_MESSAGE: &str = "Catalog refresh was cancelled or superseded";
/// How often a running update logs that it still runs
const HEARTBEAT_MS: f64 = 5000.0;

/// The batches of the result of a metadata query
pub type QueryBatches = Vec<RecordBatch>;

/// What the catalog loader asks of the host
pub trait CatalogLoaderHost: HttpHost {
    /// An update started. The host registers it with its connection (`ConnectionAction::UpdateCatalog`) and keeps a
    /// cancellation that calls `CatalogLoaderService::cancel`.
    fn update_started(&self, connection_id: &str, task: &CatalogUpdateTask);
    /// An update ended. The host applies the action of the outcome to the connection
    /// (`CatalogUpdateOutcome::connection_action`) and analyzes the scripts of the connection again if the outcome
    /// announces the new catalog.
    fn update_finished(&self, connection_id: &str, task_id: u32, outcome: &CatalogUpdateOutcome);
    /// Run a metadata query of an update on its connection through the query executor, registered with the update
    /// (`ConnectionAction::CatalogUpdateRegisterQuery`). Returns the batches of the result, an empty result has none.
    /// A failed query fails, a cancellation of the token stops it.
    fn run_query(
        &self,
        connection_id: &str,
        task_id: u32,
        query: &CatalogQuery,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<QueryBatches, HostError>> + 'static;
    /// Load the spec of the client functions of an extension, the JSON text
    fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static;
    /// The catalog of a connection changed outside of an update, e.g. it registered client functions. The scripts that
    /// use the connection are analyzed again.
    fn catalog_changed(&self, connection_id: &str);
}

/// A connection that the loader follows: its state and the history of its queries, shared with the host
#[derive(Clone)]
pub struct FollowedConnection {
    pub state: Rc<RefCell<ConnectionState>>,
    pub queries: Rc<RefCell<QueryExecutionHistory>>,
}

/// What the loader keeps of a connection
struct Followed {
    state: Weak<RefCell<ConnectionState>>,
    queries: Weak<RefCell<QueryExecutionHistory>>,
}

impl Followed {
    fn upgrade(&self) -> Option<FollowedConnection> {
        Some(FollowedConnection { state: self.state.upgrade()?, queries: self.queries.upgrade()? })
    }
}

/// A running update
struct Task {
    /// Cancelled by `cancel`
    token: CancellationToken,
    /// Why it was cancelled
    reason: Option<String>,
}

/// The timer of the next scheduling pass
struct Wake {
    at: f64,
    generation: u64,
    token: CancellationToken,
}

struct LoaderState {
    scheduler: CatalogLoader,
    generations: CatalogGenerations,
    /// The connections by id, in the order of the registry
    connections: Vec<(String, Followed)>,
    registrations: ClientFunctionRegistrations,
    /// The calls that wait for the spec of a registration that loads, by connection
    spec_waiters: Vec<(String, Sender<()>)>,
    tasks: HashMap<u32, Task>,
    /// Is a scheduling pass requested?
    scheduled: bool,
    stopped: bool,
    wake: Option<Wake>,
    wake_generation: u64,
}

/// The catalog loader of the connections of a host
pub struct CatalogLoaderService<H: CatalogLoaderHost> {
    host: Rc<H>,
    state: Rc<RefCell<LoaderState>>,
}

impl<H: CatalogLoaderHost> Clone for CatalogLoaderService<H> {
    fn clone(&self) -> Self {
        Self { host: self.host.clone(), state: self.state.clone() }
    }
}

/// The wait before the loader schedules a refresh again that a busy connection held back
const BUSY_RETRY_MS: f64 = 10.0;

/// The views of the scheduler on connections that are borrowed
fn views<'a>(borrowed: &'a [(String, Ref<'a, ConnectionState>, usize)]) -> Vec<CatalogLoaderConnection<'a>> {
    borrowed
        .iter()
        .map(|(id, state, active_queries)| CatalogLoaderConnection {
            connection_id: id,
            health: state.health(),
            params: state.params(),
            details: state.details(),
            catalog_updates: state.catalog_updates(),
            active_queries: *active_queries,
        })
        .collect()
}

/// The states of connections that the loader borrows, and the ids of the busy ones that an action borrows mutably
type Borrowed<'a> = (Vec<(String, Ref<'a, ConnectionState>, usize)>, Vec<String>);

/// Borrow the states of connections. A connection that is borrowed mutably is busy, the scheduler keeps its requests.
fn borrow_all(connections: &[(String, FollowedConnection)]) -> Borrowed<'_> {
    let mut borrowed = Vec::with_capacity(connections.len());
    let mut busy = Vec::new();
    for (id, connection) in connections {
        match connection.state.try_borrow() {
            Ok(state) => {
                let active = connection.queries.try_borrow().map(|queries| queries.active_ids().len()).unwrap_or(0);
                borrowed.push((id.clone(), state, active));
            }
            Err(_) => busy.push(id.clone()),
        }
    }
    (borrowed, busy)
}

impl<H: CatalogLoaderHost> CatalogLoaderService<H> {
    /// A loader that schedules once it is started
    pub fn new(host: Rc<H>) -> Self {
        let state = LoaderState {
            scheduler: CatalogLoader::new(),
            generations: CatalogGenerations::default(),
            connections: Vec::new(),
            registrations: ClientFunctionRegistrations::default(),
            spec_waiters: Vec::new(),
            tasks: HashMap::new(),
            scheduled: false,
            stopped: true,
            wake: None,
            wake_generation: 0,
        };
        Self { host, state: Rc::new(RefCell::new(state)) }
    }

    pub fn host(&self) -> &Rc<H> {
        &self.host
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let mut with_target: Vec<(&str, &str)> = details.to_vec();
        with_target.push(("target", LOG_TARGET));
        self.host.log(level, message, &with_target);
    }

    /// The connections that are still there, in order
    fn live_connections(&self) -> Vec<(String, FollowedConnection)> {
        let state = self.state.borrow();
        state.connections.iter().filter_map(|(id, followed)| Some((id.clone(), followed.upgrade()?))).collect()
    }

    /// The connection of an id, if it's still there
    fn connection(&self, connection_id: &str) -> Option<FollowedConnection> {
        let state = self.state.borrow();
        state.connections.iter().find(|(id, _)| id == connection_id).and_then(|(_, followed)| followed.upgrade())
    }

    /// Follow a connection of the registry under its id, it replaces another connection of the id
    pub fn follow(&self, connection_id: &str, connection: &FollowedConnection) {
        let followed = Followed { state: Rc::downgrade(&connection.state), queries: Rc::downgrade(&connection.queries) };
        let mut state = self.state.borrow_mut();
        match state.connections.iter_mut().find(|(id, _)| id == connection_id) {
            Some((_, current)) => *current = followed,
            None => state.connections.push((connection_id.to_string(), followed)),
        }
    }

    /// Is a connection followed with this state?
    pub fn follows(&self, connection_id: &str, connection: &Rc<RefCell<ConnectionState>>) -> bool {
        self.connection(connection_id).is_some_and(|followed| Rc::ptr_eq(&followed.state, connection))
    }

    /// The registry changed and holds the connections of the ids, in their order. The loader forgets the others,
    /// registers the client functions of the connectors, describes the connections that came online and schedules.
    pub fn observe(&self, connection_ids: &[String]) {
        {
            let mut state = self.state.borrow_mut();
            let mut connections = std::mem::take(&mut state.connections);
            let mut ordered = Vec::with_capacity(connection_ids.len());
            for id in connection_ids {
                if let Some(index) = connections.iter().position(|(followed, _)| followed == id) {
                    ordered.push(connections.swap_remove(index));
                }
            }
            for (gone, _) in connections {
                state.registrations.forget(&gone);
            }
            state.connections = ordered;
        }
        let connections = self.live_connections();

        // The client functions of a connection come with its connector, scripts that call them are analyzed again
        let mut effects = Vec::new();
        for (id, connection) in &connections {
            let Ok(connection_state) = connection.state.try_borrow() else { continue };
            effects.extend(self.state.borrow_mut().registrations.ensure_of(id, Some(&connection_state)));
        }
        self.run_registry_effects(effects);

        {
            let (borrowed, busy) = borrow_all(&connections);
            let views = views(&borrowed);
            self.state.borrow_mut().scheduler.observe(&views, &busy);
        }
        self.request_schedule();
    }

    /// Run what the registrations of client functions ask for
    fn run_registry_effects(&self, effects: Vec<ClientFunctionRegistryEffect>) {
        for effect in effects {
            match effect {
                ClientFunctionRegistryEffect::Updated { connection_id } => self.host.catalog_changed(&connection_id),
                ClientFunctionRegistryEffect::LoadSpec { connection_id, extension, ticket } => {
                    let service = self.clone();
                    let load = self.host.load_spec(extension);
                    self.host.spawn(Box::pin(async move {
                        let spec = load.await;
                        service.spec_loaded(&connection_id, ticket, spec);
                    }));
                }
            }
        }
    }

    /// The spec of a connection arrived or failed to load
    fn spec_loaded(&self, connection_id: &str, ticket: u64, spec: Result<String, HostError>) {
        let connection = self.connection(connection_id);
        let (registered, waiters) = {
            let connection_state = connection.as_ref().and_then(|connection| connection.state.try_borrow().ok());
            let spec = spec.as_deref().map_err(|error| error.message().to_string());
            let mut state = self.state.borrow_mut();
            let registered = state.registrations.spec_loaded_of(connection_id, connection_state.as_deref(), ticket, spec);
            let (waiters, others) = std::mem::take(&mut state.spec_waiters).into_iter().partition(|(id, _)| id == connection_id);
            state.spec_waiters = others;
            (registered, waiters)
        };
        let waiters: Vec<(String, Sender<()>)> = waiters;
        for (_, waiter) in waiters {
            waiter.send(());
        }
        match registered {
            Ok(effects) => self.run_registry_effects(effects),
            // It stays unregistered: a script then gets no checks and no completion, and a call goes to the backend.
            // The next change of the registry tries again, a chunk of the spec may only have failed to load.
            Err(error) => self.log(
                LogLevel::Error,
                "Failed to register client functions",
                &[("connectionId", connection_id), ("error", &error.message)],
            ),
        }
    }

    /// The spec of the client functions that the catalog of a connection registered, the one that its calls run with.
    /// A spec that loads is awaited. None after its registration failed: the core then describes no calls of the
    /// connection.
    pub fn client_function_spec(&self, connection_id: &str) -> impl Future<Output = Option<Rc<crate::clfn::ClientFunctionSpec>>> + 'static {
        let service = self.clone();
        let connection_id = connection_id.to_string();
        async move {
            loop {
                let waiting = {
                    let connection = service.connection(&connection_id)?;
                    let connection_state = connection.state.try_borrow().ok()?;
                    let mut state = service.state.borrow_mut();
                    if let Some(spec) = state.registrations.spec_of(&connection_id, &connection_state) {
                        return Some(spec);
                    }
                    if !state.registrations.loading_of(&connection_id, &connection_state) {
                        return None;
                    }
                    let (sender, receiver) = oneshot();
                    state.spec_waiters.push((connection_id.clone(), sender));
                    receiver
                };
                // A load that ends wakes the waiters, the registration says how it went
                waiting.await?;
            }
        }
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update
    pub fn enqueue(&self, connection_id: &str, force: bool) {
        self.state.borrow_mut().scheduler.enqueue(connection_id, force);
        self.request_schedule();
    }

    /// Start scheduling, e.g. again after `stop`
    pub fn start(&self) {
        self.state.borrow_mut().stopped = false;
        self.request_schedule();
    }

    /// Stop scheduling, running updates finish
    pub fn stop(&self) {
        let wake = {
            let mut state = self.state.borrow_mut();
            state.stopped = true;
            state.wake.take()
        };
        if let Some(wake) = wake {
            wake.token.cancel();
        }
    }

    /// The host aborted an update, e.g. its connection was reset. The update ends as cancelled with the reason.
    pub fn cancel(&self, task_id: u32, reason: &str) {
        let token = {
            let mut state = self.state.borrow_mut();
            let Some(task) = state.tasks.get_mut(&task_id) else { return };
            task.reason.get_or_insert_with(|| reason.to_string());
            task.token.clone()
        };
        token.cancel();
    }

    /// Is an update running?
    pub fn is_running(&self, task_id: u32) -> bool {
        self.state.borrow().tasks.contains_key(&task_id)
    }

    /// Schedule at the end of the task
    fn request_schedule(&self) {
        {
            let mut state = self.state.borrow_mut();
            if state.scheduled || state.stopped {
                return;
            }
            state.scheduled = true;
        }
        let service = self.clone();
        self.host.spawn(Box::pin(async move {
            let run = {
                let mut state = service.state.borrow_mut();
                state.scheduled = false;
                !state.stopped
            };
            if run {
                service.schedule();
            }
        }));
    }

    /// Start and abort the updates that the requests and the relations of executed statements ask for
    fn schedule(&self) {
        let connections = self.live_connections();
        let schedule = {
            let (borrowed, busy) = borrow_all(&connections);
            let views = views(&borrowed);
            let now = self.host.now();
            self.state.borrow_mut().scheduler.schedule(&views, &busy, now)
        };
        // A busy connection is free again once the action that borrows it ended, the loader looks again shortly
        if schedule.retry {
            self.wake_at(self.host.now() + BUSY_RETRY_MS);
        }
        for command in schedule.commands {
            match command {
                CatalogLoaderCommand::Abort { task_id, .. } => self.cancel(task_id, SUPERSEDED_MESSAGE),
                CatalogLoaderCommand::Start { connection_id, task_id, relations } => {
                    let service = self.clone();
                    self.host.spawn(Box::pin(async move {
                        let _ = service.run_update(&connection_id, task_id, relations).await;
                        let now = service.host.now();
                        service.state.borrow_mut().scheduler.finished(&connection_id, now);
                        // Pending requests are considered again, also if the registry doesn't change
                        service.request_schedule();
                    }));
                }
            }
        }
        if let Some(at) = schedule.wake_at {
            self.wake_at(at);
        }
    }

    /// Schedule again at a time, the earliest time wins
    fn wake_at(&self, at: f64) {
        let (generation, token) = {
            let mut state = self.state.borrow_mut();
            if state.stopped || state.wake.as_ref().is_some_and(|wake| wake.at <= at) {
                return;
            }
            if let Some(previous) = state.wake.take() {
                previous.token.cancel();
            }
            state.wake_generation += 1;
            let wake = Wake { at, generation: state.wake_generation, token: CancellationToken::new() };
            let armed = (wake.generation, wake.token.clone());
            state.wake = Some(wake);
            armed
        };
        let service = self.clone();
        let sleep = self.host.sleep((at - self.host.now()).max(0.0));
        self.host.spawn(Box::pin(async move {
            if token.run(sleep).await.is_none() {
                return;
            }
            {
                let mut state = service.state.borrow_mut();
                if state.wake.as_ref().is_some_and(|wake| wake.generation == generation) {
                    state.wake = None;
                }
            }
            service.request_schedule();
        }));
    }

    /// Is an update still the one of its connection: the connection is followed with this state and runs the update?
    fn is_current(&self, connection_id: &str, connection: &FollowedConnection, task_id: u32) -> bool {
        self.follows(connection_id, &connection.state)
            && connection.state.try_borrow().is_ok_and(|state| state.catalog_updates().tasks_running.contains_key(&task_id))
    }

    /// The reason of a cancelled update
    fn reason(&self, task_id: u32) -> String {
        let state = self.state.borrow();
        state.tasks.get(&task_id).and_then(|task| task.reason.clone()).unwrap_or_else(|| STALE_MESSAGE.to_string())
    }

    /// Run an update of a connection to its end
    async fn run_update(&self, connection_id: &str, task_id: u32, relations: Option<Vec<RelationName>>) -> Result<(), CatalogLoadError> {
        let Some(connection) = self.connection(connection_id) else {
            self.log(LogLevel::Warn, "Failed to resolve connection", &[("connectionId", connection_id)]);
            return Err(CatalogLoadError::failed(format!("couldn't find a connection with id {connection_id}")));
        };
        let what = relations.as_ref().map_or_else(|| "all".to_string(), |relations| relations.len().to_string());
        self.log(LogLevel::Info, "Starting catalog update", &[("connectionId", connection_id), ("relations", &what)]);
        let started = {
            let connection_state = connection
                .state
                .try_borrow()
                .map_err(|_| CatalogLoadError::failed("the connection is in use"))?;
            let mut state = self.state.borrow_mut();
            CatalogUpdate::start(&connection_state, task_id, relations, &mut state.generations, self.host.now())
        };
        let (mut update, action) = match started {
            Ok(started) => started,
            Err(error) => {
                self.log(LogLevel::Warn, "Catalog update failed", &[("connectionId", connection_id), ("error", error.message())]);
                return Err(error);
            }
        };
        let token = CancellationToken::new();
        self.state.borrow_mut().tasks.insert(task_id, Task { token: token.clone(), reason: None });
        if let ConnectionAction::UpdateCatalog(task) = &action {
            self.host.update_started(connection_id, task);
        }
        let started_at = self.host.now();
        let done = self.heartbeat(connection_id, task_id, started_at);

        let outcome = loop {
            let step = {
                if token.is_cancelled() {
                    update.cancel(&self.reason(task_id));
                }
                let state = self.state.borrow();
                update.next(&state.generations)
            };
            match step {
                CatalogStep::Finished(outcome) => break outcome,
                CatalogStep::Query(queries) => {
                    let runs: Vec<LocalFuture<Result<Vec<RecordBatch>, HostError>>> = queries
                        .iter()
                        .map(|query| Box::pin(self.host.run_query(connection_id, task_id, query, &token)) as LocalFuture<_>)
                        .collect();
                    match token.run(join_all(runs)).await {
                        Some(results) if !token.is_cancelled() => update.answer_queries(
                            results.into_iter().map(|result| result.map_err(|error| error.message().to_string())).collect(),
                        ),
                        _ => update.cancel(&self.reason(task_id)),
                    }
                }
                CatalogStep::FetchSalesforceMetadata => {
                    match token.run(self.salesforce_metadata(&connection, &token)).await {
                        Some(metadata) if !token.is_cancelled() => update.answer_salesforce_metadata(metadata),
                        _ => update.cancel(&self.reason(task_id)),
                    }
                }
                // The batches parse here, the restore parses the catalog files the same way
                CatalogStep::ProcessBatch(batch) => update.answer_batch(batch.process().map_err(|error| error.message().to_string())),
                CatalogStep::Publish => {
                    if token.is_cancelled() {
                        update.cancel(&self.reason(task_id));
                        continue;
                    }
                    // The connection is gone, got another catalog or dropped the update, e.g. it was reset
                    if !self.is_current(connection_id, &connection, task_id) {
                        update.cancel(STALE_MESSAGE);
                        continue;
                    }
                    let catalog = match connection.state.try_borrow() {
                        Ok(state) => state.catalog().clone(),
                        Err(_) => {
                            update.abort(CatalogLoadError::failed("the connection is in use"));
                            continue;
                        }
                    };
                    let mut catalog = match catalog.try_borrow_mut() {
                        Ok(catalog) => catalog,
                        Err(_) => {
                            update.abort(CatalogLoadError::failed("the catalog is in use"));
                            continue;
                        }
                    };
                    let state = self.state.borrow();
                    update.publish(&mut catalog, &state.generations);
                }
            }
        };
        done.cancel();
        self.state.borrow_mut().tasks.remove(&task_id);
        self.finish(connection_id, task_id, &connection, &outcome, started_at);
        Ok(())
    }

    /// Log that an update still runs every few seconds, until the returned token is cancelled
    fn heartbeat(&self, connection_id: &str, task_id: u32, started_at: f64) -> CancellationToken {
        let done = CancellationToken::new();
        let service = self.clone();
        let stop = done.clone();
        let connection_id = connection_id.to_string();
        self.host.spawn(Box::pin(async move {
            loop {
                if stop.run(service.host.sleep(HEARTBEAT_MS)).await.is_none() {
                    return;
                }
                let elapsed = format!("{:.0}", service.host.now() - started_at);
                service.log(
                    LogLevel::Info,
                    "Catalog update in progress",
                    &[("connectionId", &connection_id), ("updateId", &task_id.to_string()), ("elapsedMs", &elapsed)],
                );
            }
        }));
        done
    }

    /// Finish an update: set the text of the function script, log the outcome and let the host apply it
    fn finish(&self, connection_id: &str, task_id: u32, connection: &FollowedConnection, outcome: &CatalogUpdateOutcome, started_at: f64) {
        if let Some(text) = &outcome.function_script_text {
            let replaced = match connection.state.try_borrow_mut() {
                Ok(mut state) => state.replace_function_script_text(text).map_err(|error| error.message),
                Err(_) => Err("the connection is in use".to_string()),
            };
            if let Err(error) = replaced {
                self.log(LogLevel::Warn, "Failed to keep the function script", &[("connectionId", connection_id), ("error", &error)]);
            }
        }
        for warning in &outcome.warnings {
            self.log(LogLevel::Warn, warning, &[("connectionId", connection_id)]);
        }
        let error = outcome.error.clone().unwrap_or_default();
        match outcome.status {
            CatalogUpdateTaskStatus::Succeeded | CatalogUpdateTaskStatus::Started => {
                self.log(LogLevel::Debug, "Updated catalog", &[("connectionId", connection_id)])
            }
            CatalogUpdateTaskStatus::PartiallySucceeded => {
                self.log(LogLevel::Warn, "Partially updated the catalog", &[("connectionId", connection_id), ("failed", &error)])
            }
            CatalogUpdateTaskStatus::Cancelled => {
                self.log(LogLevel::Info, "Cancelled catalog update", &[("connectionId", connection_id), ("error", &error)])
            }
            CatalogUpdateTaskStatus::Failed => {
                self.log(LogLevel::Error, "Failed to update catalog", &[("connectionId", connection_id), ("error", &error)])
            }
        }
        self.host.update_finished(connection_id, task_id, outcome);
        let duration = format!("{:.0}", self.host.now() - started_at);
        self.log(
            LogLevel::Info,
            "Finished catalog update",
            &[("connectionId", connection_id), ("updateId", &task_id.to_string()), ("durationMs", &duration)],
        );
    }

    /// The Data Cloud metadata of a Salesforce connection from the metadata API of the instance, one request per entity
    /// type at the same time
    async fn salesforce_metadata(
        &self,
        connection: &FollowedConnection,
        token: &CancellationToken,
    ) -> Result<Value, String> {
        let tokens = {
            let state = connection.state.try_borrow().map_err(|_| "the connection is in use".to_string())?;
            let oauth = state.details().salesforce().and_then(|salesforce| salesforce.oauth_state.as_ref());
            let core = oauth.and_then(|oauth| oauth.core_access_token.clone()).unwrap_or_default();
            let data_cloud = oauth.and_then(|oauth| oauth.data_cloud_access_token.clone()).unwrap_or_default();
            SalesforceTokens::from_json(&core, &data_cloud).ok_or_else(|| "Salesforce core access token is missing".to_string())?
        };
        let data_space = get_salesforce_data_space(&tokens.data_cloud);
        self.host.log(LogLevel::Info, "Resolving Salesforce catalog metadata", &[("dataSpace", &data_space), ("target", SALESFORCE_LOG_TARGET)]);
        let started_at = self.host.now();
        let metadata = self.fetch_salesforce_metadata(&tokens, &data_space, token).await?;
        let entities = metadata.get("metadata").and_then(Value::as_array).map_or(0, Vec::len).to_string();
        let duration = format!("{:.2}", self.host.now() - started_at);
        self.host.log(
            LogLevel::Info,
            "Received Salesforce catalog metadata",
            &[("dataSpace", &data_space), ("entities", &entities), ("durationMs", &duration), ("target", SALESFORCE_LOG_TARGET)],
        );
        Ok(metadata)
    }

    /// Fetch the Data Cloud metadata of a data space over the HTTP client of the host
    async fn fetch_salesforce_metadata(&self, tokens: &SalesforceTokens, data_space: &str, token: &CancellationToken) -> Result<Value, String> {
        let (mut load, _) = SalesforceMetadataLoad::new(&tokens.core, data_space);
        let requests: Vec<LocalFuture<Result<HttpResponse, HostError>>> =
            load.requests().iter().map(|request| Box::pin(self.host.fetch(request.clone(), token)) as LocalFuture<_>).collect();
        let responses = join_all(requests).await;
        for (index, response) in responses.iter().enumerate() {
            let failure = match response {
                Ok(response) => load.on_response(index, response).and_then(|(_, failure)| failure),
                Err(error) => load.on_failure(index, error.message()).map(|(_, failure)| failure),
            };
            if let Some(failure) = failure {
                self.host.log(
                    LogLevel::Warn,
                    "Salesforce metadata request failed",
                    &[
                        ("dataSpace", &failure.data_space),
                        ("entityType", &failure.entity_type),
                        ("error", &failure.error),
                        ("target", SALESFORCE_LOG_TARGET),
                    ],
                );
            }
        }
        let metadata = load.finish().map_err(|error| error.message)?;
        serde_json::to_value(metadata).map_err(|error| error.to_string())
    }
}
