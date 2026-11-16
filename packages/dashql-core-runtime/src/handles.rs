//! The handles of the host: the JavaScript objects that a state names by a number, e.g. the channel of a connection,
//! the result table of a query or the lifetime of a computation. See docs/design/dashql_runtime.md.
//!
//! The host keeps the objects in one table and hands a handle over with the action that gives the object to a state.
//! From then on the state owns the handle: it keeps it where it keeps the object and releases it with an effect when
//! it lets go of it, also right away when the action didn't take it, e.g. the result of a query that finished already.
//! An action that fails leaves the handle with the caller. The effects of the states on handles are three:
//!
//! - **release**: forget the object,
//! - **close**: close the object (a channel) and forget it,
//! - **abort**: abort the object (a cancellation, the record of a query, a lifetime) with a reason. The handle stays,
//!   a release follows once the state lets go of it.

/// The handle of an object of the host. The host never gives out a handle twice.
pub type Handle = u32;
