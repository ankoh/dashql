//! Collect the parameters of a script.
//!
//! A parameter stands for a table when it is the table of a table reference (`from :source`,
//! `insert into :target`), and for a scalar value everywhere else (`where x > :min`).

use super::state::AnalysisState;
use super::types::*;
use dashql_buffers::parser::{AttributeKey as K, NodeType};
use dashql_parser::attrs;
use std::ops::Range;
use std::sync::Arc;

pub(super) fn visit(state: &mut AnalysisState, morsel: Range<usize>) {
    for node_id in morsel {
        let node = &state.ast[node_id];
        if node.node_type() != NodeType::OBJECT_SQL_PARAMETER_REF {
            continue;
        }
        let parent = &state.ast[node.parent() as usize];
        let kind = if node.attribute_key() == K::SQL_TABLEREF_TABLE && parent.node_type() == NodeType::OBJECT_SQL_TABLEREF {
            ParameterKind::Table
        } else {
            ParameterKind::Scalar
        };
        let [name] = attrs!(state.children(node), [K::SQL_PARAMETER_NAME]);
        let name = name.and_then(|n| state.read_name_path(n).last().map(|&id| state.name(id).text)).map(unquote);
        let node_id = node_id as u32;
        let parameter = Parameter {
            ast_node_id: node_id,
            ast_statement_id: state.find_statement_id(node_id),
            location: *node.symbol_span(),
            kind,
            name,
        };
        state.out.parameters.push(parameter);
    }
}

/// The parser keeps the quotes of names from string literals (`:'mode'`, see docs/design/core_quirks.md)
fn unquote(name: Arc<str>) -> Arc<str> {
    match name.strip_prefix('\'').and_then(|n| n.strip_suffix('\'')) {
        Some(inner) => inner.into(),
        None => name,
    }
}
