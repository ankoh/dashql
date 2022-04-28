pub use dashql_parser::{parse, ASTBuffer};
pub mod syntax;

pub use syntax::deserialize_ast;
pub use syntax::serialize_ast_as_xml;
