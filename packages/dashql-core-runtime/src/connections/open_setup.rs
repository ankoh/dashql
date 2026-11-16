//! The setups that the opening of a workbook starts: the embedded Hyper and the Hyper of a link.
//!
//! When the app opens a workbook, the runtime sets up the connections of the workbook that need nothing of the user: a
//! connection to the embedded Hyper with committed params, and a connection to the Hyper of a link once the tab holds
//! the token of the link. Every connection is considered once, a connection to the Hyper of a link once per link: a
//! connection that is online, was cancelled, carries a draft or another protocol is consumed without a setup, and later
//! resets, discarded drafts and other workbooks don't opt it back in. The user connects the other connections.

use std::collections::HashSet;

use super::params::string_field;
use super::{ConnectionHealth, ConnectionState, ConnectorType};

/// What the opening of a workbook does with a connection of it
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenSetup {
    /// Nothing, the connection was considered before or the user connects it
    Skip,
    /// Set the connection up
    Setup,
    /// Reset the connection, it speaks to the Hyper of an earlier link, then set it up
    ResetAndSetup,
}

/// The connections that the openings of workbooks considered
#[derive(Debug, Default)]
pub struct OpenSetups {
    considered: HashSet<String>,
}

impl OpenSetups {
    pub fn new() -> Self {
        Self::default()
    }

    /// Consider a connection of a workbook that the app opens, with the token of the link that the tab holds for it
    pub fn consider(&mut self, connection: &ConnectionState, link_token: Option<&str>) -> OpenSetup {
        let params = connection.params();
        let hyper = params.connector == ConnectorType::Hyper;
        let protocol = if hyper { string_field(&params.params, "protocol") } else { None };
        // The connection to the Hyper of a link connects once per link, without the token of a link it waits for one
        let linked = protocol == Some("V3_HTTP_LINK");
        let key = match (linked, link_token) {
            (true, None) => return OpenSetup::Skip,
            (true, Some(token)) => {
                format!("{} {} {}", connection.connection_id(), string_field(&params.params, "endpoint").unwrap_or(""), token)
            }
            (false, _) => connection.connection_id().to_string(),
        };
        // The first consideration consumes the connection, whatever it decides
        if !self.considered.insert(key) {
            return OpenSetup::Skip;
        }
        if connection.params_draft().is_some() || !hyper || (protocol != Some("WASM") && !linked) {
            return OpenSetup::Skip;
        }
        match (connection.health(), linked) {
            (ConnectionHealth::NotStarted, _) => OpenSetup::Setup,
            (_, true) => OpenSetup::ResetAndSetup,
            (_, false) => OpenSetup::Skip,
        }
    }
}
