//! The catalog loader of the runtime (docs/design/dashql_core.md, docs/design/catalog_updates.md): the service of the
//! crate (`dashql_core_runtime::catalog_loader::service`) on the connections and the executor of the runtime.
//!
//! The loader follows the registry of the connections, a change of the registry asks it to follow again at the end of
//! the task. The start and the end of an update are actions of the connection, the metadata queries are queries of the
//! connection that the runtime runs itself (`run_internal`), a reset or a delete of the connection cancels its updates.
//! A new catalog is announced in the view of the connection (`catalogVersion`): the workbooks analyze the scripts that
//! use the connection again.

use std::future::Future;
use std::rc::{Rc, Weak};

use dashql_core_runtime::catalog_loader::service::LOG_TARGET;
use dashql_core_runtime::catalog_loader::CATALOG_QUERY_ISSUER;
use dashql_core_runtime::catalog_loader::{
    CatalogLoaderHost, CatalogLoaderService, CatalogQuery, CatalogUpdateOutcome, FollowedConnection, QueryBatches,
};
use dashql_core_runtime::connections::{CatalogUpdateTask, CatalogUpdateTaskStatus, ConnectionAction};
use dashql_core_runtime::executor::ipc;
use dashql_core_runtime::host::{Host, HostError, LogLevel, OnHost};
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::QueryMetadata;

use super::connections::Connections;
use crate::host::JsPlatform;

/// The catalog loader of a runtime
pub(crate) type CatalogLoader = CatalogLoaderService<LoaderHost>;

/// The host of the catalog loader: the connections of the runtime, weakly, and the platform
pub(crate) struct LoaderHost {
    connections: Weak<Connections>,
    platform: JsPlatform,
}

impl LoaderHost {
    pub fn new(connections: Weak<Connections>, platform: JsPlatform) -> Self {
        Self { connections, platform }
    }

    fn connections(&self) -> Result<Rc<Connections>, HostError> {
        self.connections.upgrade().ok_or_else(|| HostError::new("the runtime was destroyed"))
    }

    /// Apply an action of an update to its connection, an update of a connection that is gone changes nothing
    fn apply(&self, connection_id: &str, action: ConnectionAction, changed: Option<bool>) {
        let Some(connections) = self.connections.upgrade() else { return };
        if let Err(error) = connections.apply(connection_id, action, changed) {
            connections.log(
                LogLevel::Debug,
                "A catalog update changed nothing",
                &[("connectionId", connection_id), ("error", error.what())],
            );
        }
    }
}

impl OnHost for LoaderHost {
    type Inner = JsPlatform;

    fn inner_host(&self) -> &JsPlatform {
        &self.platform
    }

    /// The detail `target` names the target of the log
    fn log_on_host(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let target = details.iter().find(|(key, _)| *key == "target").map_or(LOG_TARGET, |(_, value)| value);
        let details: Vec<(&str, &str)> = details.iter().filter(|(key, _)| *key != "target").copied().collect();
        self.platform.log_on(level, message, &details, target);
    }
}

impl HttpHost for LoaderHost {
    fn fetch(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.platform.send(request, cancellation, false)
    }
}

impl CatalogLoaderHost for LoaderHost {
    fn update_started(&self, connection_id: &str, task: &CatalogUpdateTask) {
        self.apply(connection_id, ConnectionAction::UpdateCatalog(task.clone()), None);
    }

    fn update_finished(&self, connection_id: &str, task_id: u32, outcome: &CatalogUpdateOutcome) {
        let changed = matches!(outcome.status, CatalogUpdateTaskStatus::Succeeded).then_some(outcome.catalog_changed);
        self.apply(connection_id, outcome.connection_action(task_id), changed);
        // The scripts that use the connection are analyzed again with the new catalog
        if outcome.announces() {
            if let Some(connections) = self.connections.upgrade() {
                connections.announce_catalog(connection_id);
            }
        }
    }

    fn run_query(
        &self,
        connection_id: &str,
        task_id: u32,
        query: &CatalogQuery,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<QueryBatches, HostError>> + 'static {
        let metadata = QueryMetadata {
            title: Some(query.title.clone()),
            issuer: Some(CATALOG_QUERY_ISSUER.to_string()),
            user_provided: false,
            ..QueryMetadata::new(query.query_type)
        };
        let started = self.connections().map(|connections| {
            let (query_id, done) = {
                let read_timeout_ms = query.read_timeout.then(|| self.platform.settings().catalog_query_timeout_ms);
                connections.run_internal(connection_id, &query.sql, metadata, read_timeout_ms, true, cancellation)
            };
            let registered = u32::try_from(query_id)
                .ok()
                .map(|query_id| ConnectionAction::CatalogUpdateRegisterQuery { task_id, query_id });
            if let Some(registered) = registered {
                self.apply(connection_id, registered, None);
            }
            done
        });
        async move {
            let table = started?.await.map_err(|failure| HostError::new(failure.message))?;
            let Some(bytes) = table else { return Ok(Vec::new()) };
            let (_, batches) = ipc::read_stream(&bytes).map_err(HostError::new)?;
            Ok(batches)
        }
    }

    fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static {
        self.platform.load_spec(extension)
    }

    fn catalog_changed(&self, connection_id: &str) {
        if let Some(connections) = self.connections.upgrade() {
            connections.announce_catalog(connection_id);
        }
    }

    fn connection_changed(&self, connection_id: &str) {
        self.platform.changed(super::changes::Slice::Connection(connection_id), true);
    }
}

impl Connections {
    /// The catalog loader, none once the runtime is destroyed
    pub(crate) fn loader(&self) -> Option<CatalogLoader> {
        self.loader.borrow().clone()
    }

    /// Let the catalog loader follow the registry at the end of the task, once for any number of changes
    pub(crate) fn follow_later(self: &Rc<Self>) {
        if self.follow_requested.replace(true) {
            return;
        }
        let connections = Rc::downgrade(self);
        self.platform.spawn(Box::pin(async move {
            let Some(connections) = connections.upgrade() else { return };
            connections.follow_requested.set(false);
            connections.follow();
        }));
    }

    /// Let the catalog loader and the runs follow the connections of the registry in their order
    pub(crate) fn follow(&self) {
        let listener = self.follow_listener.borrow().clone();
        if let Some(listener) = listener {
            listener();
        }
        let Some(loader) = self.loader() else { return };
        let followed: Vec<(String, FollowedConnection)> = {
            let registry = self.registry.borrow();
            registry.connections().map(|(id, connection)| (id.to_string(), connection.clone())).collect()
        };
        loader.observe(&followed);
    }

    /// Announce a new catalog of a connection in its view
    pub(crate) fn announce_catalog(&self, connection_id: &str) {
        let listener = self.catalog_listener.borrow().clone();
        if let Some(listener) = listener {
            listener(connection_id);
        }
        self.platform.changed(super::changes::Slice::Connection(connection_id), true);
    }
}
