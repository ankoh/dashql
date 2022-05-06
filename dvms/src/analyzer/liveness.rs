use super::analysis_context::ProgramAnalysisContext;

pub fn identify_dead_statements<'a>(ctx: &mut ProgramAnalysisContext<'a>) {
    ctx.statement_liveness
        .resize(ctx.program_translated.statements.len(), false);

    // Collect dependencies
}
