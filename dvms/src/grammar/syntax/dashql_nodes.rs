use crate::proto::syntax as sx;

#[derive(Debug, Clone)]
struct FetchStatement<'text> {
    fetch_method: Option<sx::FetchMethodType>,
    fetch_from_uri: Option<&'text str>,
}
