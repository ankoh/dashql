use super::sql_nodes::*;
use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
struct FetchStatement<'text> {
    node_id: u32,
    statement_name: Option<NamePath<'text>>,
    fetch_method: Option<sx::FetchMethodType>,
    fetch_from_uri: Option<&'text str>,
}
