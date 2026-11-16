//! The channel of a Salesforce connection, shared by every query that runs on the connection.
//!
//! The connection owns the channel from the moment its setup made it ready (`SalesforceAction::ChannelReady`): the HTTP
//! API of the Hyper of Data Cloud and the tokens of the login, the core token and the Data Cloud token. The channel is
//! the one owner of the tokens: the queries, the catalog loader and the client functions read them from it. A Data
//! Cloud token about to expire is refreshed once for all of them with the refresh token of the core login: the first
//! caller starts the refresh in a task of its own that runs to its end, the others wait for its outcome.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use serde_json::Value;

use super::api::{
    collect_salesforce_auth_info, data_cloud_access_token_request, form_post, read_core_access_token_response,
    read_data_cloud_access_token_response,
};
use super::setup::hyper_cloud_attached_database;
use super::types::{SalesforceConnectionParams, SalesforceCoreAccessToken, SalesforceTokens};
use crate::connections::ConnectorType;
use crate::host::signal::{oneshot, Receiver, Sender};
use crate::host::timeout;
use crate::http::{CancellationToken, Headers, HttpHost, HttpRequest};
use crate::hyper::client::AttachedDatabase;
use crate::hyper::{HyperChannelContext, HyperHttpChannel};
use crate::trino::time::parse_iso_timestamp;

/// How long before its expiry a Data Cloud token is refreshed
pub const TOKEN_REFRESH_MARGIN_MS: f64 = 60.0 * 1000.0;
/// How long a refresh of the tokens may take, a refresh that takes longer fails
pub const TOKEN_REFRESH_TIMEOUT_MS: f64 = 30.0 * 1000.0;

/// The outcome of a refresh as the waiting callers see it, the message of a failure
pub type RefreshOutcome = Result<(), String>;

struct SharedState {
    /// The HTTP API of the Hyper of Data Cloud
    hyper: HyperHttpChannel,
    /// The tokens of the login
    tokens: SalesforceTokens,
    /// The connected app that refreshes the core token
    params: SalesforceConnectionParams,
    /// The callers that wait for the refresh that runs, none if no refresh runs
    refresh: Option<Vec<Sender<RefreshOutcome>>>,
}

/// The channel of a Salesforce connection. Clones refer to the same channel.
#[derive(Clone)]
pub struct SharedSalesforceChannel {
    state: Rc<RefCell<SharedState>>,
}

/// What a caller does before it uses the tokens
enum TokenCheck {
    /// The tokens are fresh, or they can't be refreshed
    Fresh,
    /// The caller starts the refresh with the core token, everyone waits for the receiver
    Started { core: SalesforceCoreAccessToken, refreshed: Receiver<RefreshOutcome> },
    /// A refresh runs already
    Pending(Receiver<RefreshOutcome>),
}

impl SharedSalesforceChannel {
    /// The channel of a connection with the tokens of its login: the Hyper of the Data Cloud tenant, the Hyper Cloud
    /// database of a Database.com connection
    pub fn new(connector: ConnectorType, params: &SalesforceConnectionParams, tokens: SalesforceTokens) -> Result<Self, String> {
        let attached_databases = if connector == ConnectorType::Dbcom {
            let database = hyper_cloud_attached_database(params);
            vec![AttachedDatabase { path: database.path, alias: Some(database.alias) }]
        } else {
            Vec::new()
        };
        let context = HyperChannelContext { attached_databases, ..Default::default() };
        let mut endpoint = serde_json::Map::new();
        endpoint.insert("endpoint".to_string(), Value::String(tokens.data_cloud.instance_url.clone()));
        let hyper = HyperHttpChannel::connect(&endpoint, context, None).map_err(|error| error.message())?;
        let state = SharedState { hyper, tokens, params: params.clone(), refresh: None };
        Ok(Self { state: Rc::new(RefCell::new(state)) })
    }

    /// The HTTP API of the Hyper of Data Cloud
    pub fn hyper(&self) -> HyperHttpChannel {
        self.state.borrow().hyper.clone()
    }

    /// The tokens as they are now
    pub fn tokens(&self) -> SalesforceTokens {
        self.state.borrow().tokens.clone()
    }

    /// The headers of every request to the Hyper of Data Cloud: the tenant as the audience and the Data Cloud JWT
    pub fn auth(&self) -> Headers {
        let state = self.state.borrow();
        let info = collect_salesforce_auth_info(&state.tokens.core, &state.tokens.data_cloud);
        let audience = info.as_ref().and_then(|info| info.offcore_tenant_id.clone()).unwrap_or_default();
        let jwt = info.map(|info| info.offcore_raw_jwt).unwrap_or_default();
        Headers::from_pairs([("audience", audience), ("authorization", format!("Bearer {jwt}"))])
    }

    /// Does the Data Cloud token expire soon? A token without a readable expiry never does.
    fn expires_soon(&self, now: f64) -> bool {
        let state = self.state.borrow();
        parse_iso_timestamp(&state.tokens.data_cloud.expires_at).is_some_and(|expires_at| expires_at as f64 - now <= TOKEN_REFRESH_MARGIN_MS)
    }

    /// Check the tokens at a time: a token about to expire with a refresh token is refreshed once for every caller
    fn check(&self, now: f64) -> TokenCheck {
        if !self.expires_soon(now) {
            return TokenCheck::Fresh;
        }
        let mut state = self.state.borrow_mut();
        let (sender, refreshed) = oneshot();
        if let Some(waiters) = state.refresh.as_mut() {
            waiters.push(sender);
            return TokenCheck::Pending(refreshed);
        }
        if state.tokens.core.refresh_token.as_deref().is_none_or(str::is_empty) {
            return TokenCheck::Fresh;
        }
        state.refresh = Some(vec![sender]);
        TokenCheck::Started { core: state.tokens.core.clone(), refreshed }
    }

    /// Make sure that the tokens are fresh before a caller uses them. The refresh runs in a task of its own that runs to
    /// its end, so a caller that stops waiting never drops a refresh that others wait for. Fails with the message of a
    /// failed refresh, the old tokens stay.
    pub async fn fresh<H: HttpHost>(&self, host: &Rc<H>) -> RefreshOutcome {
        let refreshed = match self.check(host.now()) {
            TokenCheck::Fresh => return Ok(()),
            TokenCheck::Pending(refreshed) => refreshed,
            TokenCheck::Started { core, refreshed } => {
                let channel = self.clone();
                let task_host = host.clone();
                host.spawn(Box::pin(async move {
                    let outcome = timeout(&*task_host, TOKEN_REFRESH_TIMEOUT_MS, channel.refresh(&task_host, core)).await;
                    let outcome = outcome.unwrap_or_else(|| Err("The refresh of the Salesforce tokens timed out".to_string()));
                    channel.finish(outcome);
                }));
                refreshed
            }
        };
        refreshed.await.unwrap_or_else(|| Err("The refresh of the Salesforce tokens ended without an outcome".to_string()))
    }

    /// Refresh the core token and exchange it for a new Data Cloud token
    async fn refresh<H: HttpHost>(&self, host: &Rc<H>, core: SalesforceCoreAccessToken) -> Result<SalesforceTokens, String> {
        let params = self.state.borrow().params.clone();
        let request = core_refresh_request(&params, &core);
        let response = host.fetch(request.clone(), &CancellationToken::new()).await.map_err(|error| error.message().to_string())?;
        let mut refreshed = read_core_access_token_response(&request, &response, host.now()).map_err(|error| error.message)?;
        // A server that doesn't rotate refresh tokens keeps the one of the login
        if refreshed.refresh_token.is_none() {
            refreshed.refresh_token = core.refresh_token;
        }
        let request = data_cloud_access_token_request(&refreshed);
        let response = host.fetch(request.clone(), &CancellationToken::new()).await.map_err(|error| error.message().to_string())?;
        let data_cloud = read_data_cloud_access_token_response(&request, &response, host.now()).map_err(|error| error.message)?;
        Ok(SalesforceTokens { core: refreshed, data_cloud })
    }

    /// Keep the tokens of a refresh and tell everyone who waits for it
    fn finish(&self, outcome: Result<SalesforceTokens, String>) {
        let (result, waiters) = {
            let mut state = self.state.borrow_mut();
            let result = outcome.map(|tokens| state.tokens = tokens);
            (result, state.refresh.take().unwrap_or_default())
        };
        for waiter in waiters {
            waiter.send(result.clone());
        }
    }

    /// The params of the connected app of the login
    pub fn params(&self) -> SalesforceConnectionParams {
        self.state.borrow().params.clone()
    }

    /// Do two values refer to the same channel?
    pub fn same(&self, other: &SharedSalesforceChannel) -> bool {
        Rc::ptr_eq(&self.state, &other.state)
    }
}

/// The request that refreshes the core token with the refresh token of the login
pub fn core_refresh_request(params: &SalesforceConnectionParams, core: &SalesforceCoreAccessToken) -> HttpRequest {
    let instance = core.instance_url.as_deref().filter(|url| !url.is_empty()).unwrap_or(params.instance_url.as_str());
    let mut pairs = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", core.refresh_token.as_deref().unwrap_or_default()),
        ("client_id", params.app_consumer_key.as_str()),
        ("format", "json"),
    ];
    if !params.app_consumer_secret.is_empty() {
        pairs.push(("client_secret", params.app_consumer_secret.as_str()));
    }
    form_post(format!("{instance}/services/oauth2/token"), &pairs)
}

impl PartialEq for SharedSalesforceChannel {
    fn eq(&self, other: &Self) -> bool {
        self.same(other)
    }
}

/// Names the endpoint only, never the tokens
impl fmt::Debug for SharedSalesforceChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let endpoint = self.state.try_borrow().map(|state| state.tokens.data_cloud.instance_url.clone()).unwrap_or_default();
        f.debug_struct("SharedSalesforceChannel").field("endpoint", &endpoint).finish()
    }
}
