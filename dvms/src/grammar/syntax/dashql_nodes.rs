use super::enums_serde::*;
use dashql_proto::syntax as sx;
use serde::{Deserialize, Serialize};

use super::sql_nodes::NamePath;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchStatement<'text> {
    pub name: Option<NamePath<'text>>,
    #[serde(with = "serde_fetch_method_type::opt")]
    pub fetch_method: Option<sx::FetchMethodType>,
    pub fetch_from_uri: Option<&'text str>,
}
