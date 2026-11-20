//! The Trino connector without I/O: the REST protocol, the result pages as Arrow and the query as a state machine.
//!
//! The connector does no I/O. It produces HTTP requests as data and reads the responses that the host passes back,
//! the protocols with several steps are state machines that take what the host received and return what to do next.
//! The host sends the requests, runs the timers, opens the login in the browser and generates the PKCE challenge.
//!
//! - `protocol`: the channel (endpoint, auth, OAuth token, the default catalog and schema), its requests and the
//!   responses with their errors, the retries of result pages.
//! - `arrow`: the Arrow types of Trino types and the rows of a page as a record batch.
//! - `stream`: a query, from the statement to the last page, with the QueryInfos of its profile.
//! - `shared`: the channel of a connection that its queries share, with the one refresh of its access token.
//! - `descriptor`: the params to share, the login hint and the signature of cached results.
//!
//! The state of a Trino connection and its setup actions are in `connections`, the setup of a connection is
//! `connection_setup::setup_trino`, the catalog loader of Trino is not here.

pub mod arrow;
pub mod connector;
pub mod descriptor;
pub mod error;
pub mod protocol;
pub mod shared;
pub mod stream;

pub use crate::http::{FetchOutcome, HttpMethod, HttpRequest, HttpResponse};
pub use arrow::{
    parse_trino_timestamp_ms, parse_trino_type, rows_to_record_batch, trino_schema, NoTimeZones, TimeZoneOffsets,
};
pub use error::{TrinoError, TrinoErrorKind, TrinoResult};
pub use protocol::{
    read_cancel_response, TokenRefresh, TrinoAccessToken, TrinoAuthParams, TrinoAuthType, TrinoChannel, TrinoColumn,
    TrinoOAuthParams, TrinoQueryError, TrinoQueryResult, TrinoRequest, TrinoRetryPolicy, DEFAULT_TRINO_RETRY_POLICY,
    TARGET_RESULT_SIZE,
};
pub use shared::{refresh_outcome, SharedTrinoChannel, TokenCheck};
pub use stream::{RequestId, StreamOutput, TimerId, TrinoQuery, TrinoQueryOptions};
