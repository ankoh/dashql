//! The sessions of the host on connections of the runtime, e.g. the shell on the embedded Hyper: the host runs its
//! statements with the query executor of the runtime, which tells the catalog loader about the relations they touched.
//!
//! A session leases its connection: a later session takes it over, and only the latest lease stops the connection
//! when it closes. A shell that unmounts while its successor sets the connection up leaves the connection alone.

use std::cell::{Cell, RefCell};

use dashql_core_runtime::connections::ConnectionAction;
use dashql_core_runtime::host::{Host, LogLevel};
use js_sys::Promise;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

use super::Runtime;

/// How long a wait for a catalog lasts at most, the catalog loader of a connection that went offline answers nothing
const SETTLE_TIMEOUT_MS: f64 = 10_000.0;
/// How often a wait for a catalog looks at the catalog updates of its connection
const SETTLE_INTERVAL_MS: f64 = 10.0;

/// The latest lease of the sessions of the host by connection
#[derive(Default)]
pub(crate) struct HostSessions {
    latest: RefCell<Vec<(String, u32)>>,
    next: Cell<u32>,
}

#[wasm_bindgen]
impl Runtime {
    /// Lease a connection for a session of the host, a later lease takes the connection over. Returns the lease that
    /// `closeSession` takes.
    #[wasm_bindgen(js_name = openSession)]
    pub fn open_session(&self, connection_id: &str) -> u32 {
        let lease = self.sessions.next.get().wrapping_add(1);
        self.sessions.next.set(lease);
        let mut latest = self.sessions.latest.borrow_mut();
        latest.retain(|(id, _)| id != connection_id);
        latest.push((connection_id.to_string(), lease));
        lease
    }

    /// Close a session of the host: the latest lease of the connection resets it, its channel closes the session. The
    /// runtime keeps the connection, a later session sets it up again. An earlier lease changes nothing.
    #[wasm_bindgen(js_name = closeSession)]
    pub fn close_session(&self, connection_id: &str, lease: u32) {
        let latest = {
            let mut sessions = self.sessions.latest.borrow_mut();
            let latest = sessions.iter().any(|(id, held)| id == connection_id && *held == lease);
            if latest {
                sessions.retain(|(id, _)| id != connection_id);
            }
            latest
        };
        if latest {
            if let Err(error) = self.connections.apply(connection_id, ConnectionAction::Reset, None) {
                self.platform.log_on(
                    LogLevel::Debug,
                    "Closing a session reset no connection",
                    &[("connectionId", connection_id), ("error", error.what())],
                    "runtime",
                );
            }
        }
    }

    /// Resolve once the catalog of a connection settled: no update runs and every relation that statements touched is
    /// answered, e.g. after a statement of the shell. Resolves after the timeout as well (10 s by default), and at once
    /// for an unknown connection: a catalog that doesn't follow never fails a statement.
    #[wasm_bindgen(js_name = settleCatalog, unchecked_return_type = "Promise<void>")]
    pub fn settle_catalog(&self, connection_id: String, timeout_ms: Option<f64>) -> Promise {
        let connections = self.connections.clone();
        let platform = self.platform.clone();
        let timeout = timeout_ms.filter(|ms| ms.is_finite() && *ms >= 0.0).unwrap_or(SETTLE_TIMEOUT_MS);
        future_to_promise(async move {
            let started = platform.now();
            loop {
                // A task that holds the connections or the connection changes its updates
                let settled =
                    connections.registry.try_borrow().is_ok_and(|registry| match registry.get(&connection_id) {
                        None => true,
                        Some(connection) => connection.state.try_borrow().is_ok_and(|state| {
                            let updates = state.catalog_updates();
                            updates.touched_relations.is_empty() && updates.tasks_running.is_empty()
                        }),
                    });
                if settled || platform.is_fenced() || platform.now() - started >= timeout {
                    return Ok(JsValue::UNDEFINED);
                }
                platform.sleep(SETTLE_INTERVAL_MS).await;
            }
        })
    }
}
