//! Scripts that run only on request, from the `@manual` comment tag.
//!
//! ```sql
//! /* All orders with their line items, expensive without a filter.
//!    @manual */
//! select * from orders join lineitem on l_orderkey = o_orderkey;
//! ```
//!
//! A script with `@manual` is a building block that is too expensive to run unfiltered. Runs of the whole session
//! and the reruns of input changes leave it out, the scripts of its connection inline it with their own filters, and
//! it runs when someone runs it directly. Like `@flow`, the tag may annotate any statement. The text after the tag
//! is free, e.g. the reason, and further `@manual` tags change nothing.

use super::state::AnalysisState;

/// The tag of scripts that run only on request
pub const MANUAL_TAG: &str = "manual";

/// Read the `@manual` tags of the statements
pub(super) fn analyze(state: &mut AnalysisState) {
    let parsed = state.parsed;
    state.out.manual = parsed
        .associate_descriptions()
        .iter()
        .any(|description| super::vis_tags::statement_tags(parsed, description, &[MANUAL_TAG]).next().is_some());
}
