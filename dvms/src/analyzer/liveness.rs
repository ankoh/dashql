use crate::grammar::Statement;

use super::program_analysis::ProgramAnalysis;
use std::collections::HashSet;

pub fn determine_statement_liveness<'a>(ctx: &mut ProgramAnalysis<'a>) {
    ctx.statement_liveness.resize(ctx.program.statements.len(), false);

    // Prepare DFSs starting from viz and input statements
    let mut pending = Vec::new();
    let mut visited = HashSet::new();
    for (stmt_id, stmt) in ctx.program.statements.iter().enumerate() {
        match stmt {
            Statement::Viz(_) | Statement::Input(_) => pending.push(stmt_id),
            _ => {}
        }
    }

    // Propagate dependencies
    while !pending.is_empty() {
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

#[cfg(test)]
mod test {
    use super::*;
    use crate::analyzer::analysis_settings::ProgramAnalysisSettings;
    use crate::analyzer::name_resolution::*;
    use crate::grammar;
    use std::error::Error;
    use std::rc::Rc;

    fn test_liveness(script: &str, expected: &[bool]) -> Result<(), Box<dyn Error + Send + Sync>> {
        let settings = Rc::new(ProgramAnalysisSettings::default());
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, script)?;
        let prog = Rc::new(grammar::deserialize_ast(&arena, script, ast)?);
        let mut ctx = ProgramAnalysis::new(settings.clone(), &arena, script, ast, prog, Vec::new());
        normalize_statement_names(&mut ctx);
        discover_statement_dependencies(&mut ctx);
        determine_statement_liveness(&mut ctx);
        assert_eq!(&ctx.statement_liveness, expected);
        Ok(())
    }

    #[test]
    fn test_simple_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(r#"SELECT 1"#, &[false])
    }

    #[test]
    fn test_simple_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(
            r#"
            CREATE TABLE foo AS SELECT 1;
            VISUALIZE foo USING TABLE;
        "#,
            &[true, true],
        )
    }

    #[test]
    fn test_simple_2() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_liveness(
            r#"
            CREATE TABLE dead AS SELECT 42;
            CREATE TABLE foo AS SELECT 1;
            VISUALIZE foo USING TABLE;
        "#,
            &[false, true, true],
        )
    }
}
