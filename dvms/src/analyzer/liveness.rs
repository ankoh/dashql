use crate::grammar::Statement;

use super::analysis_context::ProgramAnalysisContext;
use std::collections::HashSet;

pub fn identify_dead_statements<'a>(ctx: &mut ProgramAnalysisContext<'a>) {
    ctx.statement_liveness
        .resize(ctx.program_translated.statements.len(), false);

    // Prepare DFSs starting from viz and input statements
    let mut pending = Vec::new();
    let mut visited = HashSet::new();
    for (stmt_id, stmt) in ctx.program_translated.statements.iter().enumerate() {
        match stmt {
            Statement::Viz(_) | Statement::Input(_) => pending.push(stmt_id),
            _ => {}
        }
    }

    // Propagate dependencies
    while pending.is_empty() {
        let next = *pending.last().unwrap();
        pending.pop();
        ctx.statement_liveness[next] = true;
        if visited.contains(&next) {
            continue;
        }
        visited.insert(next);
        for ((_, dep), _) in ctx.statement_depends_on.range((next, 0)..(next + 1, 0)) {
            pending.push(*dep);
        }
    }
}
