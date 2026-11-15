//! The wasm-bindgen API of a connection (`dashql_core_runtime::connections`) and its query history (`dashql_core_runtime::query`).
//!
//! A `Connection` holds the state of a connection and the history of its queries. An action is a method call with
//! typed arguments, the params, errors and relation names are views (`connection/view.rs`). It returns a
//! `ConnectionOutcome` with the effects for the host. A connection that is reset or deleted stops its queries: the
//! binding drops the history and names the active queries in the effect. The state is read as views: the connection,
//! the list of the queries with their revisions and each query. The catalog is shared with a `Catalog` handle, the
//! scripts of workbooks analyze with the same catalog. The query actions and the views of the queries are the ones of
//! a `QueryHistory` of its own (`query_history.rs`).

use std::cell::{Ref, RefCell};
use std::rc::Rc;

use dashql_core_runtime::catalog_loader::FollowedConnection;

use dashql_core::catalog::{Catalog as CoreCatalog, EntryIdSource};
use dashql_core::error::Error;
use dashql_core_runtime::connections::{
    CatalogUpdateTask, ConnectionAction, ConnectionDetails,
    ConnectionEffect as RuntimeEffect, ConnectionOutcome as RuntimeOutcome, ConnectionState, ConnectionStateOptions, DetailedError,
    HyperAction, OAuthPkceChallenge, SalesforceAction, TemporaryToken, TrinoAction,
};
use dashql_core_runtime::query::{QueryExecutionAction, QueryExecutionHistory};
use tsify::Ts;
use wasm_bindgen::prelude::*;

use super::query_history::{query_actions, query_outcome};
use super::views::{from_js, to_js};
use super::{js_error, Catalog, SharedCatalog, ENTRY_IDS};

pub(crate) mod view;

use view::{
    CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionEffect, ConnectionError, ConnectionOutcome, ConnectionRelationName,
    ConnectionTableName, ConnectionView, ConnectorType, JsonParams,
};

fn params(params: Ts<JsonParams>) -> Result<dashql_core_runtime::connections::ConnectionParams, JsError> {
    from_js(&params)?.connection_params().map_err(js_error)
}

/// The params of a connector, a JSON object without the field of the connector
fn connector_params(params: Ts<JsonParams>) -> Result<dashql_core_runtime::connections::JsonObject, JsError> {
    Ok(from_js(&params)?.0)
}

fn error(error: Ts<ConnectionError>) -> Result<DetailedError, JsError> {
    Ok(from_js(&error)?.into())
}

/// Views of the host, e.g. relation names
fn views<T: tsify::Tsify + serde::de::DeserializeOwned, R: From<T>>(values: Vec<Ts<T>>) -> Result<Vec<R>, JsError>
where
    T::JsType: Clone,
{
    values.iter().map(|value| from_js(value).map(R::from)).collect()
}

/// A connection with the history of its queries
#[wasm_bindgen]
pub struct Connection {
    /// Shared with the services of the runtime that follow the connection, e.g. the catalog loader
    state: Rc<RefCell<ConnectionState>>,
    queries: Rc<RefCell<QueryExecutionHistory>>,
}

impl Connection {
    /// A connection of a state that a service of the runtime created, e.g. the restore
    pub(crate) fn from_state(state: ConnectionState) -> Connection {
        Connection { state: Rc::new(RefCell::new(state)), queries: Rc::new(RefCell::new(QueryExecutionHistory::new())) }
    }

    /// The state of the connection, e.g. for the decisions of its persistence
    pub(crate) fn state(&self) -> Ref<'_, ConnectionState> {
        self.state.borrow()
    }

    /// The state and the queries, shared with a service that follows the connection
    pub(crate) fn followed(&self) -> FollowedConnection {
        FollowedConnection { state: self.state.clone(), queries: self.queries.clone() }
    }

    /// Apply an action to the connection. A connection that stops its queries drops the history.
    fn apply(&mut self, action: ConnectionAction, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let RuntimeOutcome { changed, effects } = self.state.borrow_mut().apply(action, now).map_err(js_error)?;
        let mut out = Vec::with_capacity(effects.len());
        for effect in effects {
            out.push(match effect {
                RuntimeEffect::CancelSetup => ConnectionEffect::CancelSetup,
                RuntimeEffect::InvalidateCatalogBatch => ConnectionEffect::InvalidateCatalogBatch,
                RuntimeEffect::AbortCatalogUpdates { task_ids } => ConnectionEffect::AbortCatalogUpdates { task_ids },
                RuntimeEffect::CloseChannel { channel } => ConnectionEffect::CloseChannel { channel },
                RuntimeEffect::ReleaseChannel { channel } => ConnectionEffect::ReleaseChannel { channel },
                RuntimeEffect::StopQueries => {
                    let (query_ids, cleared) = self.queries.borrow_mut().clear();
                    out.push(ConnectionEffect::StopQueries { query_ids });
                    out.extend(query_outcome(cleared).effects);
                    continue;
                }
            });
        }
        to_js(&ConnectionOutcome { changed, effects: out })
    }

    /// Apply an action to the queries
    fn apply_query(&mut self, action: QueryExecutionAction) -> Result<Ts<ConnectionOutcome>, JsError> {
        let outcome = self.queries.borrow_mut().apply(action).map_err(js_error)?;
        to_js(&query_outcome(outcome))
    }

    fn read_queries<R>(&self, read: impl FnOnce(&QueryExecutionHistory) -> R) -> R {
        read(&self.queries.borrow())
    }
}

#[wasm_bindgen]
impl Connection {
    /// A connection of a connector with an empty catalog. The setup params of the details are the params of the
    /// connector without its field, none if the details have none. The params default to the setup params.
    #[wasm_bindgen(constructor)]
    pub fn new(
        connection_id: &str,
        connector_type: ConnectorType,
        setup_params: Option<Ts<JsonParams>>,
        active: bool,
        params: Option<Ts<JsonParams>>,
        params_draft: Option<Ts<JsonParams>>,
        now: f64,
    ) -> Result<Connection, JsError> {
        let mut details = ConnectionDetails::default_for(connector_type.into());
        details.setup_params = setup_params.map(connector_params).transpose()?;
        let options = ConnectionStateOptions {
            active,
            params: params.map(self::params).transpose()?,
            params_draft: params_draft.map(self::params).transpose()?,
        };
        let catalog = CoreCatalog::with_entry_ids(ENTRY_IDS.with(EntryIdSource::clone));
        let state = ConnectionState::with_catalog(connection_id, details, options, now, catalog);
        Ok(Connection::from_state(state))
    }

    // The connection

    #[wasm_bindgen(js_name = setDraft)]
    pub fn set_draft(&mut self, draft: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let draft = params(draft)?;
        self.apply(ConnectionAction::SetDraft(draft), now)
    }

    #[wasm_bindgen(js_name = discardDraft)]
    pub fn discard_draft(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::DiscardDraft, now)
    }

    #[wasm_bindgen(js_name = commitParams)]
    pub fn commit_params(&mut self, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = self::params(params)?;
        self.apply(ConnectionAction::CommitParams(params), now)
    }

    pub fn rename(&mut self, name: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Rename(name), now)
    }

    #[wasm_bindgen(js_name = setQueryResultCaching)]
    pub fn set_query_result_caching(&mut self, caching: bool, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::SetQueryResultCaching(caching), now)
    }

    /// Stop the connection and drop its catalog and queries
    pub fn delete(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Delete, now)
    }

    /// Stop the connection and clear its catalog and queries
    pub fn reset(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Reset, now)
    }

    #[wasm_bindgen(js_name = switchConnectorType)]
    pub fn switch_connector_type(&mut self, connector_type: ConnectorType, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::SwitchConnectorType(connector_type.into()), now)
    }

    // The health check

    #[wasm_bindgen(js_name = healthCheckStarted)]
    pub fn health_check_started(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::HealthCheckStarted, now)
    }

    #[wasm_bindgen(js_name = healthCheckCancelled)]
    pub fn health_check_cancelled(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::HealthCheckCancelled, now)
    }

    #[wasm_bindgen(js_name = healthCheckFailed)]
    pub fn health_check_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::HealthCheckFailed(error), now)
    }

    #[wasm_bindgen(js_name = healthCheckSucceeded)]
    pub fn health_check_succeeded(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::HealthCheckSucceeded, now)
    }

    // The catalog updates

    /// Executed statements touched relations, the names have nulls for the parts that a statement left out
    #[wasm_bindgen(js_name = relationsTouched)]
    pub fn relations_touched(&mut self, names: Vec<Ts<ConnectionTableName>>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::RelationsTouched(views(names)?), now)
    }

    /// A catalog update started
    #[wasm_bindgen(js_name = updateCatalog)]
    pub fn update_catalog(
        &mut self,
        task_id: u32,
        variant: CatalogUpdateVariant,
        started_at: Option<f64>,
        touched_relations: Vec<Ts<ConnectionRelationName>>,
        now: f64,
    ) -> Result<Ts<ConnectionOutcome>, JsError> {
        let mut task = CatalogUpdateTask::new(task_id, variant.into(), now);
        task.started_at = started_at;
        task.touched_relations = views(touched_relations)?;
        self.apply(ConnectionAction::UpdateCatalog(task), now)
    }

    #[wasm_bindgen(js_name = catalogUpdateRegisterQuery)]
    pub fn catalog_update_register_query(&mut self, task_id: u32, query_id: u32, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::CatalogUpdateRegisterQuery { task_id, query_id }, now)
    }

    /// A catalog update finished with a final status, an update that didn't succeed with an error
    #[wasm_bindgen(js_name = catalogUpdateFinished)]
    pub fn catalog_update_finished(
        &mut self,
        task_id: u32,
        status: CatalogUpdateTaskStatus,
        error: Option<Ts<ConnectionError>>,
        now: f64,
    ) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = || -> Result<DetailedError, JsError> { error.map(self::error).unwrap_or_else(|| Ok(DetailedError::default())) };
        let action = match status {
            CatalogUpdateTaskStatus::SUCCEEDED => ConnectionAction::CatalogUpdateSucceeded { task_id },
            CatalogUpdateTaskStatus::FAILED => ConnectionAction::CatalogUpdateFailed { task_id, error: error()? },
            CatalogUpdateTaskStatus::CANCELLED => ConnectionAction::CatalogUpdateCancelled { task_id, error: error()? },
            CatalogUpdateTaskStatus::PARTIALLY_SUCCEEDED => ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, error: error()? },
            CatalogUpdateTaskStatus::STARTED => return Err(js_error(Error::invalid_argument("a catalog update can't finish as started"))),
        };
        self.apply(action, now)
    }

    /// Restore the state of the catalog updates from the files of the catalog, none keeps a field. The connection
    /// changes its revision.
    #[wasm_bindgen(js_name = restoreCatalogUpdates)]
    pub fn restore_catalog_updates(&mut self, described: Option<bool>, touched_relations: Option<Vec<Ts<ConnectionRelationName>>>) -> Result<(), JsError> {
        let touched = touched_relations.map(views).transpose()?;
        self.state.borrow_mut().restore_catalog_updates(described, touched);
        Ok(())
    }

    // The setup of Hyper

    #[wasm_bindgen(js_name = hyperChannelSetupStarted)]
    pub fn hyper_channel_setup_started(&mut self, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = hyperChannelSetupCancelled)]
    pub fn hyper_channel_setup_cancelled(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = hyperChannelSetupFailed)]
    pub fn hyper_channel_setup_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = hyperChannelReady)]
    pub fn hyper_channel_ready(&mut self, channel: u32, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Hyper(HyperAction::ChannelReady { channel, params }), now)
    }

    // The setup of Trino

    #[wasm_bindgen(js_name = trinoOAuthStarted)]
    pub fn trino_oauth_started(&mut self, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthStarted { params }), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthCancelled)]
    pub fn trino_oauth_cancelled(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthFailed)]
    pub fn trino_oauth_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthFailed(error)), now)
    }

    #[wasm_bindgen(js_name = trinoGeneratingPkceChallenge)]
    pub fn trino_generating_pkce_challenge(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::GeneratingPkceChallenge), now)
    }

    #[wasm_bindgen(js_name = trinoGeneratedPkceChallenge)]
    pub fn trino_generated_pkce_challenge(&mut self, value: String, verifier: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::GeneratedPkceChallenge(OAuthPkceChallenge { value, verifier })), now)
    }

    #[wasm_bindgen(js_name = trinoOAuthBrowserOpened)]
    pub fn trino_oauth_browser_opened(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::OAuthBrowserOpened), now)
    }

    #[wasm_bindgen(js_name = trinoReceivedOAuthCode)]
    pub fn trino_received_oauth_code(&mut self, token: String, created_at: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ReceivedOAuthCode(TemporaryToken { token, created_at })), now)
    }

    #[wasm_bindgen(js_name = trinoRequestingAccessToken)]
    pub fn trino_requesting_access_token(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::RequestingAccessToken), now)
    }

    /// The access token arrived, opaque JSON
    #[wasm_bindgen(js_name = trinoReceivedAccessToken)]
    pub fn trino_received_access_token(&mut self, token: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ReceivedAccessToken(token)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupStarted)]
    pub fn trino_channel_setup_started(&mut self, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupCancelled)]
    pub fn trino_channel_setup_cancelled(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelSetupFailed)]
    pub fn trino_channel_setup_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = trinoChannelReady)]
    pub fn trino_channel_ready(&mut self, channel: u32, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Trino(TrinoAction::ChannelReady(channel)), now)
    }

    // The setup of Salesforce and Database.com

    #[wasm_bindgen(js_name = salesforceSetupStarted)]
    pub fn salesforce_setup_started(&mut self, params: Ts<JsonParams>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let params = connector_params(params)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupStarted { params }), now)
    }

    #[wasm_bindgen(js_name = salesforceSetupCancelled)]
    pub fn salesforce_setup_cancelled(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceSetupFailed)]
    pub fn salesforce_setup_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::SetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceGeneratingPkceChallenge)]
    pub fn salesforce_generating_pkce_challenge(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::GeneratingPkceChallenge), now)
    }

    #[wasm_bindgen(js_name = salesforceGeneratedPkceChallenge)]
    pub fn salesforce_generated_pkce_challenge(&mut self, value: String, verifier: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let pkce = OAuthPkceChallenge { value, verifier };
        self.apply(ConnectionAction::Salesforce(SalesforceAction::GeneratedPkceChallenge(pkce)), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthNativeLinkOpened)]
    pub fn salesforce_oauth_native_link_opened(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthNativeLinkOpened), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthWebWindowOpened)]
    pub fn salesforce_oauth_web_window_opened(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthWebWindowOpened), now)
    }

    #[wasm_bindgen(js_name = salesforceOAuthWebWindowClosed)]
    pub fn salesforce_oauth_web_window_closed(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::OAuthWebWindowClosed), now)
    }

    #[wasm_bindgen(js_name = salesforceReceivedCoreAuthCode)]
    pub fn salesforce_received_core_auth_code(&mut self, token: String, created_at: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let code = TemporaryToken { token, created_at };
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthCode(code)), now)
    }

    #[wasm_bindgen(js_name = salesforceRequestingCoreAuthToken)]
    pub fn salesforce_requesting_core_auth_token(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::RequestingCoreAuthToken), now)
    }

    /// The core access token arrived, opaque JSON
    #[wasm_bindgen(js_name = salesforceReceivedCoreAuthToken)]
    pub fn salesforce_received_core_auth_token(&mut self, token: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthToken(token)), now)
    }

    #[wasm_bindgen(js_name = salesforceReceivedCoreUserInfo)]
    pub fn salesforce_received_core_user_info(
        &mut self,
        preferred_username: Option<String>,
        email: Option<String>,
        now: f64,
    ) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreUserInfo { preferred_username, email }), now)
    }

    #[wasm_bindgen(js_name = salesforceRequestingDataCloudAccessToken)]
    pub fn salesforce_requesting_data_cloud_access_token(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::RequestingDataCloudAccessToken), now)
    }

    /// The Data Cloud access token arrived, opaque JSON
    #[wasm_bindgen(js_name = salesforceReceivedDataCloudAccessToken)]
    pub fn salesforce_received_data_cloud_access_token(&mut self, token: String, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ReceivedDataCloudAccessToken(token)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupStarted)]
    pub fn salesforce_channel_setup_started(&mut self, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupStarted), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupCancelled)]
    pub fn salesforce_channel_setup_cancelled(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupCancelled(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelSetupFailed)]
    pub fn salesforce_channel_setup_failed(&mut self, error: Ts<ConnectionError>, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        let error = self::error(error)?;
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelSetupFailed(error)), now)
    }

    #[wasm_bindgen(js_name = salesforceChannelReady)]
    pub fn salesforce_channel_ready(&mut self, channel: u32, now: f64) -> Result<Ts<ConnectionOutcome>, JsError> {
        self.apply(ConnectionAction::Salesforce(SalesforceAction::ChannelReady(channel)), now)
    }

    // Reading the state

    /// The revision of the connection, it changes with every change of the connection, not of its queries
    pub fn revision(&self) -> f64 {
        self.state.borrow().revision() as f64
    }

    /// The revision of the queries, it changes with every change of a query
    #[wasm_bindgen(js_name = queriesRevision)]
    pub fn queries_revision(&self) -> f64 {
        self.queries.borrow().revision() as f64
    }

    /// The catalog, shared with the connection
    pub fn catalog(&self) -> Catalog {
        Catalog { inner: SharedCatalog(self.state.borrow().catalog().clone()) }
    }

    /// The text of the script with the functions of the connection, none once it is deleted
    #[wasm_bindgen(js_name = functionScriptText)]
    pub fn function_script_text(&self) -> Option<String> {
        self.state.borrow().function_script().map(|script| script.to_text())
    }

    /// Replace the text of the script with the functions of the connection
    #[wasm_bindgen(js_name = replaceFunctionScriptText)]
    pub fn replace_function_script_text(&mut self, text: &str) -> Result<(), JsError> {
        self.state.borrow_mut().replace_function_script_text(text).map_err(js_error)
    }

    /// The plain fields of the connection, the queries are read on their own
    pub fn snapshot(&self) -> Result<Ts<ConnectionView>, JsError> {
        to_js(&ConnectionView::from(&*self.state.borrow()))
    }
}

query_actions!(Connection);
