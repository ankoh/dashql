//! The diagnostics of the extensions of SQL that the catalog of a script doesn't offer, see `crate::capabilities`.
//!
//! A disabled comment tag is a warning on its name, the passes of the tags skip it. A disabled named parameter is an
//! error of its statement: `:min` and `from :foo` mean nothing to a database, the planner doesn't run the statement.

use super::state::AnalysisState;
use super::types::*;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_parser::span::TextSpan;

/// Is a comment tag offered? Flag it if not.
pub(super) fn tag_enabled(state: &mut AnalysisState, tag: &str, span: TextSpan) -> bool {
    if state.catalog.capabilities().tag_enabled(tag) {
        return true;
    }
    let message = format!("@{tag} is not available here, the tag is ignored");
    state.warn_at(AnalyzerErrorType::DISABLED_CAPABILITY, span, message);
    false
}

/// Flag the named parameters that the catalog doesn't offer
pub(super) fn analyze_parameters(state: &mut AnalysisState) {
    let capabilities = state.catalog.capabilities();
    if capabilities.params && capabilities.table_parameters {
        return;
    }
    let mut errors = Vec::new();
    for parameter in &state.out.parameters {
        // Positional parameters (`$1`, `?`) are plain SQL
        let Some(name) = parameter.name.as_ref().filter(|n| n.parse::<u32>().is_err()) else { continue };
        let message = match parameter.kind {
            ParameterKind::Scalar if !capabilities.params => format!("the parameter :{name} is not available here"),
            ParameterKind::Table if !capabilities.table_parameters => {
                format!("the table parameter :{name} is not available here")
            }
            _ => continue,
        };
        errors.push((parameter.ast_node_id, message));
    }
    for (node_id, message) in errors {
        state.add_error(AnalyzerErrorType::DISABLED_CAPABILITY, AnalyzerErrorSeverity::ERROR, node_id, message);
    }
}
