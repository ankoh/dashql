//! The client functions of a connection: the binding of its connector, the registration of the spec on the catalog of
//! the connection, and starting a call of the connection.
//!
//! A connection has its client functions as soon as it exists, before any login. `ClientFunctionRegistrations::ensure`
//! runs on every change of the registry: it asks the host to load the spec of a connector with a binding, and
//! `spec_loaded` registers it on the catalog of the connection. A spec that failed to load is tried again on the next
//! change, and the spec is dropped if the connection switches to a connector without it. Clearing the catalog keeps
//! the specs, they come with the connector.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use dashql_core::catalog::Catalog;

use super::request::{http_request, ClientFunctionHostTarget, ClientFunctionRequest, ClientFunctionVariables};
use super::result::ClientFunctionResult;
use super::runtime::{explain_client_function_call, CallStep, ClientFunctionCallRun};
use super::spec::{ClientFunctionCallDescription, ClientFunctionSpec};
use std::fmt;

use super::ClientFunctionError;
use crate::connections::{ConnectionChannel, ConnectionState, ConnectorType};
use crate::http::HttpRequest;

/// The client functions of a connector: where its spec is, the variables of its base paths and how its hosts resolve.
/// A connector with client functions hands out its binding (`Connector::client_functions`).
pub trait ClientFunctionBinding: Sync + fmt::Debug {
    /// The folder of the extension of the spec in `extensions/`
    fn extension(&self) -> &'static str;

    /// The values of the variables in the base paths of the spec. They need no login, `EXPLAIN` prints them.
    fn variables(&self) -> ClientFunctionVariables;

    /// Where a host that the spec names is on a connection, and the credentials for it, which the channel of the
    /// connection holds
    fn resolve_host(
        &self,
        channel: Option<&ConnectionChannel>,
        host: &str,
        now: f64,
    ) -> Result<ClientFunctionHostTarget, ClientFunctionError>;

    /// The HTTP request of a request of a call on a connection
    fn http_request(
        &self,
        channel: Option<&ConnectionChannel>,
        request: &ClientFunctionRequest,
        now: f64,
    ) -> Result<HttpRequest, ClientFunctionError> {
        http_request(request, &self.resolve_host(channel, &request.host, now)?)
    }
}

/// The binding of the client functions of a connector, an error if its connections have none
pub fn client_function_binding(
    connector: ConnectorType,
) -> Result<&'static dyn ClientFunctionBinding, ClientFunctionError> {
    let connector = connector.connector();
    connector.client_functions().ok_or_else(|| {
        ClientFunctionError::new(format!("{} connections have no client functions", connector.display_name()))
    })
}

/// What the host does for the client functions of connections
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientFunctionRegistryEffect {
    /// Load the spec of an extension and pass its text to `spec_loaded` with the ticket
    LoadSpec { connection_id: String, extension: &'static str, ticket: u64 },
    /// The client functions of the connection changed, its scripts are outdated
    Updated { connection_id: String },
}

/// What a catalog holds of a binding
#[derive(Debug)]
struct Registration {
    /// The catalog of the connection
    catalog: Weak<RefCell<Catalog>>,
    /// The binding
    binding: &'static dyn ClientFunctionBinding,
    /// The spec as the runtime reads it once it's registered, none while it loads
    spec: Option<Rc<ClientFunctionSpec>>,
    /// The load of the spec that this registration waits for
    ticket: u64,
}

/// The registrations of the client functions on the catalogs of connections. A catalog belongs to one connection.
#[derive(Debug, Default)]
pub struct ClientFunctionRegistrations {
    by_connection: HashMap<String, Registration>,
    next_ticket: u64,
}

impl ClientFunctionRegistrations {
    /// The registration of a connection, if it's on the catalog the connection has now
    fn registration(&self, connection: &ConnectionState) -> Option<&Registration> {
        let registration = self.by_connection.get(connection.connection_id())?;
        let catalog = registration.catalog.upgrade()?;
        Rc::ptr_eq(&catalog, connection.catalog()).then_some(registration)
    }

    /// Make the catalog of a connection hold the client functions of its connector
    pub fn ensure(&mut self, connection: &ConnectionState) -> Vec<ClientFunctionRegistryEffect> {
        let connection_id = connection.connection_id().to_string();
        let binding = client_function_binding(connection.connector_type()).ok();
        let registered = self.registration(connection).map(|r| (r.binding, r.spec.clone()));
        if registered.as_ref().map(|(binding, _)| binding.extension()) == binding.map(|binding| binding.extension()) {
            return Vec::new();
        }
        let mut effects = Vec::new();
        // A registration of another catalog stays with it, the catalog of the connection never had it
        self.by_connection.remove(&connection_id);
        // The connection switched its connector
        if let Some((_, Some(spec))) = registered {
            connection.catalog().borrow_mut().drop_client_functions(&spec.namespace);
            effects.push(ClientFunctionRegistryEffect::Updated { connection_id: connection_id.clone() });
        }
        let Some(binding) = binding else { return effects };
        self.next_ticket += 1;
        let ticket = self.next_ticket;
        self.by_connection.insert(
            connection_id.clone(),
            Registration { catalog: Rc::downgrade(connection.catalog()), binding, spec: None, ticket },
        );
        effects.push(ClientFunctionRegistryEffect::LoadSpec { connection_id, extension: binding.extension(), ticket });
        effects
    }

    /// The spec of a load arrived, or its load failed. The connection may be gone by now, or have switched its
    /// connector, then nothing happens. A spec that fails stays unregistered: a script then gets no checks and no
    /// completion, and a call goes to the backend. The next `ensure` tries again, the error is for the log.
    pub fn spec_loaded(
        &mut self,
        connection: Option<&ConnectionState>,
        ticket: u64,
        spec: Result<&str, String>,
    ) -> Result<Vec<ClientFunctionRegistryEffect>, ClientFunctionError> {
        let Some(connection) = connection else { return Ok(Vec::new()) };
        if self.registration(connection).is_none_or(|r| r.ticket != ticket || r.spec.is_some()) {
            return Ok(Vec::new());
        }
        let connection_id = connection.connection_id().to_string();
        let registered = spec.map_err(ClientFunctionError::new).and_then(|json| {
            let runtime_spec = ClientFunctionSpec::from_json(json)?;
            connection
                .catalog()
                .borrow_mut()
                .register_client_functions(json)
                .map_err(|e| ClientFunctionError::new(e.to_string()))?;
            Ok(runtime_spec)
        });
        match registered {
            Ok(runtime_spec) => {
                if let Some(registration) = self.by_connection.get_mut(&connection_id) {
                    registration.spec = Some(Rc::new(runtime_spec));
                }
                Ok(vec![ClientFunctionRegistryEffect::Updated { connection_id }])
            }
            Err(error) => {
                self.by_connection.remove(&connection_id);
                Err(ClientFunctionError::new(format!("Failed to register client functions: {error}")))
            }
        }
    }

    /// The spec of the client functions that a connection has registered
    pub fn spec(&self, connection: &ConnectionState) -> Option<Rc<ClientFunctionSpec>> {
        self.registration(connection)?.spec.clone()
    }

    /// Does the spec of a registration of a connection still load?
    pub fn loading(&self, connection: &ConnectionState) -> bool {
        self.registration(connection).is_some_and(|registration| registration.spec.is_none())
    }

    /// Forget a connection that was deleted
    pub fn forget(&mut self, connection_id: &str) {
        self.by_connection.remove(connection_id);
    }
}

/// A call of a connection that started
#[derive(Debug)]
pub enum ConnectionCallStart {
    /// `EXPLAIN` finished, it sends nothing
    Explained(ClientFunctionResult),
    /// The call runs, the step says what the host does first
    Running { binding: &'static dyn ClientFunctionBinding, run: ClientFunctionCallRun, step: CallStep },
}

/// Start a client function call of a connection with the spec of its connector. A run hands its rows over page by page,
/// `EXPLAIN` sends nothing and its result is complete.
pub fn start_connection_client_function(
    connector: ConnectorType,
    spec: Rc<ClientFunctionSpec>,
    description: &ClientFunctionCallDescription,
    now: f64,
) -> Result<ConnectionCallStart, ClientFunctionError> {
    let binding = client_function_binding(connector)?;
    if spec.namespace != description.namespace {
        return Err(ClientFunctionError::new(format!(
            "{} connections have no client functions in {}",
            connector.connector().display_name(),
            description.namespace
        )));
    }
    let variables = binding.variables();
    if description.explain {
        return Ok(ConnectionCallStart::Explained(explain_client_function_call(&spec, description, &variables)?));
    }
    let (run, step) = ClientFunctionCallRun::start(spec, description, variables, now)?;
    Ok(ConnectionCallStart::Running { binding, run, step })
}
