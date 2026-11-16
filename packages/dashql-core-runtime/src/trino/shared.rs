//! The Trino channel of a connection, shared by every query that runs on the connection.
//!
//! The connection owns the channel from the moment its setup made it ready (`TrinoAction::ChannelReady`): the endpoint,
//! the auth with the OAuth access token and the default catalog and schema. The queries of the connection (the ones of
//! the user, the metadata queries of the catalog loader, the probes of the health checks, the statements of the runs of
//! workbooks) borrow it. An access token about to expire is refreshed once for all of them: the first query that needs
//! a fresh token starts the refresh, the others wait for its outcome. The refresh runs to its end even if the query
//! that started it is cancelled, so a rotating refresh token is never sent twice.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use super::error::{TrinoError, TrinoErrorKind, TrinoResult};
use super::protocol::{TokenRefresh, TrinoAccessToken, TrinoChannel, TrinoRequest};
use super::time::Millis;
use crate::host::signal::{oneshot, Receiver, Sender};
use crate::http::{FetchOutcome, HttpRequest};

/// How a request may proceed with the access token of a shared channel
pub enum TokenCheck {
    /// The token is fresh, or the channel doesn't refresh tokens
    Fresh,
    /// The caller starts the refresh: it sends the request and passes the outcome to `finish_token_refresh`, all
    /// callers wait for the receiver
    Started { request: HttpRequest, refreshed: Receiver<TrinoResult<()>> },
    /// A refresh runs already, wait for its outcome
    Pending(Receiver<TrinoResult<()>>),
}

struct SharedState {
    channel: TrinoChannel,
    /// The callers that wait for the refresh that runs
    waiters: Vec<Sender<TrinoResult<()>>>,
}

/// A Trino channel that the queries of a connection share. Clones refer to the same channel.
#[derive(Clone)]
pub struct SharedTrinoChannel {
    state: Rc<RefCell<SharedState>>,
}

impl SharedTrinoChannel {
    /// Share a channel
    pub fn new(channel: TrinoChannel) -> Self {
        Self { state: Rc::new(RefCell::new(SharedState { channel, waiters: Vec::new() })) }
    }

    /// The channel as it is now, e.g. with the current access token
    pub fn channel(&self) -> TrinoChannel {
        self.state.borrow().channel.clone()
    }

    /// The access token of the channel, none for basic auth
    pub fn access_token(&self) -> Option<TrinoAccessToken> {
        self.state.borrow().channel.access_token.clone()
    }

    /// The HTTP request of a request of the protocol with the current auth headers
    pub fn http_request(&self, request: &TrinoRequest) -> TrinoResult<HttpRequest> {
        self.state.borrow().channel.http_request(request)
    }

    /// Check the access token before a request at a time. A token about to expire is refreshed once, the first caller
    /// starts the refresh and every caller waits for it.
    pub fn check_token(&self, now: Millis) -> TokenCheck {
        let mut state = self.state.borrow_mut();
        match state.channel.begin_token_refresh(now) {
            TokenRefresh::NotNeeded => TokenCheck::Fresh,
            TokenRefresh::Started(request) => {
                let (sender, refreshed) = oneshot();
                state.waiters.push(sender);
                TokenCheck::Started { request, refreshed }
            }
            TokenRefresh::Pending => {
                let (sender, refreshed) = oneshot();
                state.waiters.push(sender);
                TokenCheck::Pending(refreshed)
            }
        }
    }

    /// Apply the outcome of the refresh that a caller started and tell everyone who waits for it. Returns the new
    /// token. A failed refresh keeps the old token, the waiting requests fail with the error.
    pub fn finish_token_refresh(&self, outcome: &FetchOutcome, now: Millis) -> TrinoResult<TrinoAccessToken> {
        let (result, waiters) = {
            let mut state = self.state.borrow_mut();
            let result = state.channel.finish_token_refresh(outcome, now).and_then(|()| {
                state.channel.access_token.clone().ok_or_else(|| TrinoError::protocol("The refresh left no access token"))
            });
            (result, std::mem::take(&mut state.waiters))
        };
        for waiter in waiters {
            waiter.send(result.clone().map(|_| ()));
        }
        result
    }

    /// Do two values refer to the same channel?
    pub fn same(&self, other: &SharedTrinoChannel) -> bool {
        Rc::ptr_eq(&self.state, &other.state)
    }
}

/// The outcome of waiting for a refresh, a refresh whose sender went away failed
pub fn refresh_outcome(received: Option<TrinoResult<()>>) -> TrinoResult<()> {
    received.unwrap_or_else(|| Err(TrinoError::new(TrinoErrorKind::OAuth, "The refresh of the access token ended without an outcome")))
}

impl PartialEq for SharedTrinoChannel {
    fn eq(&self, other: &Self) -> bool {
        self.same(other)
    }
}

impl Eq for SharedTrinoChannel {}

/// Names the endpoint only, never the credentials
impl fmt::Debug for SharedTrinoChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let endpoint = self.state.try_borrow().map(|state| state.channel.endpoint.clone()).unwrap_or_default();
        f.debug_struct("SharedTrinoChannel").field("endpoint", &endpoint).finish()
    }
}
