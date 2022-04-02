use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
struct FetchStatement<'buf> {
    node_id: u32,
    statement_name: Option<Box<super::sql_nodes::QualifiedName<'buf>>>,
    fetch_method: Option<sx::FetchMethodType>,
    fetch_from_uri: Option<&'buf str>,
}
